import { expect, test } from "vitest"
import { scope, sleep, yieldNow } from "../src/index.js"

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
