// regression/diff.mjs
//
// Compare two jolly-bench NDJSON sample files. Prints a percentile delta
// table and exits non-zero if any watched percentile regressed by more
// than THRESHOLD_PCT.
//
// Usage:
//   node regression/diff.mjs <baseline.ndjson> <candidate.ndjson>
//
// Exit codes:
//   0  within tolerance
//   1  regression detected on at least one watched percentile
//   2  bad usage / file missing

import { readFileSync, existsSync, writeFileSync } from "node:fs"

const THRESHOLD_PCT = 10   // flag any percentile that regresses > this %
const WATCHED = ["p50", "p95", "p99"]

function usageExit(msg) {
  if (msg) process.stderr.write(`error: ${msg}\n`)
  process.stderr.write("usage: node regression/diff.mjs <baseline> <candidate>\n")
  process.stderr.write("       each arg may be either a raw NDJSON file or a summary JSON file\n")
  process.exit(2)
}

function loadDurations(path) {
  if (!existsSync(path)) usageExit(`file not found: ${path}`)
  const raw = readFileSync(path, "utf8")
  const durations = []
  for (const line of raw.split("\n")) {
    if (!line) continue
    let rec
    try { rec = JSON.parse(line) }
    catch { continue }
    if (rec && rec.ok && typeof rec.duration_ms === "number") {
      durations.push(rec.duration_ms)
    }
  }
  durations.sort((a, b) => a - b)
  return durations
}

function percentile(sorted, pct) {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))
  return sorted[idx]
}

// A summary is the tiny JSON representation of a run. It's what gets
// committed to git as a baseline — 200 bytes instead of 39 MB of NDJSON.
function summarize(sorted) {
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? NaN,
  }
}

function loadSummary(path) {
  if (!existsSync(path)) usageExit(`file not found: ${path}`)
  if (path.endsWith(".json")) {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (parsed && typeof parsed.p95 === "number") return parsed
    usageExit(`not a valid summary JSON: ${path}`)
  }
  // NDJSON path — aggregate on the fly
  return summarize(loadDurations(path))
}

function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n)
}

function pctDelta(before, after) {
  if (!Number.isFinite(before) || before === 0) return NaN
  return (after / before - 1) * 100
}

const [, , baselinePath, candidatePath] = process.argv
if (!baselinePath || !candidatePath) usageExit("two files required")

const base = loadSummary(baselinePath)
const cand = loadSummary(candidatePath)

if (!base.count || !cand.count) usageExit("zero samples in one of the inputs")

const rows = [
  { name: "count", base: base.count, cand: cand.count, watch: false },
  { name: "p50",   base: base.p50,   cand: cand.p50,   watch: true },
  { name: "p95",   base: base.p95,   cand: cand.p95,   watch: true },
  { name: "p99",   base: base.p99,   cand: cand.p99,   watch: true },
  { name: "max",   base: base.max,   cand: cand.max,   watch: false },
]

process.stdout.write(`\nbaseline:  ${baselinePath}\n`)
process.stdout.write(`candidate: ${candidatePath}\n\n`)
process.stdout.write(`metric   baseline    candidate   delta\n`)
process.stdout.write(`------   --------    ---------   -----\n`)

let regressed = false
for (const row of rows) {
  const delta = row.name === "count" ? pctDelta(row.base, row.cand) : pctDelta(row.base, row.cand)
  const deltaStr = Number.isFinite(delta) ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : "n/a"
  const baseStr = row.name === "count" ? String(row.base) : fmt(row.base) + " ms"
  const candStr = row.name === "count" ? String(row.cand) : fmt(row.cand) + " ms"
  let flag = ""
  if (row.watch && Number.isFinite(delta) && delta > THRESHOLD_PCT) {
    flag = "  REGRESSED"
    regressed = true
  } else if (row.watch && Number.isFinite(delta) && delta < -THRESHOLD_PCT) {
    flag = "  (improved)"
  }
  process.stdout.write(
    `${row.name.padEnd(8)} ${baseStr.padEnd(11)} ${candStr.padEnd(11)} ${deltaStr.padStart(7)}${flag}\n`
  )
}

process.stdout.write(`\nthreshold: ${THRESHOLD_PCT}% regression on any of ${WATCHED.join(", ")}\n`)

if (regressed) {
  process.stdout.write(`\n✗ regression detected\n`)
  process.exit(1)
}
process.stdout.write(`\n✓ within tolerance\n`)
process.exit(0)
