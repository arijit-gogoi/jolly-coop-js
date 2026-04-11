import { bench, describe } from "vitest"
import { scope, yieldNow } from "../src/index.js"

describe("throughput-noop", () => {
  bench("1k noop tasks", async () => {
    await scope(async s => { for (let i = 0; i < 1_000; i++) s.spawn(() => {}) })
  })

  bench("10k noop tasks", async () => {
    await scope(async s => { for (let i = 0; i < 10_000; i++) s.spawn(() => {}) })
  })

  bench("100k noop tasks", async () => {
    await scope(async s => { for (let i = 0; i < 100_000; i++) s.spawn(() => {}) })
  })
})

describe("throughput-yield", () => {
  bench("1k yield tasks", async () => {
    await scope(async s => { for (let i = 0; i < 1_000; i++) s.spawn(async () => { await yieldNow() }) })
  })

  bench("10k yield tasks", async () => {
    await scope(async s => { for (let i = 0; i < 10_000; i++) s.spawn(async () => { await yieldNow() }) })
  })

  bench("100k yield tasks", async () => {
    await scope(async s => { for (let i = 0; i < 100_000; i++) s.spawn(async () => { await yieldNow() }) })
  })
})
