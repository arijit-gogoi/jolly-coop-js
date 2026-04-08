import { scope, yieldNow } from "../src/index.js"
import { run, type BenchResult } from "./harness.js"

async function canaryFairness(): Promise<BenchResult> {
  let maxDelay = 0
  let last = performance.now()
  const delays: number[] = []

  await scope(async s => {
    // Canary task: yields cooperatively, measures delay between resumes
    s.spawn(async () => {
      for (let i = 0; i < 1000; i++) {
        const now = performance.now()
        const delay = now - last
        delays.push(delay)
        maxDelay = Math.max(maxDelay, delay)
        last = now
        await yieldNow()
      }
    })

    // Competing tasks: CPU-bound, no yielding
    for (let i = 0; i < 1000; i++) {
      s.spawn(() => {
        let sum = 0
        for (let j = 0; j < 1000; j++) sum += j
      })
    }
  })

  delays.sort((a, b) => a - b)

  return {
    name: "fairness-canary",
    duration_ms: delays.reduce((a, b) => a + b, 0),
    details: {
      max_delay_ms: maxDelay,
      median_delay_ms: delays[Math.floor(delays.length / 2)],
      yield_count: delays.length,
    },
  }
}

export async function runFairnessBenchmarks(): Promise<BenchResult[]> {
  return [await run("fairness-canary", canaryFairness)]
}
