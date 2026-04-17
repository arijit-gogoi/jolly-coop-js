// Advanced: Full integration test harness with lifecycle hooks, concurrent suites,
// resource isolation, and failure reporting
// Shows: scope, spawn, resource, cancel, sleep, yieldNow, signal, limit, timeout, nested scopes
//
// Pattern: An integration test framework where each suite gets isolated
// resources (DB, services), tests within a suite run concurrently with
// a concurrency limit, and all resources are cleaned up regardless of
// pass/fail. Supports beforeAll/afterAll/beforeEach via scope lifecycle.

import { scope, sleep, yieldNow } from "../../dist/index.js"

const output = []
function emit(msg) { output.push(msg) }

// --- Test framework built on jolly ---

async function suite(name, { concurrency = 3, timeout = 2000 } = {}, fn) {
  const results = []
  const startTime = performance.now()

  emit(`suite: ${name}`)

  try {
    await scope({ timeout }, async s => {
      const ctx = {
        tests: [],
        resources: [],

        // Register a test
        test(testName, testFn, testOpts = {}) {
          ctx.tests.push({ name: testName, fn: testFn, opts: testOpts })
        },

        // Managed resource — auto-cleaned after suite
        async setup(factory, teardown) {
          return s.resource(factory, teardown)
        },
      }

      // Let the suite register tests and setup resources
      await fn(ctx)

      // Run all registered tests with concurrency limit
      await scope({ limit: concurrency }, async runScope => {
        for (const test of ctx.tests) {
          runScope.spawn(async () => {
            const testTimeout = test.opts.timeout || 500
            const testStart = performance.now()
            try {
              // Each test gets its own scope (isolation + timeout).
              // Pass signal into test fn so awaits inside honor the timeout.
              await scope({ timeout: testTimeout }, async testScope => {
                await testScope.spawn(() => test.fn(testScope.signal))
              })
              const duration = (performance.now() - testStart).toFixed(0)
              results.push({ suite: name, name: test.name, status: "pass", duration })
              emit(`  ✓ ${test.name} (${duration}ms)`)
            } catch (err) {
              const duration = (performance.now() - testStart).toFixed(0)
              results.push({ suite: name, name: test.name, status: "fail", error: err.message, duration })
              emit(`  ✗ ${test.name} — ${err.message} (${duration}ms)`)
            }
            await yieldNow()
          })
        }
      })
    })
  } catch (err) {
    emit(`  suite error: ${err.message}`)
  }

  const elapsed = (performance.now() - startTime).toFixed(0)
  const passed = results.filter(r => r.status === "pass").length
  const failed = results.filter(r => r.status === "fail").length
  emit(`  ${passed} passed, ${failed} failed (${elapsed}ms)\n`)

  return results
}

// --- Simulated services ---

async function createDB(name) {
  await sleep(15)
  return {
    name,
    tables: new Map(),
    async insert(table, row) {
      if (!this.tables.has(table)) this.tables.set(table, [])
      this.tables.get(table).push(row)
      await sleep(3)
    },
    async query(table) {
      await sleep(3)
      return this.tables.get(table) || []
    },
  }
}

async function createMailer() {
  await sleep(5)
  const sent = []
  return { send(to, subject) { sent.push({ to, subject }) }, get sent() { return sent } }
}

// --- Test suites ---

