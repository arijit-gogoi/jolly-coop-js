import { expect, test } from "vitest"
import { scope, sleep } from "../src/index.js"

test("resource available inside tasks", async () => {
  let used = false
  await scope(async s => {
    const r = await s.resource({ value: 1 }, () => {})
    s.spawn(async () => {
      used = r.value === 1
    })
  })
  expect(used).toBe(true)
})

test("resource disposed even without tasks", async () => {
  let disposed = false
  await scope(async s => {
    await s.resource({}, () => {
      disposed = true
    })
  })
  expect(disposed).toBe(true)
})

test("resource disposed after async tasks complete", async () => {
  let disposed = false
  let finished = false
  await scope(async s => {
    await s.resource({}, () => {
      disposed = true
    })
    s.spawn(async () => {
      await sleep(5)
      finished = true
    })
  })
  expect(finished).toBe(true)
  expect(disposed).toBe(true)
})

test("resource not disposed before task finishes", async () => {
  let disposed = false
  let checked = false
  await scope(async s => {
    await s.resource({}, () => {
      disposed = true
    })
    s.spawn(async () => {
      await sleep(5)
      checked = !disposed
    })
  })
  expect(checked).toBe(true)
})

test("multiple resources all cleaned", async () => {
  let count = 0
  await scope(async s => {
    await s.resource({}, () => count++)
    await s.resource({}, () => count++)
    await s.resource({}, () => count++)
  })
  expect(count).toBe(3)
})

test("resource cleanup runs on error", async () => {
  let disposed = false
  await expect(
    scope(async s => {
      await s.resource({}, () => {
        disposed = true
      })
      throw new Error("fail")
    })
  ).rejects.toThrow()
  expect(disposed).toBe(true)
})

test("resource cleanup runs on cancel", async () => {
  let disposed = false
  await expect(
    scope(async s => {
      await s.resource({}, () => {
        disposed = true
      })
      s.cancel()
    })
  ).rejects.toBeDefined()
  expect(disposed).toBe(true)
})

test("resource disposer error is contained", async () => {
  await scope(async s => {
    await s.resource({}, () => {
      throw new Error("cleanup fail")
    })
  })
})

test("multiple cleanup continues after error", async () => {
  let ran = false
  await scope(async s => {
    await s.resource({}, () => {
      throw new Error("fail")
    })
    await s.resource({}, () => {
      ran = true
    })
  })
  expect(ran).toBe(true)
})

test("resource shared across tasks", async () => {
  let count = 0
  await scope(async s => {
    const r = await s.resource({ value: 1 }, () => {})
    s.spawn(() => count += r.value)
    s.spawn(() => count += r.value)
  })
  expect(count).toBe(2)
})

test("nested scope resources cleaned inner first", async () => {
  const order: number[] = []
  await scope(async s => {
    await s.resource({}, () => order.push(1))
    await scope(async inner => {
      await inner.resource({}, () => order.push(2))
    })
  })
  expect(order).toEqual([2, 1])
})

test("resource persists across awaits", async () => {
  let ok = false
  await scope(async s => {
    const r = await s.resource({ value: 1 }, () => {})
    s.spawn(async () => {
      await sleep(5)
      ok = r.value === 1
    })
  })
  expect(ok).toBe(true)
})

test("resource not leaked after scope exit", async () => {
  let disposed = false
  await scope(async s => {
    await s.resource({}, () => {
      disposed = true
    })
  })
  await sleep(5)
  expect(disposed).toBe(true)
})
