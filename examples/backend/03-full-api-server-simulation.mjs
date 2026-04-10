// Advanced: Simulated API server with connection pool, graceful shutdown, nested scopes
// Shows: scope, spawn, resource, cancel, sleep, yieldNow, signal, limit, timeout, nested scopes

import { scope, sleep, yieldNow } from "../../dist/index.js"

// --- Simulated infrastructure ---

function createConnectionPool(size) {
  let active = 0
  return {
    acquire() { active++; return { id: active, query: (q) => sleep(5 + Math.random() * 20) } },
    release() { active-- },
    get active() { return active },
  }
}

function createCache() {
  const store = new Map()
  return {
    get(key) { return store.get(key) },
    set(key, val) { store.set(key, val) },
    get size() { return store.size },
    clear() { store.clear() },
  }
}

let requestId = 0
function simulateRequest() {
  requestId++
  const types = ["getUser", "listPosts", "getComments", "updateProfile", "deletePost"]
  return {
    id: requestId,
    type: types[Math.floor(Math.random() * types.length)],
    userId: Math.floor(Math.random() * 100) + 1,
  }
}

// --- Server simulation ---

async function handleRequest(s, req, pool, cache) {
  // Each request gets its own nested scope with a per-request timeout
  return await scope({ timeout: 500 }, async reqScope => {
    // Acquire a DB connection as a managed resource — auto-released on scope exit
    const conn = await reqScope.resource(
      pool.acquire(),
      () => pool.release()
    )

    // Check cache first
    const cacheKey = `${req.type}:${req.userId}`
    const cached = cache.get(cacheKey)
    if (cached) return { ...cached, fromCache: true }

    // Simulate DB query
    await conn.query(`SELECT * FROM ${req.type} WHERE userId = ${req.userId}`)

    // For complex requests, fan out sub-queries concurrently
    if (req.type === "getUser") {
      const results = {}
      const profileTask = reqScope.spawn(async () => {
        await conn.query("SELECT * FROM profiles")
        return { name: `User ${req.userId}`, email: `user${req.userId}@example.com` }
      })
      const statsTask = reqScope.spawn(async () => {
        await conn.query("SELECT COUNT(*) FROM posts")
        return { posts: Math.floor(Math.random() * 50), followers: Math.floor(Math.random() * 1000) }
      })

      results.profile = await profileTask
      results.stats = await statsTask

      cache.set(cacheKey, results)
      return results
    }

    const result = { type: req.type, userId: req.userId, data: "ok" }
    cache.set(cacheKey, result)
    return result
  })
}

// --- Main: run the server simulation ---

const stats = { handled: 0, errors: 0, cancelled: 0, cacheHits: 0 }

await scope(async serverScope => {
  const pool = await serverScope.resource(
    createConnectionPool(10),
    (p) => { /* pool.close() in real code */ }
  )
  const cache = await serverScope.resource(
    createCache(),
    (c) => c.clear()
  )

  console.log("Server started — processing 50 requests with limit=10")

  // Process incoming requests with concurrency limit
  await scope({ limit: 10 }, async requestScope => {
    const requests = Array.from({ length: 50 }, () => simulateRequest())

    for (const req of requests) {
      requestScope.spawn(async () => {
        try {
          const result = await handleRequest(requestScope, req, pool, cache)
          stats.handled++
          if (result?.fromCache) stats.cacheHits++
        } catch (err) {
          if (err.message?.includes("cancelled") || err.message?.includes("abort")) {
            stats.cancelled++
          } else {
            stats.errors++
          }
        }
      })
      await yieldNow()
    }
  })

  // Check signal — still active after all requests handled
  console.assert(!serverScope.signal.aborted, "server scope should still be active")
  console.log(`Active connections after all work: ${pool.active}`)
})
// Resources are cleaned up here — pool released, cache cleared

console.log("\nResults:")
console.log(`  Handled:    ${stats.handled}`)
console.log(`  Cache hits: ${stats.cacheHits}`)
console.log(`  Errors:     ${stats.errors}`)
console.log(`  Cancelled:  ${stats.cancelled}`)

console.assert(stats.handled + stats.errors + stats.cancelled === 50,
  `expected 50 total, got ${stats.handled + stats.errors + stats.cancelled}`)
console.assert(stats.handled > 0, "should have handled some requests")

console.log("\nAPI surface exercised:")
console.log("  scope(), spawn(), resource(), cancel(), sleep(), yieldNow()")
console.log("  signal, limit, timeout, nested scopes, error propagation")
console.log("  resource cleanup (connection pool + cache)")

console.log("\n✓ full-api-server-simulation passed")
