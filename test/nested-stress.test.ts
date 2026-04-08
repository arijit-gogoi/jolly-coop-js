import { expect, test } from "vitest"
import { scope, sleep, yieldNow } from "../src/index.js"

// --- Nested Scope Tests ---

test("nested scope waits for inner tasks", async () => {
  let done = false
  await scope(async s => {
    s.spawn(async () => {
      await scope(async inner => {
        inner.spawn(async () => {
          await sleep(5)
          done = true
        })
      })
    })
  })
  expect(done).toBe(true)
})

test("inner scope error does not cancel siblings in parent", async () => {
  let outerRan = false
  await scope(async s => {
    s.spawn(async () => {
      await expect(
        scope(async inner => {
          inner.spawn(async () => {
            throw new Error("fail")
          })
        })
      ).rejects.toThrow()
    })
    s.spawn(async () => {
      outerRan = true
    })
  })
  expect(outerRan).toBe(true)
})

test("parent error cancels nested scopes", async () => {
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
      throw new Error("fail")
    })
  ).rejects.toThrow()
  expect(ran).toBe(false)
})

test("nested scope return value works", async () => {
  const result = await scope(async s => {
    const t = s.spawn(async () => {
      return await scope(async () => 5)
    })
    return await t
  })
  expect(result).toBe(5)
})

test("deep nested scopes complete", async () => {
  let depth = 0
  await scope(async s => {
    s.spawn(async () => {
      await scope(async () => {
        await scope(async () => {
          await scope(async () => {
            depth = 3
          })
        })
      })
    })
  })
  expect(depth).toBe(3)
})

test("nested scopes respect limits independently", async () => {
  let max = 0
  let running = 0
  await scope(async s => {
    s.spawn(async () => {
      await scope({ limit: 1 }, async inner => {
        inner.spawn(async () => {
          running++
          max = Math.max(max, running)
          await sleep(5)
          running--
        })
        inner.spawn(async () => {
          running++
          max = Math.max(max, running)
          await sleep(5)
          running--
        })
      })
    })
  })
  expect(max).toBe(1)
})

test("child scope cancel does not cancel parent", async () => {
  let parentRan = false
  await scope(async s => {
    s.spawn(async () => {
      await expect(
        scope(async inner => {
          inner.cancel()
        })
      ).rejects.toBeDefined()
    })
    parentRan = true
  })
  expect(parentRan).toBe(true)
})

test("nested resource cleanup ordering", async () => {
  const order: number[] = []
  await scope(async s => {
    await s.resource({}, () => order.push(1))
    await scope(async inner => {
      await inner.resource({}, () => order.push(2))
    })
  })
  expect(order).toEqual([2, 1])
})

// --- Stress Tests ---

test("massive task burst", async () => {
  let count = 0
  await scope(async s => {
    for (let i = 0; i < 10000; i++) {
      s.spawn(() => count++)
    }
  })
  expect(count).toBe(10000)
})

test("massive async task burst", async () => {
  let count = 0
  await scope(async s => {
    for (let i = 0; i < 2000; i++) {
      s.spawn(async () => {
        await sleep(1)
        count++
      })
    }
  })
  expect(count).toBe(2000)
}, 30000)

test("many nested scopes under load", async () => {
  await scope(async s => {
    for (let i = 0; i < 200; i++) {
      s.spawn(async () => {
        await scope(async inner => {
          inner.spawn(async () => {})
        })
      })
    }
  })
})

test("rapid spawn and cancel cycles", async () => {
  for (let i = 0; i < 20; i++) {
    await expect(
      scope(async s => {
        for (let j = 0; j < 20; j++) {
          s.spawn(async () => {
            await sleep(10)
          })
        }
        s.cancel()
      })
    ).rejects.toBeDefined()
  }
})

test("stress with limits", async () => {
  let count = 0
  await scope({ limit: 5 }, async s => {
    for (let i = 0; i < 100; i++) {
      s.spawn(async () => {
        await sleep(1)
        count++
      })
    }
  })
  expect(count).toBe(100)
}, 30000)

test("stress yield-heavy tasks", async () => {
  let count = 0
  await scope(async s => {
    for (let i = 0; i < 100; i++) {
      s.spawn(async () => {
        for (let j = 0; j < 10; j++) {
          await yieldNow()
        }
        count++
      })
    }
  })
  expect(count).toBe(100)
})

test("stress mixed operations", async () => {
  let count = 0
  await scope(async s => {
    for (let i = 0; i < 100; i++) {
      s.spawn(async () => {
        await sleep(1)
        await yieldNow()
        count++
      })
    }
  })
  expect(count).toBe(100)
}, 30000)

test("no logical task leakage under stress", async () => {
  let count = 0
  await scope(async s => {
    for (let i = 0; i < 500; i++) {
      s.spawn(async () => {
        await sleep(1)
        count++
      })
    }
  })
  expect(count).toBe(500)
}, 30000)
