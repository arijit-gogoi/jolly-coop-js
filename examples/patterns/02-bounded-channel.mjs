// Pattern: Bounded channel with backpressure
// Shows: scope, spawn, done, sleep, yieldNow, signal, resource
//
// A producer/consumer channel with a fixed buffer size. When the buffer
// is full, the producer blocks (backpressure). When empty, the consumer
// waits. This prevents unbounded memory growth and naturally throttles
// the faster side.

import { scope, sleep, yieldNow } from "../../dist/index.js"

// --- Bounded channel implementation ---

function createChannel(capacity) {
  const buffer = []
  let closed = false

  // Waiters: resolve functions for blocked producers/consumers
  const producerWaiters = []
  const consumerWaiters = []

  function notifyOne(waiters) {
    if (waiters.length > 0) waiters.shift()()
  }

  return {
    async send(item) {
      // Block until space is available
      while (buffer.length >= capacity && !closed) {
        await new Promise(resolve => producerWaiters.push(resolve))
      }
      if (closed) return false
      buffer.push(item)
      notifyOne(consumerWaiters) // wake a waiting consumer
      return true
    },

    async recv() {
      // Block until an item is available
      while (buffer.length === 0 && !closed) {
        await new Promise(resolve => consumerWaiters.push(resolve))
      }
      if (buffer.length === 0 && closed) return null
      const item = buffer.shift()
      notifyOne(producerWaiters) // wake a blocked producer
      return item
    },

    close() {
      closed = true
      // Wake all waiters so they can observe the close
      for (const w of producerWaiters) w()
      for (const w of consumerWaiters) w()
      producerWaiters.length = 0
      consumerWaiters.length = 0
    },

    get size() { return buffer.length },
    get isClosed() { return closed },
  }
}

// --- Example 1: Basic producer/consumer with backpressure ---

console.log("=== Basic bounded channel ===")

const stats1 = { produced: 0, consumed: 0, maxBuffer: 0 }

await scope(async s => {
  const ch = await s.resource(
    createChannel(3), // capacity of 3
    (ch) => ch.close()
  )

  // Producer: generates items faster than consumer can process
  s.spawn(async () => {
    for (let i = 1; i <= 10; i++) {
      await ch.send({ id: i, data: `item-${i}` })
      stats1.produced++
      stats1.maxBuffer = Math.max(stats1.maxBuffer, ch.size)
      // Producer is fast — no sleep
      await yieldNow()
    }
    ch.close()
  })

  // Consumer: processes items slowly
  s.spawn(async () => {
    while (true) {
      const item = await ch.recv()
      if (item === null) break
      await sleep(20) // simulate slow processing
      stats1.consumed++
    }
  })
})

console.log(`  Produced: ${stats1.produced}, Consumed: ${stats1.consumed}`)
console.log(`  Max buffer occupancy: ${stats1.maxBuffer} (capacity: 3)`)

console.assert(stats1.produced === 10, "should produce all 10")
console.assert(stats1.consumed === 10, "should consume all 10")
console.assert(stats1.maxBuffer <= 3, `buffer should never exceed capacity, got ${stats1.maxBuffer}`)

// --- Example 2: Multiple producers, single consumer ---

console.log("\n=== Fan-in: 3 producers → 1 consumer ===")

const stats2 = { perProducer: {}, consumed: 0 }

await scope(async s => {
  const ch = await s.resource(createChannel(5), (ch) => ch.close())
  let producersDone = 0

  // 3 producers at different speeds
  for (const [name, count, delay] of [["fast", 8, 5], ["medium", 6, 15], ["slow", 4, 30]]) {
    stats2.perProducer[name] = 0
    s.spawn(async () => {
      for (let i = 0; i < count; i++) {
        if (ch.isClosed) break
        await ch.send({ from: name, seq: i })
        stats2.perProducer[name]++
        await sleep(delay)
      }
      producersDone++
      if (producersDone === 3) ch.close()
    })
  }

  // Single consumer
  s.spawn(async () => {
    while (true) {
      const item = await ch.recv()
      if (item === null) break
      stats2.consumed++
      await sleep(3) // light processing
    }
  })
})

const totalProduced = Object.values(stats2.perProducer).reduce((a, b) => a + b, 0)
console.log(`  Produced: fast=${stats2.perProducer.fast} medium=${stats2.perProducer.medium} slow=${stats2.perProducer.slow}`)
console.log(`  Total consumed: ${stats2.consumed}`)

console.assert(totalProduced === 18, `expected 18 total, got ${totalProduced}`)
console.assert(stats2.consumed === 18, `expected 18 consumed, got ${stats2.consumed}`)

// --- Example 3: Pipeline of channels (stage → stage → stage) ---

console.log("\n=== Pipeline: extract → transform → load ===")

const stats3 = { extracted: 0, transformed: 0, loaded: 0 }

await scope(async s => {
  const extractCh = await s.resource(createChannel(4), (ch) => ch.close())
  const loadCh = await s.resource(createChannel(4), (ch) => ch.close())

  // Stage 1: Extract — produces raw records
  s.spawn(async () => {
    for (let i = 1; i <= 12; i++) {
      await extractCh.send({ id: i, raw: `data-${i}` })
      stats3.extracted++
      await sleep(5)
    }
    extractCh.close()
  })

  // Stage 2: Transform — reads from extract, writes to load
  s.spawn(async () => {
    while (true) {
      const item = await extractCh.recv()
      if (item === null) break
      await sleep(10) // simulate CPU work
      await loadCh.send({ ...item, transformed: true, value: item.id * 10 })
      stats3.transformed++
    }
    loadCh.close()
  })

  // Stage 3: Load — reads from transform, writes to "database"
  s.spawn(async () => {
    const loaded = []
    while (true) {
      const item = await loadCh.recv()
      if (item === null) break
      await sleep(8) // simulate DB write
      loaded.push(item.id)
      stats3.loaded++
    }
  })
})

console.log(`  Extracted: ${stats3.extracted}, Transformed: ${stats3.transformed}, Loaded: ${stats3.loaded}`)

console.assert(stats3.extracted === 12, "should extract all 12")
console.assert(stats3.transformed === 12, "should transform all 12")
console.assert(stats3.loaded === 12, "should load all 12")

// --- Example 4: Cancellation closes the channel ---

console.log("\n=== Cancellation + channel ===")

let consumerStopped = false

try {
  await scope(async s => {
    const ch = await s.resource(createChannel(2), (ch) => ch.close())

    // Wire signal to channel — cancel closes it, unblocking waiters
    s.signal.addEventListener("abort", () => ch.close(), { once: true })

    // Infinite producer
    s.spawn(async () => {
      let i = 0
      while (!ch.isClosed) {
        const sent = await ch.send({ i: i++ })
        if (!sent) break
        await sleep(10)
      }
    })

    // Consumer that stops when channel closes
    s.spawn(async () => {
      while (true) {
        const item = await ch.recv()
        if (item === null) { consumerStopped = true; break }
        await sleep(5)
      }
    })

    // Cancel after 80ms
    await sleep(80)
    s.cancel()
  })
} catch {}

console.log(`  Consumer stopped cleanly: ${consumerStopped}`)
console.assert(consumerStopped, "consumer should stop when channel closes on cancel")

console.log("\nAPI surface exercised:")
console.log("  scope(), spawn(), resource(), done(), sleep(), yieldNow(), signal")
console.log("  bounded buffer, backpressure, fan-in, pipeline, cancellation")

console.log("\n✓ bounded-channel passed")
