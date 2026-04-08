// Moderate: Async pool / task queue with concurrency control
// Shows: scope, spawn, sleep, yieldNow, limit, timeout
//
// Pattern: Library authors build higher-level primitives on jolly's
// concurrency limit. This creates a reusable pool() that processes
// items with bounded concurrency, optional per-item timeout, and
// collects results in order.

import { scope, sleep, yieldNow } from "../../dist/index.js"

// The reusable utility
async function pool(items, fn, { concurrency = 5, itemTimeout } = {}) {
  const results = new Array(items.length)
  const errors = []

  await scope({ limit: concurrency }, async s => {
    for (let i = 0; i < items.length; i++) {
      const index = i
      s.spawn(async () => {
        try {
          if (itemTimeout) {
            // Each item gets its own timeout via a nested scope
            await scope({ timeout: itemTimeout }, async inner => {
              results[index] = await inner.spawn(() => fn(items[index], index))
            })
          } else {
            results[index] = await fn(items[index], index)
          }
        } catch (err) {
          errors.push({ index, item: items[index], error: err.message })
          results[index] = undefined
        }
      })
      await yieldNow() // keep scheduler responsive between spawns
    }
  })

  return { results, errors }
}

// --- Usage: process 15 items, 4 at a time, 200ms timeout per item ---

let maxConcurrent = 0
let running = 0

const items = Array.from({ length: 15 }, (_, i) => `job-${i + 1}`)

const { results, errors } = await pool(items, async (item, index) => {
  running++
  maxConcurrent = Math.max(maxConcurrent, running)

  // Simulate variable work — job-5 is slow and will timeout
  const duration = index === 4 ? 500 : 20 + Math.random() * 40
  await sleep(duration)

  running--
  return `${item}: done`
}, { concurrency: 4, itemTimeout: 200 })

const succeeded = results.filter(Boolean)

console.log(`Processed ${items.length} items (concurrency: 4)`)
console.log(`  Succeeded: ${succeeded.length}`)
console.log(`  Failed: ${errors.length}`)
console.log(`  Max concurrent: ${maxConcurrent}`)
if (errors.length > 0) {
  for (const e of errors) console.log(`  Error: ${e.item} — ${e.error}`)
}

console.assert(maxConcurrent <= 4, `concurrency violated: ${maxConcurrent}`)
console.assert(succeeded.length === 14, `expected 14 succeeded, got ${succeeded.length}`)
console.assert(errors.length === 1, `expected 1 timeout, got ${errors.length}`)
console.assert(errors[0].item === "job-5", "job-5 should have timed out")

console.log("\n✓ async-pool passed")
