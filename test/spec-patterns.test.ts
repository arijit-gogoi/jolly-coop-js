// Tests for spec/jolly-coop.md section 18 — Usage Patterns
// Each test mirrors the spec code as closely as possible with mock implementations.

import { describe, it, expect } from "vitest"
import { scope, sleep, yieldNow, TimeoutError } from "../src/index.js"

// --- Mocks ---

async function fetchUser() {
  await sleep(5)
  return { id: 1, name: "Alice" }
}

async function fetchPosts(userId?: number) {
  await sleep(5)
  return [{ id: 1, title: "Post 1", userId: userId ?? 1 }]
}

function openConnection() {
  const closed = { value: false }
  return {
    query: async (q: string) => { await sleep(5); return [{ id: 1 }] },
    close: () => { closed.value = true },
    get closed() { return closed.value },
  }
}

// --- 18.1 Basic Concurrent Tasks ---

it("18.1 basic concurrent tasks", async () => {
  const result = await scope(async s => {
    const user = s.spawn(fetchUser)
    const posts = s.spawn(fetchPosts)

    return {
      user: await user,
      posts: await posts,
    }
  })

  expect(result.user).toEqual({ id: 1, name: "Alice" })
  expect(result.posts).toHaveLength(1)
})

// --- 18.2 Sequential Within Concurrent ---

it("18.2 sequential within concurrent", async () => {
  const result = await scope(async s => {
    const user = await s.spawn(fetchUser)
    const posts = s.spawn(() => fetchPosts(user.id))

    return await posts
  })

  expect(result).toHaveLength(1)
  expect(result[0].userId).toBe(1)
})

// --- 18.3 Fail-Fast Error Propagation ---

it("18.3 fail-fast error propagation", async () => {
  let secondTaskRan = false

  await expect(
    scope(async s => {
      s.spawn(async () => {
        throw new Error("fail")
      })

      s.spawn(async () => {
        await sleep(100)
        secondTaskRan = true
      })
    })
  ).rejects.toThrow("fail")

  expect(secondTaskRan).toBe(false)
})

// --- 18.4 Timeout ---

it("18.4 timeout", async () => {
  await expect(
    scope({ timeout: 50 }, async s => {
      s.spawn(async () => {
        await sleep(5000)
      })
    })
  ).rejects.toThrow(TimeoutError)
})

// --- 18.5 Concurrency-Limited Work ---

it("18.5 concurrency-limited work", async () => {
  const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`)
  let running = 0
  let maxRunning = 0

  await scope({ limit: 5 }, async s => {
    for (const url of urls) {
      s.spawn(async () => {
        running++
        maxRunning = Math.max(maxRunning, running)
        await sleep(10)
        running--
      })
    }
  })

  expect(maxRunning).toBeLessThanOrEqual(5)
  expect(maxRunning).toBeGreaterThan(0)
})

// --- 18.6 Resource Scoping ---

it("18.6 resource scoping", async () => {
  const conn = openConnection()

  await scope(async s => {
    const c = await s.resource(
      conn,
      c => c.close()
    )

    s.spawn(() => c.query("SELECT * FROM users"))
  })

  expect(conn.closed).toBe(true)
})

// --- 18.7 Integration with Fetch and AbortSignal ---

it("18.7 integration with AbortSignal", async () => {
  let signalReceived: AbortSignal | null = null

  async function mockFetch(url: string, opts?: { signal?: AbortSignal }) {
    signalReceived = opts?.signal ?? null
    await sleep(5)
    return { json: async () => ({ data: "response" }) }
  }

  const result = await scope(async s => {
    const res = await s.spawn(() =>
      mockFetch("https://api.example.com", { signal: s.signal })
    )

    return res.json()
  })

  expect(await result).toEqual({ data: "response" })
  expect(signalReceived).not.toBeNull()
  expect(signalReceived).toHaveProperty("aborted")
})

// --- 18.8 Manual Cancellation ---

it("18.8 manual cancellation", async () => {
  await expect(
    scope(async s => {
      s.spawn(async () => {
        await sleep(1000)
      })

      s.cancel()
    })
  ).rejects.toBeDefined()
})

// --- 18.9 Nested Scopes ---

it("18.9 nested scopes", async () => {
  const order: string[] = []

  async function taskA() { await sleep(5); order.push("a") }
  async function taskB() { await sleep(5); order.push("b") }

  await scope(async s => {
    s.spawn(async () => {
      await scope(async inner => {
        inner.spawn(taskA)
        inner.spawn(taskB)
      })
      order.push("inner-done")
    })
  })

  expect(order).toContain("a")
  expect(order).toContain("b")
  expect(order[order.length - 1]).toBe("inner-done")
})

// --- 18.10 Cooperative Yielding ---

it("18.10 cooperative yielding", async () => {
  let iterations = 0

  function heavyComputation(i: number) { iterations++ }

  await scope(async s => {
    s.spawn(async () => {
      for (let i = 0; i < 1000; i++) {
        heavyComputation(i)
        await yieldNow()
      }
    })
  })

  expect(iterations).toBe(1000)
})

// --- 18.11 Deadline ---

it("18.11 deadline", async () => {
  async function longRunningTask() { await sleep(5000) }

  await expect(
    scope(
      { deadline: Date.now() + 50 },
      async s => {
        s.spawn(longRunningTask)
      }
    )
  ).rejects.toThrow(TimeoutError)
})
