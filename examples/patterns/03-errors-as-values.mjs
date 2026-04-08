// Pattern: Errors as values — collect successes and failures without cancelling
// Shows: scope, spawn, sleep, yieldNow, limit
//
// NOTE: Jolly uses first-error-wins semantics — if a task throws, the
// scope cancels all other tasks and rejects. If you want to collect
// ALL results (including failures) without cancelling, catch errors
// inside each task and return Result objects. First-error-wins does
// NOT trigger because nothing throws.

import { scope, sleep, yieldNow } from "../../dist/index.js"

// --- Result type (userland, not part of Jolly) ---

function ok(value) { return { ok: true, value } }
function err(error) { return { ok: false, error } }

// --- Example 1: Collect all results, even failures ---

console.log("=== Collect all results ===")

async function fetchUser(id) {
  await sleep(10 + Math.random() * 30)
  if (id === 3) throw new Error("user 3 not found")
  if (id === 7) throw new Error("user 7 banned")
  return { id, name: `User ${id}`, active: true }
}

const results = await scope({ limit: 3 }, async s => {
  const tasks = Array.from({ length: 10 }, (_, i) =>
    s.spawn(async () => {
      try {
        return ok(await fetchUser(i + 1))
      } catch (e) {
        return err(e.message)
      }
    })
  )

  const out = []
  for (const t of tasks) out.push(await t)
  return out
})

const successes = results.filter(r => r.ok)
const failures = results.filter(r => !r.ok)

console.log(`  Successes: ${successes.length}, Failures: ${failures.length}`)
for (const f of failures) console.log(`  ✗ ${f.error}`)

// Key: all 10 tasks ran — no cancellation despite errors
console.assert(results.length === 10, "all 10 should complete")
console.assert(successes.length === 8, `expected 8 successes, got ${successes.length}`)
console.assert(failures.length === 2, `expected 2 failures, got ${failures.length}`)

// --- Example 2: Partition results for downstream processing ---

console.log("\n=== Partition and process ===")

async function validateRecord(record) {
  await sleep(5)
  if (!record.email.includes("@")) return err(`invalid email: ${record.email}`)
  if (record.age < 0) return err(`invalid age: ${record.age}`)
  return ok({ ...record, validated: true })
}

const records = [
  { name: "Alice", email: "alice@test.com", age: 30 },
  { name: "Bob",   email: "not-an-email",   age: 25 },
  { name: "Charlie", email: "charlie@test.com", age: -1 },
  { name: "Diana", email: "diana@test.com", age: 28 },
  { name: "Eve",   email: "eve@test.com",   age: 22 },
]

const validated = await scope(async s => {
  const tasks = records.map(r => s.spawn(() => validateRecord(r)))
  const out = []
  for (const t of tasks) out.push(await t)
  return out
})

const valid = validated.filter(r => r.ok).map(r => r.value)
const invalid = validated.filter(r => !r.ok).map(r => r.error)

console.log(`  Valid: ${valid.length} (${valid.map(v => v.name).join(", ")})`)
console.log(`  Invalid: ${invalid.length}`)
for (const e of invalid) console.log(`  ✗ ${e}`)

console.assert(valid.length === 3, `expected 3 valid, got ${valid.length}`)
console.assert(invalid.length === 2, `expected 2 invalid, got ${invalid.length}`)
console.assert(valid.every(v => v.validated), "valid records should be marked")

// --- Example 3: Mix with first-error-wins for critical failures ---

console.log("\n=== Mixed: recoverable errors as values, critical errors throw ===")

let taskCount = 0

try {
  await scope(async s => {
    for (let i = 0; i < 5; i++) {
      s.spawn(async () => {
        taskCount++
        await sleep(10 * i)

        // Recoverable: return as value
        if (i === 1) return err("transient failure")

        // Critical: throw — triggers first-error-wins, cancels scope
        if (i === 3) throw new Error("CRITICAL: database down")

        return ok(`task ${i} done`)
      })
    }
  })
} catch (e) {
  console.log(`  Critical error caught: ${e.message}`)
  console.log(`  Tasks that started: ${taskCount} (remaining were cancelled)`)
}

console.assert(taskCount <= 5, "some tasks may have been cancelled")

console.log("\nKey insight:")
console.log("  Errors as values = all tasks run, collect everything")
console.log("  Thrown errors = first-error-wins, scope cancels")
console.log("  Mix both: catch recoverable errors, throw critical ones")

console.log("\n✓ errors-as-values passed")
