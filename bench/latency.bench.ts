import { bench, describe } from "vitest"
import { scope } from "../src/index.js"

describe("scheduling-latency", () => {
  bench("1k tasks spawn-to-execute", async () => {
    await scope(async s => {
      for (let i = 0; i < 1_000; i++) {
        s.spawn(() => {})
      }
    })
  })

  bench("10k tasks spawn-to-execute", async () => {
    await scope(async s => {
      for (let i = 0; i < 10_000; i++) {
        s.spawn(() => {})
      }
    })
  })

  bench("100k tasks spawn-to-execute", async () => {
    await scope(async s => {
      for (let i = 0; i < 100_000; i++) {
        s.spawn(() => {})
      }
    })
  })
})
