import { expect, test } from "vitest"
import { scope, sleep, yieldNow } from "../src/index.js"

test("scope waits for multiple tasks", async () => {
  let count = 0
  await scope(async s => {
    s.spawn(async () => { await sleep(5); count++ })
    s.spawn(async () => { await sleep(5); count++ })
  })
  expect(count).toBe(2)
})

test("scope returns after tasks complete", async () => {
  const result = await scope(async s => {
    s.spawn(async () => {
      await sleep(5)
    })
    return 10
  })
  expect(result).toBe(10)
})

test("scope does not resolve before tasks finish", async () => {
  let done = false
  const p = scope(async s => {
    s.spawn(async () => {
      await sleep(10)
      done = true
    })
  })
  await sleep(1)
  expect(done).toBe(false)
  await p
})

test("empty scope resolves immediately", async () => {
  const result = await scope(async () => 5)
  expect(result).toBe(5)
})

test("scope handles sync tasks", async () => {
  let ran = false
  await scope(async s => {
    s.spawn(() => {
      ran = true
    })
  })
  expect(ran).toBe(true)
})

test("scope handles mixed tasks", async () => {
  let a = false
  let b = false
  await scope(async s => {
    s.spawn(() => { a = true })
    s.spawn(async () => {
      await sleep(5)
      b = true
    })
  })
  expect(a).toBe(true)
  expect(b).toBe(true)
})

test("scope throws if root function throws", async () => {
  await expect(
    scope(async () => {
      throw new Error("root fail")
    })
  ).rejects.toThrow("root fail")
})

test("root error cancels tasks", async () => {
  let ran = false
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(20)
        ran = true
      })
      throw new Error("fail")
    })
  ).rejects.toThrow("fail")
  expect(ran).toBe(false)
})

test("scope waits after early return", async () => {
  let done = false
  await scope(async s => {
    s.spawn(async () => {
      await sleep(5)
      done = true
    })
    return
  })
  expect(done).toBe(true)
})

test("scope handles many fast tasks", async () => {
  let count = 0
  await scope(async s => {
    for (let i = 0; i < 100; i++) {
      s.spawn(() => count++)
    }
  })
  expect(count).toBe(100)
})

test("scope handles immediate resolve tasks", async () => {
  let count = 0
  await scope(async s => {
    s.spawn(async () => count++)
    s.spawn(async () => count++)
  })
  expect(count).toBe(2)
})

test("scope handles yielding tasks", async () => {
  let done = false
  await scope(async s => {
    s.spawn(async () => {
      await yieldNow()
      done = true
    })
  })
  expect(done).toBe(true)
})

test("scope allows awaiting spawned tasks", async () => {
  const result = await scope(async s => {
    const t = s.spawn(async () => 5)
    return await t
  })
  expect(result).toBe(5)
})

test("scope handles dependent tasks", async () => {
  let x = 0
  await scope(async s => {
    const t = s.spawn(async () => {
      await sleep(5)
      x = 1
    })
    s.spawn(async () => {
      await t
      x = 2
    })
  })
  expect(x).toBe(2)
})

test("scope preserves logical ordering via await", async () => {
  const order: number[] = []
  await scope(async s => {
    const t = s.spawn(async () => {
      await sleep(5)
      order.push(1)
    })
    await t
    order.push(2)
  })
  expect(order).toEqual([1, 2])
})

test("nested scope return does not break parent", async () => {
  const result = await scope(async s => {
    s.spawn(async () => {
      const inner = await scope(async () => 5)
      expect(inner).toBe(5)
    })
    return 10
  })
  expect(result).toBe(10)
})

test("scope handles rapid spawn burst", async () => {
  let count = 0
  await scope(async s => {
    for (let i = 0; i < 200; i++) {
      s.spawn(() => count++)
    }
  })
  expect(count).toBe(200)
})

test("no task leakage after scope exit", async () => {
  let done = false
  await scope(async s => {
    s.spawn(async () => {
      await sleep(5)
      done = true
    })
  })
  await sleep(10)
  expect(done).toBe(true)
})

// --- ScopeOptions validation ---

test("limit: 0 throws TypeError", () => {
  expect(() => scope({ limit: 0 }, async () => {})).toThrow(TypeError)
})

test("limit: -1 throws TypeError", () => {
  expect(() => scope({ limit: -1 }, async () => {})).toThrow(TypeError)
})

test("limit: NaN throws TypeError", () => {
  expect(() => scope({ limit: NaN }, async () => {})).toThrow(TypeError)
})

test("limit: 1.5 throws TypeError", () => {
  expect(() => scope({ limit: 1.5 }, async () => {})).toThrow(TypeError)
})

test("limit: Infinity throws TypeError", () => {
  expect(() => scope({ limit: Infinity }, async () => {})).toThrow(TypeError)
})

test("timeout: -1 throws TypeError", () => {
  expect(() => scope({ timeout: -1 }, async () => {})).toThrow(TypeError)
})

test("timeout: NaN throws TypeError", () => {
  expect(() => scope({ timeout: NaN }, async () => {})).toThrow(TypeError)
})

test("timeout: Infinity throws TypeError", () => {
  expect(() => scope({ timeout: Infinity }, async () => {})).toThrow(TypeError)
})

test("deadline: NaN throws TypeError", () => {
  expect(() => scope({ deadline: NaN }, async () => {})).toThrow(TypeError)
})

test("deadline: Infinity throws TypeError", () => {
  expect(() => scope({ deadline: Infinity }, async () => {})).toThrow(TypeError)
})
