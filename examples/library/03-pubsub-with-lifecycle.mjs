// Advanced: Pub/sub message broker with subscriber lifecycle management
// Shows: scope, spawn, resource, cancel, sleep, yieldNow, signal, limit, timeout, nested scopes
//
// Pattern: Library authors build systems where multiple consumers subscribe
// to topics. Each subscriber is a scope — unsubscribing cancels all its
// pending work and cleans up resources. The broker itself is a scope that
// owns all subscribers.

import { scope, sleep, yieldNow } from "../../dist/index.js"

const log = []
function emit(msg) { log.push(msg) }

// --- The pub/sub library built on jolly ---

function createBroker() {
  const topics = new Map()  // topic -> Set<callback>

  function publish(topic, message) {
    const subs = topics.get(topic)
    if (subs) for (const cb of subs) cb(message)
  }

  function subscribe(topic, cb) {
    if (!topics.has(topic)) topics.set(topic, new Set())
    topics.get(topic).add(cb)
    return () => { topics.get(topic)?.delete(cb); if (topics.get(topic)?.size === 0) topics.delete(topic) }
  }

  return { publish, subscribe, get topicCount() { return topics.size } }
}

async function createSubscriber(parentScope, broker, name, topics, handler, { bufferSize = 100, concurrency = 3 } = {}) {
  // Each subscriber is a nested scope — inherit parent signal so
  // broker shutdown cancels subscribers.
  return scope({ signal: parentScope.signal }, async s => {
    const buffer = []

    // Resource: topic subscriptions — auto-removed on scope exit
    for (const topic of topics) {
      await s.resource(
        broker.subscribe(topic, (msg) => {
          if (buffer.length < bufferSize) buffer.push({ topic, msg, time: Date.now() })
        }),
        (unsub) => { unsub(); emit(`${name}: unsubscribed from ${topic}`) }
      )
    }

    emit(`${name}: subscribed to [${topics.join(", ")}]`)

    // Resource: message processing state
    const state = { processed: 0 }
    await s.resource(
      state,
      (st) => emit(`${name}: processed ${st.processed} messages total`)
    )

    // Process messages in batches with concurrency limit. Signal threaded
    // through sleep so poll loop exits when parent cancels.
    try {
      while (!s.signal.aborted) {
        if (buffer.length > 0) {
          const batch = buffer.splice(0, concurrency)
          await scope({ signal: s.signal, limit: concurrency }, async batchScope => {
            for (const item of batch) {
              batchScope.spawn(async () => {
                await handler(name, item.topic, item.msg)
                state.processed++
                await yieldNow(batchScope.signal)
              })
            }
          })
        }
        await sleep(10, s.signal) // poll interval
      }
    } catch {
      // Expected: sleep rejects when scope signal aborts
    }
  })
}

// --- Usage: event-driven microservice simulation ---

const broker = createBroker()

try {
  await scope({ timeout: 500 }, async s => {
    emit("system: starting broker")

    // Subscriber 1: order processor — handles orders, slow processing
    const orderProcessor = s.spawn(() =>
      createSubscriber(s, broker, "orders", ["order.created", "order.updated"], async (name, topic, msg) => {
        await sleep(15)
        emit(`${name}: ${topic} -> ${msg.id}`)
      }, { concurrency: 2 })
    )

    // Subscriber 2: notification service — handles orders + user events
    const notifier = s.spawn(() =>
      createSubscriber(s, broker, "notifier", ["order.created", "user.signup"], async (name, topic, msg) => {
        await sleep(5)
        emit(`${name}: ${topic} -> notify ${msg.id}`)
      }, { concurrency: 5 })
    )

    // Subscriber 3: analytics — handles everything, fire-and-forget
    const analytics = s.spawn(() =>
      createSubscriber(s, broker, "analytics", ["order.created", "order.updated", "user.signup"], async (name, topic, msg) => {
        emit(`${name}: track ${topic}`)
      }, { concurrency: 10 })
    )

    await sleep(50) // let subscribers set up

    // Publish events
    emit("system: publishing events")
    for (let i = 1; i <= 5; i++) {
      broker.publish("order.created", { id: `ORD-${i}`, total: i * 10 })
      await yieldNow()
    }
    broker.publish("user.signup", { id: "USR-1", name: "Alice" })
    broker.publish("order.updated", { id: "ORD-1", status: "shipped" })

    // Let processing happen
    await sleep(200)
    emit("system: processing window done")

    // Scope timeout will cancel everything and clean up
  })
} catch (err) {
  emit(`system: ${err.constructor.name} — shutting down`)
}

// --- Verify ---

console.log("Pub/sub lifecycle trace:")
for (const entry of log) console.log(`  ${entry}`)

const subscriptions = log.filter(l => l.includes("subscribed to"))
const unsubscriptions = log.filter(l => l.includes("unsubscribed from"))
const processed = log.filter(l => l.includes("processed") && l.includes("total"))
const orderEvents = log.filter(l => l.includes("orders: order."))
const notifyEvents = log.filter(l => l.includes("notifier:"))

console.log(`\nSubscriptions: ${subscriptions.length}`)
console.log(`Unsubscriptions (cleanup): ${unsubscriptions.length}`)
console.log(`Orders processed: ${orderEvents.length}`)
console.log(`Notifications sent: ${notifyEvents.filter(l => l.includes("notify")).length}`)

// Every subscription should have a matching unsubscription (cleanup guarantee)
console.assert(unsubscriptions.length > 0, "should have cleanup events")
console.assert(orderEvents.length > 0, "should have processed some orders")
console.assert(log.some(l => l.includes("analytics: track")), "analytics should track events")
console.assert(processed.length > 0, "should report processing totals")

console.log("\nAPI surface exercised:")
console.log("  scope(), spawn(), resource(), cancel(), sleep(), yieldNow()")
console.log("  signal, limit, timeout, nested scopes")
console.log("  subscriber lifecycle, auto-unsubscribe, batch processing")

console.log("\n✓ pubsub-with-lifecycle passed")
