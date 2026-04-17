import { expect, test } from "vitest"
import { scope, sleep, yieldNow } from "../src/index.js"

// 1. Scope waits for all tasks
test("scope waits for all tasks", async () => {
  let done = false
  await scope(async s => {
    s.spawn(async () => {
      await sleep(10)
      done = true
    })
  })
  expect(done).toBe(true)
})

// 2. Scope waits for nested tasks
test("scope waits for nested tasks", async () => {
  let done = false
  await scope(async s => {
    s.spawn(async () => {
      await scope(async inner => {
        inner.spawn(async () => {
          await sleep(10)
          done = true
        })
      })
    })
  })
  expect(done).toBe(true)
})

// 3. Task resolves value
test("task resolves value", async () => {
  await scope(async s => {
    const t = s.spawn(async () => 42)
    const result = await t
    expect(result).toBe(42)
  })
})

// 4. Task completes exactly once
test("task completes exactly once", async () => {
  let runs = 0
  await scope(async s => {
    const t = s.spawn(async () => {
      runs++
    })
    await t
  })
  expect(runs).toBe(1)
})

// 5. Error cancels sibling tasks
test("error cancels sibling tasks", async () => {
  let ran = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        throw new Error("fail")
      })
      s.spawn(async () => {
        await sleep(20, s.signal)
        ran = true
      })
    })
  ).rejects.toThrow("fail")
  expect(ran).toBe(false)
})

// 6. Cancel prevents queued tasks
test("cancel prevents queued tasks", async () => {
  let started = 0
  await expect(
    scope({ limit: 1 }, async s => {
      for (let i = 0; i < 5; i++) {
        s.spawn(async () => {
          started++
          await sleep(50)
        })
      }
      await sleep(5)
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(started).toBe(1)
})

// 7. Limit enforces max concurrency
test("limit enforces max concurrency", async () => {
  let running = 0
  let max = 0
  await scope({ limit: 2 }, async s => {
    for (let i = 0; i < 5; i++) {
      s.spawn(async () => {
        running++
        max = Math.max(max, running)
        await sleep(10)
        running--
      })
    }
  })
  expect(max).toBeLessThanOrEqual(2)
})

// 8. Queued tasks eventually run
test("queued tasks eventually run", async () => {
  let count = 0
  await scope({ limit: 1 }, async s => {
    for (let i = 0; i < 3; i++) {
      s.spawn(async () => {
        await sleep(5)
        count++
      })
    }
  })
  expect(count).toBe(3)
})

// 9. Resource cleanup happens after tasks
test("resource cleanup happens after tasks", async () => {
  const order: string[] = []
  await scope(async s => {
    await s.resource({}, () => {
      order.push("cleanup")
    })
    s.spawn(async () => {
      order.push("task")
    })
  })
  expect(order).toEqual(["task", "cleanup"])
})

// 10. Resources cleaned in reverse order
test("resources cleaned in reverse order", async () => {
  const order: number[] = []
  await scope(async s => {
    await s.resource({}, () => { order.push(1) })
    await s.resource({}, () => { order.push(2) })
  })
  expect(order).toEqual([2, 1])
})

// 11. Timeout cancels running tasks
test("timeout cancels running tasks", async () => {
  await expect(
    scope({ timeout: 10 }, async s => {
      s.spawn(async () => {
        await sleep(50)
      })
    })
  ).rejects.toBeDefined()
})

// 12. Completes before timeout
test("completes before timeout", async () => {
  const result = await scope({ timeout: 100 }, async s => {
    const t = s.spawn(async () => {
      await sleep(10)
      return 7
    })
    return await t
  })
  expect(result).toBe(7)
})

// 13. Yield allows interleaving
test("yield allows interleaving", async () => {
  const order: number[] = []
  await scope(async s => {
    s.spawn(async () => {
      order.push(1)
      await yieldNow()
      order.push(3)
    })
    s.spawn(async () => {
      order.push(2)
    })
  })
  expect(order).toEqual([1, 2, 3])
})

// 14. Scheduler does not starve tasks
test("scheduler does not starve tasks", async () => {
  let ran = false
  await scope(async s => {
    for (let i = 0; i < 1000; i++) {
      s.spawn(async () => {})
    }
    s.spawn(async () => {
      ran = true
    })
  })
  expect(ran).toBe(true)
})

// 15. Nested scope failure propagates
test("nested scope failure propagates", async () => {
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await scope(async inner => {
          inner.spawn(async () => {
            throw new Error("fail")
          })
        })
      })
    })
  ).rejects.toThrow("fail")
})

// 16. Nested cancellation propagates
test("nested cancellation propagates", async () => {
  let ran = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await scope(async inner => {
          inner.spawn(async () => {
            await sleep(50)
            ran = true
          })
        })
      })
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(ran).toBe(false)
})

// 17. Handles thousands of tasks
test("handles thousands of tasks", async () => {
  let count = 0
  await scope(async s => {
    for (let i = 0; i < 5000; i++) {
      s.spawn(() => count++)
    }
  })
  expect(count).toBe(5000)
})

// 18. Deep nested scopes stress
test("deep nested scopes stress", async () => {
  await scope(async s => {
    for (let i = 0; i < 100; i++) {
      s.spawn(async () => {
        await scope(async inner => {
          inner.spawn(async () => {})
        })
      })
    }
  })
})
