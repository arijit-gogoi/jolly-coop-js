import { scope, yieldNow } from "../src/index.js"
import { run, type BenchResult } from "./harness.js"

async function noopThroughput(N: number): Promise<BenchResult> {
  const start = performance.now()
  await scope(async s => {
    for (let i = 0; i < N; i++) {
      s.spawn(() => {})
    }
  })
  const duration = performance.now() - start
  return {
    name: `throughput-noop-${N}`,
    ops: N,
    duration_ms: duration,
    ops_per_sec: Math.round(N / (duration / 1000)),
  }
}

async function yieldThroughput(N: number): Promise<BenchResult> {
  const start = performance.now()
  await scope(async s => {
    for (let i = 0; i < N; i++) {
      s.spawn(async () => {
        await yieldNow()
      })
    }
  })
  const duration = performance.now() - start
  return {
    name: `throughput-yield-${N}`,
    ops: N,
    duration_ms: duration,
    ops_per_sec: Math.round(N / (duration / 1000)),
  }
}

export async function runThroughputBenchmarks(): Promise<BenchResult[]> {
  const results: BenchResult[] = []
  for (const N of [1_000, 10_000, 100_000]) {
    results.push(await run(`throughput-noop-${N}`, () => noopThroughput(N)))
    results.push(await run(`throughput-yield-${N}`, () => yieldThroughput(N)))
  }
  return results
}
