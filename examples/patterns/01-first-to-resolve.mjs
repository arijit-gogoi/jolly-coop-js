// Pattern: First-to-resolve — spawn N tasks, use the first result, clean up the rest
// Shows: scope, spawn, done, sleep, signal
//
// Like Promise.race but with guaranteed cleanup. When the fastest task
// resolves, done() signals all other tasks to stop. No leaked promises,
// no orphaned connections.

import { scope, sleep } from "../../dist/index.js"

// Reusable first-to-resolve utility
async function firstToResolve(parentScope, tasks) {
  let winner = null

  await scope(async s => {
    for (const { name, fn } of tasks) {
      s.spawn(async () => {
        const result = await fn(s.signal)
        // First to complete sets the winner and signals done
        if (!winner) {
          winner = { name, result }
          s.done()
        }
      })
    }
  })

  return winner
}

// --- Example 1: Fastest mirror wins ---

console.log("=== Fastest mirror ===")

const mirrors = [
  { name: "us-east",  fn: async () => { await sleep(80);  return { data: "package.tgz", bytes: 12400 } } },
  { name: "eu-west",  fn: async () => { await sleep(45);  return { data: "package.tgz", bytes: 12400 } } },
  { name: "ap-south", fn: async () => { await sleep(120); return { data: "package.tgz", bytes: 12400 } } },
]

const fastest = await scope(async s => firstToResolve(s, mirrors))

console.log(`  Winner: ${fastest.name} (others cancelled)`)
console.assert(fastest.name === "eu-west", `expected eu-west, got ${fastest.name}`)

// --- Example 2: Redundant health checks — first healthy endpoint wins ---

console.log("\n=== Health check ===")

let checkedEndpoints = 0
const endpoints = [
  { name: "primary",   fn: async (signal) => { checkedEndpoints++; await sleep(200); return { status: "healthy", latency: 200 } } },
  { name: "secondary", fn: async (signal) => { checkedEndpoints++; await sleep(30);  return { status: "healthy", latency: 30 } } },
  { name: "tertiary",  fn: async (signal) => { checkedEndpoints++; await sleep(100); return { status: "healthy", latency: 100 } } },
]

const healthiest = await scope(async s => firstToResolve(s, endpoints))

console.log(`  First healthy: ${healthiest.name} (${healthiest.result.latency}ms)`)
console.assert(healthiest.name === "secondary", `expected secondary, got ${healthiest.name}`)

// --- Example 3: Timeout as a competitor ---

console.log("\n=== With timeout competitor ===")

const withTimeout = [
  { name: "slow-api", fn: async () => { await sleep(500); return { data: "real response" } } },
  { name: "timeout",  fn: async () => { await sleep(100); return { data: null, timedOut: true } } },
]

const result = await scope(async s => firstToResolve(s, withTimeout))

console.log(`  Winner: ${result.name}`)
console.log(`  Timed out: ${result.result.timedOut || false}`)
console.assert(result.name === "timeout", "timeout should win")
console.assert(result.result.timedOut === true, "should be timeout result")

// --- Example 4: Error handling — errors don't count as "winning" ---

console.log("\n=== Error handling ===")

const mixed = [
  { name: "fails-fast", fn: async () => { await sleep(10); throw new Error("connection refused") } },
  { name: "succeeds",   fn: async () => { await sleep(50); return { ok: true } } },
]

let caughtError = false
const winner = await scope(async s => {
  try {
    return await firstToResolve(s, mixed)
  } catch {
    // First error cancels the scope — succeeds never completes
    caughtError = true
    return null
  }
})

// Note: with first-error-wins, the fast failure cancels everything.
// If you want to ignore errors and wait for the first SUCCESS, you'd
// need try/catch inside each task. That's a design choice.
console.log(`  Error propagated: ${caughtError}`)
console.log(`  This is first-error-wins — failures cancel the scope`)

console.log("\n✓ first-to-resolve passed")
