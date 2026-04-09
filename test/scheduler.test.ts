import { expect, test } from "vitest"
import { scope, sleep, yieldNow, _resetScheduler } from "../src/index.js"

test("multiple yields interleave tasks", async () => {
  const order: number[] = []
  await scope(async s => {
    s.spawn(async () => {
      order.push(1)
      await yieldNow()
      order.push(3)
      await yieldNow()
      order.push(5)
    })
    s.spawn(async () => {
      order.push(2)
      await yieldNow()
      order.push(4)
    })
  })
  expect(order).toEqual([1, 2, 3, 4, 5])
})

test("long task yields allow others", async () => {
  let ran = false
  await scope(async s => {
    s.spawn(async () => {
      for (let i = 0; i < 5; i++) {
        await yieldNow()
      }
    })
    s.spawn(async () => {
      ran = true
    })
  })
  expect(ran).toBe(true)
})

test("no starvation with many short tasks", async () => {
  let ran = false
  await scope(async s => {
    for (let i = 0; i < 100; i++) {
      s.spawn(async () => {})
    }
    s.spawn(async () => {
      ran = true
    })
  })
  expect(ran).toBe(true)
})

test("tasks execute FIFO without yields", async () => {
  const order: number[] = []
  await scope(async s => {
    s.spawn(() => order.push(1))
    s.spawn(() => order.push(2))
    s.spawn(() => order.push(3))
  })
  expect(order).toEqual([1, 2, 3])
})

test("yield allows later task to run first", async () => {
  const order: number[] = []
  await scope(async s => {
    s.spawn(async () => {
      order.push(1)
      await yieldNow()
      order.push(3)
    })
    s.spawn(() => order.push(2))
  })
  expect(order).toEqual([1, 2, 3])
})

test("deep yield chains do not break scheduler", async () => {
  let count = 0
  await scope(async s => {
    s.spawn(async () => {
      for (let i = 0; i < 50; i++) {
        await yieldNow()
      }
      count++
    })
  })
  expect(count).toBe(1)
})

test("scheduler handles mixed sleep and yield", async () => {
  const order: number[] = []
  await scope(async s => {
    s.spawn(async () => {
      order.push(1)
      await sleep(5)
      order.push(3)
    })
    s.spawn(async () => {
      order.push(2)
      await yieldNow()
      order.push(4)
    })
  })
  expect(order).toContain(1)
  expect(order).toContain(2)
  expect(order).toContain(3)
  expect(order).toContain(4)
})

test("scheduler stable under many yields", async () => {
  let count = 0
  await scope(async s => {
    for (let i = 0; i < 100; i++) {
      s.spawn(async () => {
        await yieldNow()
        count++
      })
    }
  })
  expect(count).toBe(100)
})

// --- _resetScheduler tests ---

test("_resetScheduler clears scheduler state", async () => {
  // Run some work, reset, then verify new work runs cleanly
  await scope(async s => {
    s.spawn(() => {})
  })
  _resetScheduler()
  let ran = false
  await scope(async s => {
    s.spawn(() => { ran = true })
  })
  expect(ran).toBe(true)
})

test("_resetScheduler allows clean signal context", async () => {
  // After reset, nested scopes should work without stale signal
  _resetScheduler()
  const result = await scope(async s => {
    const t = s.spawn(async () => 42)
    return await t
  })
  expect(result).toBe(42)
})

test("scheduler handles work after large burst", async () => {
  // Large burst triggers ring buffer growth; after completion + shrink,
  // new work should still execute correctly
  let count = 0
  await scope(async s => {
    for (let i = 0; i < 10000; i++) {
      s.spawn(() => { count++ })
    }
  })
  expect(count).toBe(10000)

  // Now spawn a small batch — scheduler should still work after shrink
  let ran = false
  await scope(async s => {
    s.spawn(() => { ran = true })
  })
  expect(ran).toBe(true)
})
