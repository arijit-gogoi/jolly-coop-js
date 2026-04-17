import { expect, test } from "vitest"
import { scope, sleep, yieldNow } from "../src/index.js"

test("limit=1 enforces sequential execution", async () => {
  const order: number[] = []
  await scope({ limit: 1 }, async s => {
    s.spawn(async () => {
      order.push(1)
      await sleep(5)
      order.push(2)
    })
    s.spawn(async () => {
      order.push(3)
    })
  })
  expect(order).toEqual([1, 2, 3])
})

test("high limit allows concurrent execution", async () => {
  let running = 0
  let max = 0
  await scope({ limit: 100 }, async s => {
    for (let i = 0; i < 10; i++) {
      s.spawn(async () => {
        running++
        max = Math.max(max, running)
        await sleep(5)
        running--
      })
    }
  })
  expect(max).toBeGreaterThan(1)
})

test("limit exact boundary respected", async () => {
  let running = 0
  let max = 0
  await scope({ limit: 3 }, async s => {
    for (let i = 0; i < 6; i++) {
      s.spawn(async () => {
        running++
        max = Math.max(max, running)
        await sleep(5)
        running--
      })
    }
  })
  expect(max).toBeLessThanOrEqual(3)
})

test("queue drains as tasks complete", async () => {
  let completed = 0
  await scope({ limit: 2 }, async s => {
    for (let i = 0; i < 5; i++) {
      s.spawn(async () => {
        await sleep(5)
        completed++
      })
    }
  })
  expect(completed).toBe(5)
})

test("queued task starts when slot frees", async () => {
  let task2Ran = false
  await scope({ limit: 1 }, async s => {
    s.spawn(async () => {
      await sleep(5)
    })
    s.spawn(async () => {
      task2Ran = true
    })
  })
  expect(task2Ran).toBe(true)
})

test("limit works with sync tasks", async () => {
  let running = 0
  let max = 0
  await scope({ limit: 2 }, async s => {
    for (let i = 0; i < 5; i++) {
      s.spawn(() => {
        running++
        max = Math.max(max, running)
        running--
      })
    }
  })
  expect(max).toBeLessThanOrEqual(2)
})

test("limit works with mixed tasks", async () => {
  let running = 0
  let max = 0
  await scope({ limit: 2 }, async s => {
    s.spawn(() => {
      running++
      max = Math.max(max, running)
      running--
    })
    s.spawn(async () => {
      running++
      max = Math.max(max, running)
      await sleep(5)
      running--
    })
    s.spawn(async () => {
      running++
      max = Math.max(max, running)
      await sleep(5)
      running--
    })
  })
  expect(max).toBeLessThanOrEqual(2)
})

test("limit handles large queue", async () => {
  let count = 0
  await scope({ limit: 3 }, async s => {
    for (let i = 0; i < 20; i++) {
      s.spawn(async () => {
        await sleep(1)
        count++
      })
    }
  })
  expect(count).toBe(20)
})

test("queued tasks execute in order", async () => {
  const order: number[] = []
  await scope({ limit: 1 }, async s => {
    s.spawn(async () => {
      await sleep(5)
      order.push(1)
    })
    s.spawn(async () => order.push(2))
    s.spawn(async () => order.push(3))
  })
  expect(order).toEqual([1, 2, 3])
})

test("slot released when task fails", async () => {
  let ran = false
  await expect(
    scope({ limit: 1 }, async s => {
      s.spawn(async () => {
        throw new Error("fail")
      })
      s.spawn(async () => {
        ran = true
      })
    })
  ).rejects.toThrow()
  expect(ran).toBe(false)
})

test("slot released on cancellation", async () => {
  let started = 0
  await expect(
    scope({ limit: 1 }, async s => {
      s.spawn(async () => {
        started++
        await sleep(50)
      })
      s.spawn(async () => {
        started++
      })
      await sleep(5)
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(started).toBe(1)
})

test("limit does not deadlock with task dependencies", async () => {
  await scope({ limit: 1 }, async s => {
    const t1 = s.spawn(async () => 1)
    s.spawn(async () => {
      await t1
    })
  })
})

test("limit works with yieldNow", async () => {
  let running = 0
  let max = 0
  await scope({ limit: 2 }, async s => {
    for (let i = 0; i < 5; i++) {
      s.spawn(async () => {
        running++
        max = Math.max(max, running)
        await yieldNow()
        running--
      })
    }
  })
  expect(max).toBeLessThanOrEqual(2)
})

// --- Limit edge cases ---

test("cancel drains limit queue without running queued tasks", async () => {
  const ran: number[] = []
  await expect(
    scope({ limit: 1 }, async s => {
      s.spawn(async () => {
        ran.push(1)
        await sleep(20)
      })
      s.spawn(async () => { ran.push(2) })
      s.spawn(async () => { ran.push(3) })
      await sleep(5)
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(ran).toEqual([1])
})

test("slot freed by locally-handled failure allows queued task to run", async () => {
  // To handle an expected failure, catch inside the task body.
  // A bare throw triggers fail-fast and cancels the scope.
  let secondRan = false
  let caught = false
  await scope({ limit: 1 }, async s => {
    s.spawn(async () => {
      try { throw new Error("fail") } catch { caught = true }
    })
    s.spawn(async () => {
      secondRan = true
    })
  })
  expect(caught).toBe(true)
  expect(secondRan).toBe(true)
})

test("scheduled task cancelled before execution with limit", async () => {
  // limit=2: first task cancels scope, second is already scheduled but not yet executed
  const ran: number[] = []
  await expect(
    scope({ limit: 2 }, async s => {
      s.spawn(() => {
        ran.push(1)
        s.cancel()
      })
      s.spawn(() => { ran.push(2) })
    })
  ).rejects.toBeDefined()
  // First task ran and cancelled; second was scheduled but cancelled before execution
  expect(ran).toEqual([1])
})

test("cancel during running task cleans up scheduled queued tasks", async () => {
  const ran: number[] = []
  await expect(
    scope({ limit: 1 }, async s => {
      s.spawn(async () => {
        ran.push(1)
        await sleep(10, s.signal)
        ran.push(2)
      })
      // These get queued behind limit
      s.spawn(async () => { ran.push(3) })
      s.spawn(async () => { ran.push(4) })
      // Cancel while first task is running — queued tasks should not execute
      await sleep(2)
      s.cancel()
    })
  ).rejects.toBeDefined()
  // Only first task started; queued tasks never ran
  expect(ran).toEqual([1])
})

test("active count reflects queued tasks", async () => {
  let activeAfterSpawn = 0
  await scope({ limit: 1 }, async s => {
    s.spawn(async () => { await sleep(5) })
    s.spawn(async () => {})
    s.spawn(async () => {})
    activeAfterSpawn = s.active
  })
  expect(activeAfterSpawn).toBe(3)
})
