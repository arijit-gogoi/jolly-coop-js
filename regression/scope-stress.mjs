// regression/scope-stress.mjs
//
// Scenario module for jolly-bench. Every "iteration" here is one unit of
// runtime-only work — no HTTP, no filesystem, no external dependencies.
//
// The shape is deliberate: one nested scope, a fan-out of 10 spawns, each
// sleeping 1ms, awaited collectively. This exercises:
//   - scope creation (nested, with parent signal threaded)
//   - spawn (×10 per iteration)
//   - sleep with signal (timer + abort listener per spawn)
//   - await-all via Promise.all on Task<T>
//   - scope cleanup + resource settlement
//   - scheduler drain + MessageChannel yielding
//
// What it deliberately does NOT do:
//   - fetch / http: would mask runtime cost with I/O variance
//   - Math.random / Date.now in hot path: would leak variance into the metric
//   - throw: would exercise the fail-fast path, which has its own regression
//     surface. Keep this scenario on the happy path; add a fail-fast
//     scenario if/when we need to regression-test that path.
//
// If this scenario changes, baselines must be recaptured. Freeze until
// there is a reason to evolve.

import { scope, sleep } from "jolly-coop"

const FAN_OUT = 10
const INNER_SLEEP_MS = 1

export default async function scopeStress(_user, signal) {
  await scope({ signal }, async s => {
    const tasks = []
    for (let i = 0; i < FAN_OUT; i++) {
      tasks.push(s.spawn(async () => {
        await sleep(INNER_SLEEP_MS, s.signal)
        return i
      }))
    }
    await Promise.all(tasks)
  })
}
