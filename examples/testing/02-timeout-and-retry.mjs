// Moderate: Test runner with per-test timeout and flaky test retry
// Shows: scope, spawn, sleep, yieldNow, timeout, cancel, signal
//
// Pattern: A test runner where each test gets its own scope with a
// timeout. Flaky tests are retried up to N times. The outer scope
// collects all results.

import { scope, sleep, yieldNow } from "../../dist/index.js"

// Test function signature: (signal) => Promise<void> — thread signal through
// awaits in the test body so timeout actually interrupts long operations.
async function runTest(name, fn, { timeout = 500, retries = 0 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await scope({ timeout }, async s => {
        await s.spawn(() => fn(s.signal))
      })
      return { name, status: "pass", attempts: attempt + 1 }
    } catch (err) {
      lastError = err
      if (attempt < retries) {
        await sleep(10) // brief pause between retries
      }
    }
  }
  return { name, status: "fail", error: lastError.message, attempts: retries + 1 }
}

// --- Test suite ---

let flakyCallCount = 0

const tests = [
  { name: "fast test",    fn: async (sig) => { await sleep(10, sig) },                             opts: {} },
  { name: "slow test",    fn: async (sig) => { await sleep(50, sig) },                             opts: {} },
  { name: "timeout test", fn: async (sig) => { await sleep(9999, sig) },                           opts: { timeout: 50 } },
  { name: "flaky test",   fn: async () => { flakyCallCount++; if (flakyCallCount < 3) throw new Error("flaky!") }, opts: { retries: 3 } },
  { name: "error test",   fn: async () => { throw new Error("intentional failure") },      opts: { retries: 1 } },
]

const results = []

await scope(async suite => {
  for (const { name, fn, opts } of tests) {
    const result = await suite.spawn(() => runTest(name, fn, opts))
    results.push(result)
    await yieldNow()
  }
})

console.log("Test results:")
for (const r of results) {
  const icon = r.status === "pass" ? "✓" : "✗"
  const detail = r.error ? ` — ${r.error}` : ""
  const retryInfo = r.attempts > 1 ? ` (${r.attempts} attempts)` : ""
  console.log(`  ${icon} ${r.name}${retryInfo}${detail}`)
}

const passed = results.filter(r => r.status === "pass").length
const failed = results.filter(r => r.status === "fail").length
console.log(`\n${passed} passed, ${failed} failed`)

console.assert(results[0].status === "pass", "fast test should pass")
console.assert(results[1].status === "pass", "slow test should pass")
console.assert(results[2].status === "fail", "timeout test should fail")
console.assert(results[2].error.includes("timed out") || results[2].error.includes("Timeout"), "should be timeout error")
console.assert(results[3].status === "pass", "flaky test should pass after retries")
console.assert(results[3].attempts === 3, `flaky test should take 3 attempts, got ${results[3].attempts}`)
console.assert(results[4].status === "fail", "error test should fail even with retry")
console.assert(results[4].attempts === 2, "error test should attempt twice")

console.log("\n✓ timeout-and-retry passed")
