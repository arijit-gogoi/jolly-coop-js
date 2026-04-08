import { expect, test } from "vitest"
import { scope, sleep, yieldNow } from "../src/index.js"

test("task rejection propagates to await", async () => {
  await scope(async s => {
    const t = s.spawn(async () => {
      throw new Error("boom")
    })
    await expect(t).rejects.toThrow("boom")
  })
})

test("task state becomes completed", async () => {
  await scope(async s => {
    const t = s.spawn(async () => 1)
    await t
    expect(t.state).toBe("completed")
  })
})

test("task state becomes failed", async () => {
  await scope(async s => {
    const t = s.spawn(async () => {
      throw new Error("fail")
    })
    await expect(t).rejects.toThrow()
    expect(t.state).toBe("failed")
  })
})

test("task state becomes cancelled", async () => {
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

test("task starts in running state", async () => {
  await scope(async s => {
    const t = s.spawn(async () => {
      await sleep(5)
    })
    expect(t.state).toBe("running")
    await t
  })
})

test("task does not change state after completion", async () => {
  await scope(async s => {
    const t = s.spawn(async () => 1)
    await t
    const state = t.state
    expect(t.state).toBe(state)
  })
})

test("task executes only once", async () => {
  let runs = 0
  await scope(async s => {
    const t = s.spawn(async () => {
      runs++
    })
    await t
    await t
  })
  expect(runs).toBe(1)
})

test("awaiting task multiple times returns same value", async () => {
  await scope(async s => {
    const t = s.spawn(async () => 5)
    const a = await t
    const b = await t
    expect(a).toBe(5)
    expect(b).toBe(5)
  })
})

test("task resolves after await suspension", async () => {
  await scope(async s => {
    const t = s.spawn(async () => {
      await sleep(5)
      return 10
    })
    expect(await t).toBe(10)
  })
})

test("task yields and resumes", async () => {
  let step = 0
  await scope(async s => {
    const t = s.spawn(async () => {
      step = 1
      await yieldNow()
      step = 2
    })
    await t
  })
  expect(step).toBe(2)
})

test("task stops after cancellation", async () => {
  let ran = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(50)
        ran = true
      })
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(ran).toBe(false)
})

test("task cancelled before execution does not run", async () => {
  let ran = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        ran = true
      })
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(ran).toBe(false)
})

test("task failure state set once", async () => {
  await scope(async s => {
    const t = s.spawn(async () => {
      throw new Error("fail")
    })
    await expect(t).rejects.toThrow()
    expect(t.state).toBe("failed")
  })
})

test("task then behaves like Promise", async () => {
  await scope(async s => {
    const t = s.spawn(async () => 3)
    const result = await t.then(x => x * 2)
    expect(result).toBe(6)
  })
})

test("task chaining works", async () => {
  await scope(async s => {
    const t = s.spawn(async () => 2)
    const result = await t.then(x => x + 3)
    expect(result).toBe(5)
  })
})

test("task propagates error through then", async () => {
  await scope(async s => {
    const t = s.spawn(async () => {
      throw new Error("fail")
    })
    await expect(t.then(() => {})).rejects.toThrow("fail")
  })
})

test("task can await another task", async () => {
  await scope(async s => {
    const t1 = s.spawn(async () => 5)
    const t2 = s.spawn(async () => {
      return await t1
    })
    expect(await t2).toBe(5)
  })
})

test("task completion reduces active count", async () => {
  await scope(async s => {
    const t = s.spawn(async () => 1)
    expect(s.active).toBeGreaterThan(0)
    await t
    expect(s.active).toBe(0)
  })
})
