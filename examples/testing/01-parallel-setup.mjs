// Basic: Concurrent test setup and teardown
// Shows: scope, spawn, sleep, resource
//
// Pattern: Test suites need setup (DB, cache, fixtures) before running.
// Jolly parallelizes setup, guarantees teardown even on failure.

import { scope, sleep } from "../../dist/index.js"

const log = []
function emit(msg) { log.push(msg) }

// Simulated test infrastructure
async function createTestDB() {
  await sleep(30)
  emit("setup: DB connected")
  return { query: async (q) => { await sleep(5); return [{ id: 1 }] }, name: "test_db" }
}

async function createTestCache() {
  await sleep(15)
  emit("setup: cache connected")
  return { get: (k) => null, set: (k, v) => {}, name: "test_cache" }
}

async function seedFixtures(db) {
  await sleep(20)
  emit("setup: fixtures seeded")
  return { users: 10, posts: 50 }
}

// --- Test suite ---

const results = []

await scope(async suite => {
  // Concurrent setup — all resources managed, auto-cleaned
  const db = await suite.resource(createTestDB(), (db) => emit(`teardown: ${db.name} disconnected`))
  const cache = await suite.resource(createTestCache(), (c) => emit(`teardown: ${c.name} cleared`))
  const fixtures = await seedFixtures(db)

  emit(`setup complete: ${fixtures.users} users, ${fixtures.posts} posts`)

  // Run tests
  const test1 = suite.spawn(async () => {
    const rows = await db.query("SELECT * FROM users")
    emit("test: query users — passed")
    return "pass"
  })

  const test2 = suite.spawn(async () => {
    cache.set("key", "value")
    emit("test: cache write — passed")
    return "pass"
  })

  const test3 = suite.spawn(async () => {
    const rows = await db.query("SELECT * FROM posts")
    emit("test: query posts — passed")
    return "pass"
  })

  results.push(await test1, await test2, await test3)
})
// Teardown runs here — DB and cache cleaned up

console.log("Test suite trace:")
for (const entry of log) console.log(`  ${entry}`)

console.log(`\nResults: ${results.filter(r => r === "pass").length}/${results.length} passed`)

console.assert(results.every(r => r === "pass"), "all tests should pass")
console.assert(log.some(l => l.includes("teardown: test_db")), "DB should be torn down")
console.assert(log.some(l => l.includes("teardown: test_cache")), "cache should be torn down")
console.assert(log.indexOf("setup complete") < log.indexOf("test:"), "setup should precede tests")

console.log("\n✓ parallel-setup passed")
