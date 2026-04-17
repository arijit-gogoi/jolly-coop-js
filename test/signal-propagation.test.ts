// Coverage gaps identified during ultrareview 2026-04-17:
// 1. Multi-await cancellation (2+ sleeps per task, cancel between them)
// 2. Nested scope created after first await — inherits parent signal via options.signal
// 3. yieldNow after first await
// 4. done() reason on signal (ScopeDoneError)

import { expect, test } from "vitest"
import { scope, sleep, yieldNow, ScopeDoneError } from "../src/index.js"

// --- Gap 1: Multi-await cancellation ---

test("cancel interrupts sleep after first await in task body", async () => {
  let sideEffect = false
  const t0 = performance.now()
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(5, s.signal)       // first sleep — resolves normally
        await sleep(500, s.signal)     // second sleep — must be interrupted by cancel
        sideEffect = true
      })
      await sleep(50)
      s.cancel()
    })
  ).rejects.toBeDefined()
  const elapsed = performance.now() - t0
  expect(sideEffect).toBe(false)
  // Second sleep should reject at ~50ms, not run its full 500ms
  expect(elapsed).toBeLessThan(200)
})

test("cancel interrupts third sleep in task body", async () => {
  let reached = 0
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(5, s.signal); reached = 1
        await sleep(5, s.signal); reached = 2
        await sleep(500, s.signal); reached = 3
      })
      await sleep(50)
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(reached).toBe(2)
})

// --- Gap 2: Nested scope created after first await ---

test("nested scope spawned after first await inherits parent signal", async () => {
  let innerSleepRan = false
  const t0 = performance.now()
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(5, s.signal)
        // Nested scope created AFTER first await — parent signal must thread through
        await scope({ signal: s.signal }, async inner => {
          inner.spawn(async () => {
            await sleep(500, inner.signal)
            innerSleepRan = true
          })
        })
      })
      await sleep(30)
      s.cancel()
    })
  ).rejects.toBeDefined()
  const elapsed = performance.now() - t0
  expect(innerSleepRan).toBe(false)
  expect(elapsed).toBeLessThan(200)
})

// --- Gap 3: yieldNow after first await ---

test("yieldNow rejects when signal aborts during yield", async () => {
  let afterYield = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(5, s.signal)
        // Pre-cancel the signal manually via a peer
        while (!s.signal.aborted) {
          await yieldNow(s.signal)
        }
        afterYield = true
      })
      await sleep(10)
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(afterYield).toBe(false)
})

test("yieldNow with pre-aborted signal rejects immediately", async () => {
  let caught = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(5, s.signal)
        s.cancel()
        try {
          await yieldNow(s.signal)
        } catch {
          caught = true
        }
      })
    })
  ).rejects.toBeDefined()
  expect(caught).toBe(true)
})

// --- Gap 4: done() reason on signal ---

test("done() sets ScopeDoneError as signal reason", async () => {
  let observedReason: unknown = null
  await scope(async s => {
    s.spawn(async () => {
      while (!s.signal.aborted) await sleep(5, s.signal).catch(() => {})
      observedReason = s.signal.reason
    })
    await sleep(10)
    s.done()
  })
  expect(observedReason).toBeInstanceOf(ScopeDoneError)
})

test("cancel() sets non-ScopeDoneError reason on signal", async () => {
  let observedReason: unknown = null
  await expect(
    scope(async s => {
      s.spawn(async () => {
        while (!s.signal.aborted) await sleep(5, s.signal).catch(() => {})
        observedReason = s.signal.reason
      })
      await sleep(10)
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(observedReason).not.toBeInstanceOf(ScopeDoneError)
})

test("cancel with custom reason preserves reason on signal", async () => {
  const customReason = { code: "USER_ABORT" }
  let observedReason: unknown = null
  await expect(
    scope(async s => {
      s.spawn(async () => {
        while (!s.signal.aborted) await sleep(5, s.signal).catch(() => {})
        observedReason = s.signal.reason
      })
      await sleep(10)
      s.cancel(customReason)
    })
  ).rejects.toBe(customReason)
  expect(observedReason).toBe(customReason)
})
