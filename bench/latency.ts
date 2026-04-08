import { scope } from "../src/index.js"
import { run, percentile, type BenchResult } from "./harness.js"

async function schedulingLatency(N: number): Promise<BenchResult> {
  const latencies: number[] = []

  await scope(async s => {
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      s.spawn(() => {
        latencies.push(performance.now() - t0)
      })
    }
  })

  latencies.sort((a, b) => a - b)
  const duration = latencies.reduce((a, b) => a + b, 0)

  return {
    name: `latency-scheduling-${N}`,
    ops: N,
    duration_ms: duration,
    p50_latency_ms: percentile(latencies, 50),
    p95_latency_ms: percentile(latencies, 95),
    p99_latency_ms: percentile(latencies, 99),
  }
}

export async function runLatencyBenchmarks(): Promise<BenchResult[]> {
  const results: BenchResult[] = []
  for (const N of [1_000, 10_000, 100_000]) {
    results.push(await run(`latency-scheduling-${N}`, () => schedulingLatency(N)))
  }
  return results
}
