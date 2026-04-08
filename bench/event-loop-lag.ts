import { scope, yieldNow } from "../src/index.js"
import { run, monitorLag, type BenchResult } from "./harness.js"

async function lagUnderLoad(N: number, label: string, taskFn: () => void | Promise<void>): Promise<BenchResult> {
  const stop = monitorLag(10)

  const start = performance.now()
  await scope(async s => {
    for (let i = 0; i < N; i++) {
      s.spawn(taskFn)
    }
  })
  const duration = performance.now() - start
  const { maxLag } = stop()

  return {
    name: `event-loop-lag-${label}-${N}`,
    ops: N,
    duration_ms: duration,
    ops_per_sec: Math.round(N / (duration / 1000)),
    event_loop_lag_ms: maxLag,
  }
}

export async function runEventLoopLagBenchmarks(): Promise<BenchResult[]> {
  const results: BenchResult[] = []

  for (const N of [10_000, 100_000]) {
    results.push(await run(
      `event-loop-lag-noop-${N}`,
      () => lagUnderLoad(N, "noop", () => {})
    ))
  }

  for (const N of [1_000, 10_000]) {
    results.push(await run(
      `event-loop-lag-yield-${N}`,
      () => lagUnderLoad(N, "yield", async () => { await yieldNow() })
    ))
  }

  return results
}
