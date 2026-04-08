// Basic: Retryable async operation with exponential backoff
// Shows: scope, spawn, sleep, signal
//
// Pattern: Library authors wrap jolly primitives into reusable utilities.
// This builds a retry() function that respects cancellation — if the
// parent scope cancels, the retry loop stops immediately.

import { scope, sleep } from "../../dist/index.js"

// The reusable utility a library author would export
async function retry(s, fn, { maxAttempts = 3, baseDelay = 100 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await s.spawn(fn)
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1)
        console.log(`  attempt ${attempt} failed: ${err.message}, retrying in ${delay}ms`)
        await sleep(delay)
      }
    }
  }
  throw lastError
}

// --- Usage ---

let callCount = 0

const result = await scope(async s => {
  return await retry(s, () => {
    callCount++
    if (callCount < 3) throw new Error("service unavailable")
    return { status: "ok", data: 42 }
  })
})

console.log(`Result: ${JSON.stringify(result)}`)
console.log(`Total attempts: ${callCount}`)

console.assert(result.status === "ok", "should succeed")
console.assert(callCount === 3, `expected 3 attempts, got ${callCount}`)

// Verify cancellation stops retries
let cancelledAttempts = 0
try {
  await scope(async s => {
    const retryTask = s.spawn(() => retry(s, async () => {
      cancelledAttempts++
      throw new Error("always fails")
    }, { maxAttempts: 10, baseDelay: 50 }))

    // Cancel after a short delay
    await sleep(80)
    s.cancel()
  })
} catch {}

console.log(`Cancelled after ${cancelledAttempts} attempts (< 10 max)`)
console.assert(cancelledAttempts < 10, "cancellation should stop retries early")

console.log("\n✓ retry-with-backoff passed")
