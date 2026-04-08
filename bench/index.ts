import { run, formatResult, type BenchResult } from "./harness.js"
import { scope, sleep, yieldNow } from "../src/index.js"
import { monitorLag, percentile } from "./harness.js"

const jsonMode = process.argv.includes("--json")
const allResults: BenchResult[] = []

function log(msg: string) {
  if (!jsonMode) process.stdout.write(msg + "\n")
}

async function bench(name: string, fn: () => Promise<BenchResult | void>) {
  if (!jsonMode) process.stdout.write(`  ${name} ... `)
  const result = await run(name, fn)
  if (!jsonMode) process.stdout.write("done\n")
  allResults.push(result)
  return result
}

async function main() {
  // === Throughput ===
  log("\nThroughput\n" + "─".repeat(40))

  for (const N of [1_000, 10_000, 100_000]) {
    const r = await bench(`throughput-noop-${N}`, async () => {
      const start = performance.now()
      await scope(async s => { for (let i = 0; i < N; i++) s.spawn(() => {}) })
      const d = performance.now() - start
      return { name: `throughput-noop-${N}`, ops: N, duration_ms: d, ops_per_sec: Math.round(N / (d / 1000)) }
    })
    log(formatResult(r, false))

    const r2 = await bench(`throughput-yield-${N}`, async () => {
      const start = performance.now()
      await scope(async s => { for (let i = 0; i < N; i++) s.spawn(async () => { await yieldNow() }) })
      const d = performance.now() - start
      return { name: `throughput-yield-${N}`, ops: N, duration_ms: d, ops_per_sec: Math.round(N / (d / 1000)) }
    })
    log(formatResult(r2, false))
  }

  // === Scheduling Latency ===
  log("\nScheduling Latency\n" + "─".repeat(40))

  for (const N of [1_000, 10_000, 100_000]) {
    const r = await bench(`latency-scheduling-${N}`, async () => {
      const latencies: number[] = []
      await scope(async s => {
        for (let i = 0; i < N; i++) {
          const t0 = performance.now()
          s.spawn(() => { latencies.push(performance.now() - t0) })
        }
      })
      latencies.sort((a, b) => a - b)
      return {
        name: `latency-scheduling-${N}`, ops: N,
        duration_ms: latencies.reduce((a, b) => a + b, 0),
        p50_latency_ms: percentile(latencies, 50),
        p95_latency_ms: percentile(latencies, 95),
        p99_latency_ms: percentile(latencies, 99),
      }
    })
    log(formatResult(r, false))
  }

  // === Event Loop Lag ===
  log("\nEvent Loop Lag\n" + "─".repeat(40))

  for (const [label, N, taskFn] of [
    ["noop", 10_000, () => {}],
    ["noop", 100_000, () => {}],
    ["yield", 1_000, async () => { await yieldNow() }],
    ["yield", 10_000, async () => { await yieldNow() }],
  ] as Array<[string, number, () => void | Promise<void>]>) {
    const r = await bench(`event-loop-lag-${label}-${N}`, async () => {
      const stop = monitorLag(10)
      const start = performance.now()
      await scope(async s => { for (let i = 0; i < N; i++) s.spawn(taskFn) })
      const d = performance.now() - start
      const { maxLag } = stop()
      return { name: `event-loop-lag-${label}-${N}`, ops: N, duration_ms: d, ops_per_sec: Math.round(N / (d / 1000)), event_loop_lag_ms: maxLag }
    })
    log(formatResult(r, false))
  }

  // === Fairness ===
  log("\nFairness\n" + "─".repeat(40))

  const fr = await bench("fairness-canary", async () => {
    let maxDelay = 0, last = performance.now()
    const delays: number[] = []
    await scope(async s => {
      s.spawn(async () => {
        for (let i = 0; i < 1000; i++) {
          const now = performance.now(); delays.push(now - last); maxDelay = Math.max(maxDelay, now - last); last = now; await yieldNow()
        }
      })
      for (let i = 0; i < 1000; i++) s.spawn(() => { let sum = 0; for (let j = 0; j < 1000; j++) sum += j })
    })
    delays.sort((a, b) => a - b)
    return { name: "fairness-canary", duration_ms: delays.reduce((a, b) => a + b, 0), details: { max_delay_ms: maxDelay, median_delay_ms: delays[Math.floor(delays.length / 2)] } }
  })
  log(formatResult(fr, false))

  // === Concurrency Limits ===
  log("\nConcurrency Limits\n" + "─".repeat(40))

  for (const [limit, total] of [[10, 100], [20, 500], [50, 1000]] as Array<[number, number]>) {
    const r = await bench(`limits-${limit}-of-${total}`, async () => {
      let running = 0, maxRunning = 0
      const start = performance.now()
      await scope({ limit }, async s => {
        for (let i = 0; i < total; i++) s.spawn(async () => { running++; maxRunning = Math.max(maxRunning, running); await sleep(1); running-- })
      })
      const d = performance.now() - start
      return { name: `limits-${limit}-of-${total}`, ops: total, duration_ms: d, ops_per_sec: Math.round(total / (d / 1000)), max_concurrency: maxRunning, details: { limit, total, enforced: maxRunning <= limit } }
    })
    log(formatResult(r, false))
  }

  // === I/O Simulation ===
  log("\nI/O Simulation\n" + "─".repeat(40))

  for (const [limit, total, maxSleepMs] of [[20, 200, 20], [20, 1000, 50]] as Array<[number, number, number]>) {
    const r = await bench(`io-sim-${limit}-of-${total}`, async () => {
      const stop = monitorLag(10)
      const start = performance.now()
      await scope({ limit }, async s => {
        for (let i = 0; i < total; i++) s.spawn(async () => { await sleep(Math.random() * maxSleepMs) })
      })
      const d = performance.now() - start
      const { maxLag } = stop()
      return { name: `io-sim-${limit}-of-${total}`, ops: total, duration_ms: d, ops_per_sec: Math.round(total / (d / 1000)), event_loop_lag_ms: maxLag }
    })
    log(formatResult(r, false))
  }

  // === Summary ===
  if (jsonMode) {
    console.log(JSON.stringify(allResults, null, 2))
  } else {
    log("\n" + "═".repeat(40))
    log(`Total: ${allResults.length} benchmarks`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
