import { scope, sleep } from "../src/index.js"
import { run, type BenchResult } from "./harness.js"

async function limitEnforcement(limit: number, total: number): Promise<BenchResult> {
  let running = 0
  let maxRunning = 0

  const start = performance.now()
  await scope({ limit }, async s => {
    for (let i = 0; i < total; i++) {
      s.spawn(async () => {
        running++
        maxRunning = Math.max(maxRunning, running)
        await sleep(1)
        running--
      })
    }
  })
  const duration = performance.now() - start

  return {
    name: `limits-${limit}-of-${total}`,
    ops: total,
    duration_ms: duration,
    ops_per_sec: Math.round(total / (duration / 1000)),
    max_concurrency: maxRunning,
    details: {
      limit,
      total,
      enforced: maxRunning <= limit,
    },
  }
}

export async function runLimitsBenchmarks(): Promise<BenchResult[]> {
  const results: BenchResult[] = []
  results.push(await run("limits-10-of-100", () => limitEnforcement(10, 100)))
  results.push(await run("limits-20-of-500", () => limitEnforcement(20, 500)))
  results.push(await run("limits-50-of-1000", () => limitEnforcement(50, 1000)))
  return results
}
