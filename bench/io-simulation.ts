import { scope, sleep } from "../src/index.js"
import { run, monitorLag, type BenchResult } from "./harness.js"

async function jitteredIO(limit: number, total: number, maxSleepMs: number): Promise<BenchResult> {
  const stop = monitorLag(10)

  const start = performance.now()
  await scope({ limit }, async s => {
    for (let i = 0; i < total; i++) {
      s.spawn(async () => {
        await sleep(Math.random() * maxSleepMs)
      })
    }
  })
  const duration = performance.now() - start
  const { maxLag } = stop()

  return {
    name: `io-simulation-${limit}-of-${total}`,
    ops: total,
    duration_ms: duration,
    ops_per_sec: Math.round(total / (duration / 1000)),
    event_loop_lag_ms: maxLag,
    details: { limit, total, maxSleepMs },
  }
}

export async function runIOSimulationBenchmarks(): Promise<BenchResult[]> {
  const results: BenchResult[] = []
  results.push(await run("io-sim-20-of-200", () => jitteredIO(20, 200, 20)))
  results.push(await run("io-sim-20-of-1000", () => jitteredIO(20, 1000, 50)))
  return results
}