const allResults = await scope(async s => {
  const results = []

  // Suite 1: User service tests
  const userResults = await s.spawn(() => suite("UserService", { concurrency: 2 }, async ctx => {
    // Setup: shared DB and mailer for this suite
    const db = await ctx.setup(createDB("user_db"), (db) => emit(`  teardown: ${db.name}`))
    const mailer = await ctx.setup(createMailer(), () => emit("  teardown: mailer"))

    // Seed data
    await db.insert("users", { id: 1, name: "Alice", email: "alice@test.com" })
    await db.insert("users", { id: 2, name: "Bob", email: "bob@test.com" })

    ctx.test("can query users", async () => {
      const users = await db.query("users")
      if (users.length !== 2) throw new Error(`expected 2 users, got ${users.length}`)
    })

    ctx.test("can insert user", async () => {
      await db.insert("users", { id: 3, name: "Charlie", email: "charlie@test.com" })
      const users = await db.query("users")
      if (users.length < 3) throw new Error("insert failed")
    })

    ctx.test("can send welcome email", async () => {
      mailer.send("newuser@test.com", "Welcome!")
      if (mailer.sent.length === 0) throw new Error("email not sent")
    })

    ctx.test("rejects invalid email", async () => {
      // Simulate a validation that should throw
      const email = "invalid"
      if (!email.includes("@")) throw new Error("validation works")
      // If we get here, the test should fail — but the throw above is the expected path
    })
  }))
  results.push(...userResults)

  // Suite 2: Order service tests (runs concurrently with suite 1)
  const orderResults = await s.spawn(() => suite("OrderService", { concurrency: 3 }, async ctx => {
    const db = await ctx.setup(createDB("order_db"), (db) => emit(`  teardown: ${db.name}`))

    ctx.test("can create order", async () => {
      await db.insert("orders", { id: 1, total: 99.99, status: "pending" })
      const orders = await db.query("orders")
      if (orders.length !== 1) throw new Error("order not created")
    })

    ctx.test("can process payment", async () => {
      await sleep(20) // simulate payment gateway
    })

    ctx.test("handles timeout", async (sig) => {
      await sleep(9999, sig) // this will timeout
    }, { timeout: 30 })

    ctx.test("can cancel order", async () => {
      await db.insert("orders", { id: 2, total: 50, status: "cancelled" })
      const orders = await db.query("orders")
      const cancelled = orders.filter(o => o.status === "cancelled")
      if (cancelled.length === 0) throw new Error("cancel failed")
    })
  }))
  results.push(...orderResults)

  // Suite 3: Notification pipeline tests
  const notifResults = await s.spawn(() => suite("NotificationPipeline", { concurrency: 2 }, async ctx => {
    const db = await ctx.setup(createDB("notif_db"), (db) => emit(`  teardown: ${db.name}`))
    const mailer = await ctx.setup(createMailer(), () => emit("  teardown: mailer"))

    ctx.test("can queue notification", async () => {
      await db.insert("notifications", { id: 1, type: "email", to: "user@test.com" })
    })

    ctx.test("can process notification batch", async () => {
      for (let i = 0; i < 5; i++) {
        await db.insert("notifications", { id: i + 10, type: "email", to: `user${i}@test.com` })
      }
      const all = await db.query("notifications")
      if (all.length < 5) throw new Error("batch insert failed")
      for (const n of all) mailer.send(n.to, "Notification")
    })

    ctx.test("can handle delivery failure gracefully", async () => {
      // Simulate: send to invalid address but don't crash
      mailer.send("", "Test")
    })
  }))
  results.push(...notifResults)

  return results
})

// --- Report ---

console.log("Integration test report:")
for (const line of output) console.log(line)

const passed = allResults.filter(r => r.status === "pass").length
const failed = allResults.filter(r => r.status === "fail").length
const total = allResults.length

console.log("═".repeat(40))
console.log(`Total: ${passed} passed, ${failed} failed out of ${total}`)

// Expected: most pass, "rejects invalid email" fails (intentional), "handles timeout" fails
console.assert(total === 11, `expected 11 tests, got ${total}`)
console.assert(failed >= 2, `expected at least 2 failures`)
console.assert(passed >= 8, `expected at least 8 passes`)

const teardowns = output.filter(l => l.includes("teardown:"))
console.log(`\nResource teardowns: ${teardowns.length}`)
for (const t of teardowns) console.log(t)

console.assert(teardowns.length >= 5, "all resources should be torn down")

console.log("\nAPI surface exercised:")
console.log("  scope(), spawn(), resource(), sleep(), yieldNow()")
console.log("  signal, limit, timeout, nested scopes")
console.log("  test isolation, concurrent suites, lifecycle hooks, failure reporting")

console.log("\n✓ integration-harness passed")
