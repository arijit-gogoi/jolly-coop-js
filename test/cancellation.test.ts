import { expect, test } from "vitest"
import { scope, sleep, yieldNow } from "../src/index.js"

test("cancel prevents new spawns from running", async () => {
  let ran = false
  await expect(
    scope(async s => {
      s.cancel()
      s.spawn(async () => {
        ran = true
      })
    })
  ).rejects.toBeDefined()
  expect(ran).toBe(false)
})

test("cancel before spawn results in no execution", async () => {
  let ran = false
  await expect(
    scope(async s => {
      s.cancel()
      s.spawn(async () => {
        ran = true
      })
    })
  ).rejects.toBeDefined()
  expect(ran).toBe(false)
})

test("cancel stops task continuation after await", async () => {
  let step = 0
  await expect(
    scope(async s => {
      s.spawn(async () => {
        step = 1
        await sleep(50)
        step = 2
      })
      await sleep(5)
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(step).toBe(1)
})

test("cancel propagates deeply", async () => {
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

test("cancel after completion has no effect", async () => {
  await scope(async s => {
    await s.spawn(async () => {})
    s.cancel()
  })
})

test("multiple cancel calls are stable", async () => {
  await expect(
    scope(async s => {
      s.cancel()
      s.cancel()
      s.cancel()
    })
  ).rejects.toBeDefined()
})

test("cancel prevents queued tasks under limit", async () => {
  let started = 0
  await expect(
    scope({ limit: 1 }, async s => {
      for (let i = 0; i < 3; i++) {
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

test("cancel while awaiting child task", async () => {
  await expect(
    scope(async s => {
      const t = s.spawn(async () => {
        await sleep(50)
      })
      s.cancel()
      await t
    })
  ).rejects.toBeDefined()
})

test("cancel propagates through task dependencies", async () => {
  let ran = false
  await expect(
    scope(async s => {
      const t1 = s.spawn(async () => {
        await sleep(50)
        return 1
      })
      s.spawn(async () => {
        await t1
        ran = true
      })
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(ran).toBe(false)
})

test("cancel wins over slow completion", async () => {
  let finished = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(50)
        finished = true
      })
      await sleep(5)
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(finished).toBe(false)
})

test("cancel before error prevents error propagation", async () => {
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(10)
        throw new Error("fail")
      })
      s.cancel()
    })
  ).rejects.toBeDefined()
})

test("error before cancel wins", async () => {
  await expect(
    scope(async s => {
      s.spawn(async () => {
        throw new Error("fail")
      })
      await sleep(1)
      s.cancel()
    })
  ).rejects.toThrow("fail")
})

test("inner cancel does not cancel outer scope", async () => {
  let outerRan = false
  await scope(async s => {
    s.spawn(async () => {
      await expect(
        scope(async inner => {
          inner.cancel()
        })
      ).rejects.toBeDefined()
    })
    outerRan = true
  })
  expect(outerRan).toBe(true)
})

test("cancel after yield prevents continuation", async () => {
  let step = 0
  await expect(
    scope(async s => {
      s.spawn(async () => {
        step = 1
        await yieldNow()
        step = 2
      })
      // yieldNow orders correctly with task continuations via microtask deferral
      await yieldNow()
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(step).toBe(1)
})

test("cancel stops tasks spawning children", async () => {
  let ran = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        s.spawn(async () => {
          ran = true
        })
        await sleep(50)
      })
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(ran).toBe(false)
})

test("scope rejects on cancel", async () => {
  await expect(
    scope(async s => {
      s.cancel()
    })
  ).rejects.toBeDefined()
})

test("cancel with no tasks rejects scope", async () => {
  await expect(
    scope(async s => {
      s.cancel()
    })
  ).rejects.toBeDefined()
})

test("cancel prevents task completion after cancellation", async () => {
  let finished = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(50)
        finished = true
      })
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(finished).toBe(false)
})
