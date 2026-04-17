// regression/run.mjs
//
// One-shot: run jolly-bench against scope-stress, then diff against the
// tracked baseline.
//
// Usage:
//   node regression/run.mjs                          # run + diff against default baseline
//   node regression/run.mjs --baseline <path>        # use a specific baseline
//   node regression/run.mjs --capture <path>         # capture a new baseline (no diff)
//   node regression/run.mjs --duration 60s -c 100    # override bench options
//
// Exit codes:
//   0  within tolerance (or capture succeeded)
//   1  regression detected
//   2  bad usage / setup error
//   3  jolly-bench run failed

import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const SCENARIO = join(__dirname, "scope-stress.mjs")
const DEFAULT_OUT = join(__dirname, "out")
const KEEP_CANDIDATES = 3   // retain the last N candidate-*.ndjson files
const KEEP_BASELINE_RAWS = 1 // retain the last N baseline-raw-*.ndjson files

// Prune older run artifacts in DEFAULT_OUT. Keeps the newest N of each kind.
// Only touches files that match `${prefix}-<digits>.ndjson`; other files
// (user-written, non-pattern) are never deleted.
function pruneOut(prefix, keep) {
  if (!existsSync(DEFAULT_OUT)) return
  const pattern = new RegExp(`^${prefix}-\\d+\\.ndjson$`)
  const entries = readdirSync(DEFAULT_OUT)
    .filter(f => pattern.test(f))
    .map(f => {
      const full = join(DEFAULT_OUT, f)
      return { full, mtime: statSync(full).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime) // newest first
  for (const { full } of entries.slice(keep)) {
    try { unlinkSync(full) }
    catch (err) { process.stderr.write(`warn: could not prune ${full}: ${(err).message}\n`) }
  }
}

// ---- Argument parsing ----
const args = process.argv.slice(2)
let baselinePath = join(__dirname, "baseline-latest.json")
let capturePath = null
let duration = "30s"
let concurrency = "50"

for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === "--baseline") baselinePath = resolve(args[++i])
  else if (a === "--capture") capturePath = resolve(args[++i])
  else if (a === "--duration" || a === "-d") duration = args[++i]
  else if (a === "--concurrency" || a === "-c") concurrency = args[++i]
  else {
    process.stderr.write(`unknown argument: ${a}\n`)
    process.exit(2)
  }
}

// ---- Resolve jolly-bench binary ----
//
// Preference order:
//   1. node_modules/.bin/jolly-bench (devDependency — most reproducible)
//   2. ../jolly-bench/dist/cli.js (sibling checkout — co-development)
//   3. fall back to npx (will fetch from npm on demand)
function resolveBench() {
  const binName = process.platform === "win32" ? "jolly-bench.cmd" : "jolly-bench"
  const local = join(ROOT, "node_modules", ".bin", binName)
  if (existsSync(local)) {
    return { cmd: local, args: [], via: "devDependency" }
  }
  const sibling = resolve(ROOT, "..", "jolly-bench", "dist", "cli.js")
  if (existsSync(sibling)) {
    return { cmd: process.execPath, args: [sibling], via: "sibling checkout (../jolly-bench/dist/cli.js)" }
  }
  // npx fallback
  const npx = process.platform === "win32" ? "npx.cmd" : "npx"
  return { cmd: npx, args: ["--yes", "jolly-bench"], via: "npx (no local install found)" }
}

// ---- Run jolly-bench ----
function runBench(outPath) {
  const bench = resolveBench()
  mkdirSync(dirname(outPath), { recursive: true })
  process.stderr.write(`jolly-bench: ${bench.via}\n`)
  process.stderr.write(`scenario:    ${SCENARIO}\n`)
  process.stderr.write(`duration:    ${duration}  concurrency: ${concurrency}\n`)
  process.stderr.write(`output:      ${outPath}\n\n`)

  // On Windows, .cmd shims require shell:true. On POSIX, node_modules/.bin/*
  // entries are shell scripts and work with or without shell; we enable
  // shell uniformly for cross-platform parity.
  const res = spawnSync(
    bench.cmd,
    [
      ...bench.args,
      "--scenario", SCENARIO,
      "-c", concurrency,
      "-d", duration,
      "--out", outPath,
    ],
    { stdio: "inherit", cwd: ROOT, shell: true }
  )
  if (res.error) {
    process.stderr.write(`\nfailed to invoke jolly-bench: ${res.error.message}\n`)
    process.exit(3)
  }
  if (res.status !== 0) {
    process.stderr.write(`\njolly-bench exited with code ${res.status}\n`)
    process.exit(3)
  }
}

// ---- Capture mode ----
// If --capture ends in `.json`, run the bench into a scratch NDJSON then
// summarize into the target JSON. This keeps committed baselines tiny
// (<1 KB) and machine-diffable.
function summarizeNdjson(path) {
  const raw = readFileSync(path, "utf8")
  const durations = []
  for (const line of raw.split("\n")) {
    if (!line) continue
    let rec
    try { rec = JSON.parse(line) } catch { continue }
    if (rec && rec.ok && typeof rec.duration_ms === "number") durations.push(rec.duration_ms)
  }
  durations.sort((a, b) => a - b)
  const pct = (p) => durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))]
  const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version
  return {
    count: durations.length,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    max: durations[durations.length - 1],
    capturedAt: new Date().toISOString(),
    jollyCoopVersion: pkgVersion,
    config: { concurrency, duration, scenario: "scope-stress" },
  }
}

if (capturePath) {
  let ndjsonPath = capturePath
  if (capturePath.endsWith(".json")) {
    mkdirSync(DEFAULT_OUT, { recursive: true })
    ndjsonPath = join(DEFAULT_OUT, `baseline-raw-${Date.now()}.ndjson`)
  }
  runBench(ndjsonPath)

  if (capturePath.endsWith(".json")) {
    const summary = summarizeNdjson(ndjsonPath)
    writeFileSync(capturePath, JSON.stringify(summary, null, 2) + "\n")
    process.stderr.write(`\nsummary:\n${JSON.stringify(summary, null, 2)}\n`)
  }

  // Prune older baseline-raw artifacts. The newest one (just written) is
  // preserved by `.slice(keep)` because we sort newest-first.
  pruneOut("baseline-raw", KEEP_BASELINE_RAWS)

  process.stderr.write(`\n✓ captured baseline at ${capturePath}\n`)
  process.exit(0)
}

// ---- Diff mode ----
if (!existsSync(baselinePath)) {
  process.stderr.write(`error: baseline not found at ${baselinePath}\n`)
  process.stderr.write(`       capture one with:  node regression/run.mjs --capture ${baselinePath}\n`)
  process.exit(2)
}

const candidatePath = join(DEFAULT_OUT, `candidate-${Date.now()}.ndjson`)
runBench(candidatePath)

// ---- Diff ----
const diff = spawnSync(
  process.execPath,
  [join(__dirname, "diff.mjs"), baselinePath, candidatePath],
  { stdio: "inherit" }
)

// Prune AFTER the diff has finished reading. Newest-first sort guarantees
// the candidate we just wrote is retained.
pruneOut("candidate", KEEP_CANDIDATES)

process.exit(diff.status ?? 3)
