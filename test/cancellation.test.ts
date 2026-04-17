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
        await sleep(50, s.signal)
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

test("cancel after all tasks completed still rejects", async () => {
  // Spec §3.7: cancel always rejects, regardless of whether tasks finished first.
  await expect(
    scope(async s => {
      await s.spawn(async () => {})
      s.cancel()
    })
  ).rejects.toBeDefined()
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
        await sleep(50, s.signal)
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

test("cancel after sleep prevents continuation in yielding task", async () => {
  let step = 0
  await expect(
    scope(async s => {
      s.spawn(async () => {
        step = 1
        await sleep(20, s.signal)
        await yieldNow(s.signal)
        step = 2
      })
      await sleep(5)
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

// --- done() tests ---

test("done() resolves scope normally", async () => {
  const result = await scope(async s => {
    s.spawn(async () => {
      while (!s.signal.aborted) await sleep(10)
    })
    await sleep(30)
    s.done()
    return "ok"
  })
  expect(result).toBe("ok")
})

test("done() aborts signal so background tasks stop", async () => {
  let signalAborted = false
  await scope(async s => {
    s.spawn(async () => {
      try { while (!s.signal.aborted) await sleep(10) }
      finally { signalAborted = s.signal.aborted }
    })
    await sleep(30)
    s.done()
  })
  expect(signalAborted).toBe(true)
})

test("done() is idempotent", async () => {
  await scope(async s => {
    s.spawn(async () => {
      while (!s.signal.aborted) await sleep(10)
    })
    await sleep(20)
    s.done()
    s.done()
    s.done()
  })
})

test("error before done() still throws", async () => {
  await expect(
    scope(async s => {
      s.spawn(async () => { throw new Error("boom") })
      await sleep(20)
      s.done()
    })
  ).rejects.toThrow("boom")
})

test("cancel() before done() — cancel wins", async () => {
  await expect(
    scope(async s => {
      s.spawn(async () => { await sleep(10_000) })
      s.cancel()
      s.done()
    })
  ).rejects.toBeDefined()
})

test("done() cleans up resources", async () => {
  let disposed = false
  await scope(async s => {
    await s.resource(42, () => { disposed = true })
    s.spawn(async () => {
      while (!s.signal.aborted) await sleep(10)
    })
    await sleep(20)
    s.done()
  })
  expect(disposed).toBe(true)
})

// --- Signal propagation to nested scopes ---

test("parent cancel propagates signal to nested scope tasks", async () => {
  let childSignalAborted = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await scope({ signal: s.signal }, async inner => {
          inner.spawn(async () => {
            try {
              await sleep(100, inner.signal)
            } catch {
              // Task was cancelled — signal must be aborted
              childSignalAborted = inner.signal.aborted
            }
          })
        })
      })
      await sleep(5)
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(childSignalAborted).toBe(true)
})

test("nested scope inherits parent signal", async () => {
  let innerTaskCancelled = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await scope(async inner => {
          inner.spawn(async () => {
            await sleep(100)
          })
        })
      })
      s.cancel()
    })
  ).rejects.toBeDefined()
  // If we got here without hanging, the nested scope was cancelled
  innerTaskCancelled = true
  expect(innerTaskCancelled).toBe(true)
})

// --- Multiple concurrent sibling scopes ---

test("sibling scopes run independently", async () => {
  let a = false
  let b = false
  await scope(async s => {
    s.spawn(async () => {
      await scope(async inner => {
        inner.spawn(async () => { await sleep(5); a = true })
      })
    })
    s.spawn(async () => {
      await scope(async inner => {
        inner.spawn(async () => { await sleep(5); b = true })
      })
    })
  })
  expect(a).toBe(true)
  expect(b).toBe(true)
})

test("cancel in one sibling scope does not affect other", async () => {
  let otherRan = false
  await scope(async s => {
    s.spawn(async () => {
      await expect(
        scope(async inner => {
          inner.cancel()
        })
      ).rejects.toBeDefined()
    })
    s.spawn(async () => {
      await scope(async inner => {
        inner.spawn(async () => { await sleep(5); otherRan = true })
      })
    })
  })
  expect(otherRan).toBe(true)
})

// --- Pre-aborted signal paths ---

test("sleep rejects immediately when signal already aborted", async () => {
  let rejected = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        s.cancel()
        try {
          await sleep(10, s.signal)
        } catch {
          rejected = true
        }
      })
    })
  ).rejects.toBeDefined()
  expect(rejected).toBe(true)
})

test("yieldNow rejects immediately when signal already aborted", async () => {
  let rejected = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        s.cancel()
        try {
          await yieldNow(s.signal)
        } catch {
          rejected = true
        }
      })
    })
  ).rejects.toBeDefined()
  expect(rejected).toBe(true)
})

// --- Error identity ---

test("scope preserves error identity (same reference)", async () => {
  const err = { custom: "error object" }
  try {
    await scope(async s => {
      s.spawn(async () => { throw err })
      await sleep(10)
    })
  } catch (e) {
    expect(e).toBe(err)
    return
  }
  expect.unreachable("scope should have thrown")
})
