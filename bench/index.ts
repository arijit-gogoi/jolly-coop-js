import { formatResult, type BenchResult } from "./harness.js"
import { runThroughputBenchmarks } from "./throughput.js"
import { runLatencyBenchmarks } from "./latency.js"
import { runEventLoopLagBenchmarks } from "./event-loop-lag.js"
import { runFairnessBenchmarks } from "./fairness.js"
import { runLimitsBenchmarks } from "./limits.js"
import { runIOSimulationBenchmarks } from "./io-simulation.js"

const jsonMode = process.argv.includes("--json")

async function main() {
  const allResults: BenchResult[] = []

  const suites: Array<[string, () => Promise<BenchResult[]>]> = [
    ["Throughput", runThroughputBenchmarks],
    ["Scheduling Latency", runLatencyBenchmarks],
    ["Event Loop Lag", runEventLoopLagBenchmarks],
    ["Fairness", runFairnessBenchmarks],
    ["Concurrency Limits", runLimitsBenchmarks],
    ["I/O Simulation", runIOSimulationBenchmarks],
  ]

  for (const [name, runSuite] of suites) {
    if (!jsonMode) console.log(`\n${name}`)
    if (!jsonMode) console.log("─".repeat(40))

    const results = await runSuite()
    for (const r of results) {
      if (!jsonMode) console.log(formatResult(r, false))
      allResults.push(r)
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(allResults, null, 2))
  } else {
    console.log("\n" + "═".repeat(40))
    console.log(`Total: ${allResults.length} benchmarks`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
