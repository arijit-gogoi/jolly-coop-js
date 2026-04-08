// Moderate: Rate-limited API pipeline with timeout and error handling
// Shows: scope options (limit, timeout), sleep, yieldNow, error propagation

import { scope, sleep, yieldNow } from "../../dist/index.js"

// Simulate a batch job: process 20 items with max 5 concurrent, 10s timeout
const items = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `item-${i + 1}` }))
const processed = []
const failed = []

try {
  await scope({ limit: 5, timeout: 10_000 }, async s => {
    for (const item of items) {
      s.spawn(async () => {
        // Simulate API call with variable latency
        const latency = 50 + Math.random() * 150
        await sleep(latency)

        // Simulate occasional failures (item 7 and 13)
        if (item.id === 7 || item.id === 13) {
          throw new Error(`Processing failed for ${item.name}`)
        }

        processed.push(item.id)
      })

      // Yield between spawns to keep the scheduler responsive
      await yieldNow()
    }
  })
} catch (err) {
  // First error wins — scope cancels remaining tasks
  failed.push(err.message)
}

console.log(`Processed: ${processed.length} items`)
console.log(`Failed with: ${failed[0]}`)
console.log(`Remaining items were cancelled (first-error-wins semantics)`)

// Verify: we got a failure (item 7 fails before 13 due to ordering)
console.assert(failed.length === 1, "expected exactly 1 error")
console.assert(failed[0].includes("item-"), "expected item processing error")
console.assert(processed.length < 20, "not all items should have completed")

console.log("\n✓ rate-limited-pipeline passed")
