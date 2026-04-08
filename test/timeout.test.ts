import { expect, test } from "vitest"
import { scope, sleep } from "../src/index.js"

test("timeout cancels multiple tasks", async () => {
  let ran = 0
  await expect(
    scope({ timeout: 10 }, async s => {
      s.spawn(async () => {
        await sleep(50)
        ran++
      })
      s.spawn(async () => {
        await sleep(50)
        ran++
      })
    })
  ).rejects.toBeDefined()
  expect(ran).toBe(0)
})

test("timeout triggers without tasks", async () => {
  await expect(
    scope({ timeout: 10 }, async () => {
      await sleep(50)
    })
  ).rejects.toBeDefined()
})

test("completion wins over timeout race", async () => {
  const result = await scope({ timeout: 20 }, async s => {
    const t = s.spawn(async () => {
      await sleep(5)
      return 1
    })
    return await t
  })
  expect(result).toBe(1)
})

test("error before timeout wins", async () => {
  await expect(
    scope({ timeout: 50 }, async s => {
      s.spawn(async () => {
        throw new Error("fail")
      })
      await sleep(10)
    })
  ).rejects.toThrow("fail")
})

test("timeout cancels nested scopes", async () => {
  let ran = false
  await expect(
    scope({ timeout: 10 }, async s => {
      s.spawn(async () => {
        await scope(async inner => {
          inner.spawn(async () => {
            await sleep(50)
            ran = true
          })
        })
      })
    })
  ).rejects.toBeDefined()
  expect(ran).toBe(false)
})

test("deadline cancels scope", async () => {
  const deadline = Date.now() + 10
  await expect(
    scope({ deadline }, async s => {
      s.spawn(async () => {
        await sleep(50)
      })
    })
  ).rejects.toBeDefined()
})

test("timeout does not trigger after completion", async () => {
  const result = await scope({ timeout: 50 }, async () => {
    return 1
  })
  expect(result).toBe(1)
})

test("manual cancel vs timeout race", async () => {
  await expect(
    scope({ timeout: 50 }, async s => {
      s.spawn(async () => {
        await sleep(100)
      })
      await sleep(5)
      s.cancel()
    })
  ).rejects.toBeDefined()
})
