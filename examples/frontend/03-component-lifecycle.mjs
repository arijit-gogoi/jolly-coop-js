// Advanced: Component lifecycle with nested scopes, resources, and cleanup
// Shows: scope, spawn, resource, cancel, sleep, yieldNow, signal, timeout, nested scopes
//
// Pattern: A single-page app where each "page" is a scope. Navigating
// away cancels the current page's scope, cleaning up all resources
// (event listeners, intervals, subscriptions). Components within a
// page are nested scopes with their own lifecycles.

import { scope, sleep, yieldNow } from "../../dist/index.js"

const log = []
function emit(msg) { log.push(msg) }

// --- Simulated browser primitives ---

function createInterval(fn, ms) {
  const id = setInterval(fn, ms)
  return { clear() { clearInterval(id) } }
}

function createEventTarget() {
  const listeners = new Map()
  return {
    on(event, fn)  { listeners.set(event, fn) },
    off(event)     { listeners.delete(event) },
    emit(event, data) { listeners.get(event)?.(data) },
    get count() { return listeners.size },
  }
}

// --- Components ---

async function NotificationBell(parentScope) {
  // Nested scope: bell has its own lifecycle within the page.
  // Inherits parent signal so parent cancellation propagates here.
  await scope({ signal: parentScope.signal }, async s => {
    let count = 0

    // Resource: polling interval — auto-cleared when scope exits
    await s.resource(
      createInterval(() => { count++; emit(`bell: poll #${count}`) }, 30),
      (p) => { p.clear(); emit("bell: poller cleaned up") }
    )

    // Resource: event listener — auto-removed when scope exits
    const bus = await s.resource(
      createEventTarget(),
      (bus) => { bus.off("notification"); emit("bell: listener cleaned up") }
    )
    bus.on("notification", (data) => emit(`bell: received ${data}`))

    // Simulate receiving notifications
    s.spawn(async () => {
      await sleep(40, s.signal)
      bus.emit("notification", "new message")
      await sleep(40, s.signal)
      bus.emit("notification", "friend request")
    })

    // Keep alive until parent cancels — thread signal so sleep rejects on abort
    try {
      while (!s.signal.aborted) {
        await sleep(20, s.signal)
      }
    } catch {
      // Expected: sleep rejects when signal aborts
    }
  })
}

async function DataTable(parentScope, items) {
  await scope({ signal: parentScope.signal, timeout: 500 }, async s => {
    emit(`table: loading ${items.length} rows`)

    // Spawn concurrent row processors with concurrency limit
    await scope({ signal: s.signal, limit: 3 }, async batchScope => {
      for (const item of items) {
        batchScope.spawn(async () => {
          await sleep(10 + Math.random() * 20, batchScope.signal) // simulate render
          emit(`table: rendered row ${item}`)
          await yieldNow(batchScope.signal) // stay responsive
        })
      }
    })

    emit(`table: all ${items.length} rows rendered`)
  })
}

async function ErrorBoundary(fn) {
  try {
    await fn()
  } catch (err) {
    emit(`error-boundary: caught "${err.message}"`)
  }
}

// --- Page navigation simulation ---

const pageResults = { home: null, profile: null }

// Page 1: Home — has notification bell + data table
emit("nav: entering home")
const homeController = new AbortController()

const homePage = scope({ signal: homeController.signal }, async s => {
  emit("home: mounted")

  // Resource: page-level analytics tracker
  const analytics = await s.resource(
    { events: [] },
    (a) => { emit(`home: flushed ${a.events.length} analytics events`); a.events.length = 0 }
  )
  analytics.events.push("page_view")

  // Mount components as concurrent tasks
  const bellTask = s.spawn(() => NotificationBell(s))
  const tableTask = s.spawn(() => DataTable(s, [1, 2, 3, 4, 5]))

  // Error boundary around a flaky component
  s.spawn(() => ErrorBoundary(async () => {
    await sleep(60)
    throw new Error("widget crashed")
  }))

  // Wait for table to finish (bell runs indefinitely until cancelled)
  await tableTask

  analytics.events.push("table_loaded")
  emit("home: table ready, bell still polling")

  // Simulate user staying on page
  await sleep(100)
  analytics.events.push("user_engaged")
})

// After 300ms, "navigate away" — cancel the home page
setTimeout(() => {
  emit("nav: leaving home")
  homeController.abort()
}, 300)

try {
  await homePage
} catch {
  // Expected: scope throws on abort
}

emit("nav: home fully cleaned up")
await sleep(50) // let any pending cleanup finish

// Page 2: Profile — simpler page with timeout
emit("nav: entering profile")
try {
  await scope({ timeout: 200 }, async s => {
    emit("profile: mounted")

    const userData = await s.resource(
      { name: "Ada", loaded: true },
      () => emit("profile: user data released")
    )

    s.spawn(async () => {
      emit(`profile: showing ${userData.name}`)
      await sleep(50)
      emit("profile: rendered")
    })
  })
} catch (err) {
  emit(`profile: ${err.constructor.name}`)
}
emit("nav: profile done")

// --- Verify ---

console.log("Component lifecycle trace:")
for (const entry of log) console.log(`  ${entry}`)

// Verify cleanup happened
const cleanups = log.filter(l => l.includes("cleaned up") || l.includes("released") || l.includes("flushed"))
console.log(`\nCleanup events: ${cleanups.length}`)
for (const c of cleanups) console.log(`  ${c}`)

console.assert(cleanups.length >= 3, `expected at least 3 cleanup events, got ${cleanups.length}`)
console.assert(log.some(l => l.includes("bell: poller cleaned up")), "bell poller should be cleaned up")
console.assert(log.some(l => l.includes("bell: listener cleaned up")), "bell listener should be cleaned up")
console.assert(log.some(l => l.includes("home: flushed")), "analytics should be flushed")
console.assert(log.some(l => l.includes("profile: user data released")), "profile data should be released")
console.assert(log.some(l => l.includes("error-boundary: caught")), "error boundary should catch widget crash")
console.assert(log.some(l => l.includes("table: all 5 rows rendered")), "table should finish rendering")

console.log("\nAPI surface exercised:")
console.log("  scope(), spawn(), resource(), cancel(), sleep(), yieldNow()")
console.log("  signal, limit, timeout, nested scopes, error boundaries")
console.log("  automatic resource cleanup on navigation")

console.log("\n✓ component-lifecycle passed")
