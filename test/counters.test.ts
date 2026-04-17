// Tests for scope.active / scope.completed / scope.failed / scope.cancelled
// The full set of per-state counters added in v0.3.2.

import { expect, test } from "vitest"
import { scope, sleep } from "../src/index.js"

test("fresh scope has all counters at zero", async () => {
  await scope(async s => {
    expect(s.active).toBe(0)
    expect(s.completed).toBe(0)
    expect(s.failed).toBe(0)
    expect(s.cancelled).toBe(0)
  })
})

test("active counts tasks not yet terminal", async () => {
  let snapshot = { active: -1, completed: -1 }
  await scope(async s => {
    s.spawn(async () => { await sleep(20) })
    s.spawn(async () => { await sleep(20) })
    snapshot = { active: s.active, completed: s.completed }
  })
  expect(snapshot.active).toBe(2)
  expect(snapshot.completed).toBe(0)
})

test("completed counter increments on task success", async () => {
  let finalCompleted = -1
  await scope(async s => {
    const ts = [
      s.spawn(async () => 1),
      s.spawn(async () => 2),
      s.spawn(async () => 3),
    ]
    await Promise.all(ts)
    finalCompleted = s.completed
  })
  expect(finalCompleted).toBe(3)
})

test("failed counter increments on uncaught throw (exactly 1 under fail-fast)", async () => {
  // Capture scope to observe final counters after settle.
  let holder: { s: import("../src/types.js").Scope } | null = null
  try {
    await scope(async s => {
      holder = { s }
      s.spawn(async () => { throw new Error("boom") })
      // These two are cancelled by fail-fast, not failed.
      s.spawn(async () => { await sleep(100, s.signal) })
      s.spawn(async () => { await sleep(100, s.signal) })
    })
  } catch {}
  expect(holder).not.toBeNull()
  expect(holder!.s.failed).toBe(1)
  // The two siblings were cancelled by fail-fast.
  expect(holder!.s.cancelled).toBe(2)
})

test("cancelled counter counts tasks terminated by scope cancellation", async () => {
  // To observe final counters after the scope fully settles, capture the
  // scope in an outer holder and read after `scope(...)` returns.
  let holder: { s: import("../src/types.js").Scope } | null = null
  try {
    await scope({ limit: 2 }, async s => {
      holder = { s }
      // 5 tasks, limit=2 — 2 start running, 3 queue.
      for (let i = 0; i < 5; i++) {
        s.spawn(async () => { await sleep(100, s.signal) })
      }
      await sleep(5)
      s.cancel(new Error("stop"))
    })
  } catch {}
  // All tasks are terminal by the time scope() settles.
  expect(holder).not.toBeNull()
  expect(holder!.s.active).toBe(0)
  expect(holder!.s.cancelled).toBe(5)
})

test("counters are monotonic (never decrease)", async () => {
  const snapshots: Array<{ c: number; f: number; x: number; a: number }> = []
  await scope(async s => {
    for (let i = 0; i < 5; i++) {
      s.spawn(async () => { await sleep(Math.random() * 10) })
    }
    for (let i = 0; i < 10; i++) {
      await sleep(2)
      snapshots.push({ c: s.completed, f: s.failed, x: s.cancelled, a: s.active })
    }
  })
  for (let i = 1; i < snapshots.length; i++) {
    expect(snapshots[i].c).toBeGreaterThanOrEqual(snapshots[i - 1].c)
    expect(snapshots[i].f).toBeGreaterThanOrEqual(snapshots[i - 1].f)
    expect(snapshots[i].x).toBeGreaterThanOrEqual(snapshots[i - 1].x)
  }
})

test("active + completed + failed + cancelled accounts for every spawned task at settle", async () => {
  // Spawn N tasks, ensure final counters sum to N.
  // Uses a scope that completes successfully so no cancels happen.
  let total = 0
  let finalSum = 0
  await scope(async s => {
    for (let i = 0; i < 7; i++) {
      total++
      s.spawn(async () => { await sleep(5) })
    }
    // Wait for all to finish.
    while (s.active > 0) await sleep(5)
    finalSum = s.completed + s.failed + s.cancelled + s.active
  })
  expect(finalSum).toBe(total)
})
