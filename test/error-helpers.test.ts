import { expect, test } from "vitest"
import {
  scope,
  sleep,
  TimeoutError,
  DeadlineError,
  ScopeDoneSignal,
  ScopeCancelledError,
  isStructuralCancellation,
  isUserCancellation,
} from "../src/index.js"

// --- isStructuralCancellation: positive cases ---

test("isStructuralCancellation true for TimeoutError", () => {
  expect(isStructuralCancellation(new TimeoutError())).toBe(true)
})

test("isStructuralCancellation true for DeadlineError", () => {
  expect(isStructuralCancellation(new DeadlineError())).toBe(true)
})

test("isStructuralCancellation true for ScopeDoneSignal", () => {
  expect(isStructuralCancellation(new ScopeDoneSignal())).toBe(true)
})

test("isStructuralCancellation true for bare ScopeCancelledError", () => {
  expect(isStructuralCancellation(new ScopeCancelledError("timeout", "x"))).toBe(true)
})

// --- isStructuralCancellation: negative cases ---

test("isStructuralCancellation false for plain Error", () => {
  expect(isStructuralCancellation(new Error("nope"))).toBe(false)
})

test("isStructuralCancellation false for primitives and falsy values", () => {
  expect(isStructuralCancellation(null)).toBe(false)
  expect(isStructuralCancellation(undefined)).toBe(false)
  expect(isStructuralCancellation(0)).toBe(false)
  expect(isStructuralCancellation("")).toBe(false)
  expect(isStructuralCancellation("string reason")).toBe(false)
  expect(isStructuralCancellation({ kind: "user" })).toBe(false)
})

// --- isUserCancellation: positive cases ---

test("isUserCancellation true for plain Error (e.g. cancel(new Error('x')))", () => {
  expect(isUserCancellation(new Error("user reason"))).toBe(true)
})

test("isUserCancellation true for non-Error truthy values", () => {
  expect(isUserCancellation("user reason")).toBe(true)
  expect(isUserCancellation({ kind: "USER_ABORT" })).toBe(true)
  expect(isUserCancellation(42)).toBe(true)
  expect(isUserCancellation(true)).toBe(true)
})

// --- isUserCancellation: negative cases ---

test("isUserCancellation false for structural cancellations", () => {
  expect(isUserCancellation(new TimeoutError())).toBe(false)
  expect(isUserCancellation(new DeadlineError())).toBe(false)
  expect(isUserCancellation(new ScopeDoneSignal())).toBe(false)
})

test("isUserCancellation false for falsy values (no positive read on absence)", () => {
  expect(isUserCancellation(null)).toBe(false)
  expect(isUserCancellation(undefined)).toBe(false)
  expect(isUserCancellation(0)).toBe(false)
  expect(isUserCancellation("")).toBe(false)
})

// --- Integration: real scope rejections ---

test("scope timeout: caught error is structural", async () => {
  let caught: unknown = null
  try {
    await scope({ timeout: 5 }, async s => {
      s.spawn(async () => { await sleep(100, s.signal) })
    })
  } catch (e) { caught = e }
  expect(isStructuralCancellation(caught)).toBe(true)
  expect(isUserCancellation(caught)).toBe(false)
})

test("scope deadline: caught error is structural", async () => {
  let caught: unknown = null
  try {
    await scope({ deadline: Date.now() + 5 }, async s => {
      s.spawn(async () => { await sleep(100, s.signal) })
    })
  } catch (e) { caught = e }
  expect(isStructuralCancellation(caught)).toBe(true)
  expect(isUserCancellation(caught)).toBe(false)
})

test("scope cancel(reason): caught error is user, not structural", async () => {
  const myReason = { code: "USER_ABORT" }
  let caught: unknown = null
  try {
    await scope(async s => { s.cancel(myReason) })
  } catch (e) { caught = e }
  expect(isUserCancellation(caught)).toBe(true)
  expect(isStructuralCancellation(caught)).toBe(false)
  expect(caught).toBe(myReason) // identity preserved
})

test("external signal abort: caught error is user, not structural", async () => {
  const myReason = new Error("external")
  const ac = new AbortController()
  let caught: unknown = null
  const p = scope({ signal: ac.signal }, async s => {
    s.spawn(async () => { await sleep(1000, s.signal) })
  })
  await sleep(5)
  ac.abort(myReason)
  try { await p } catch (e) { caught = e }
  expect(isUserCancellation(caught)).toBe(true)
  expect(isStructuralCancellation(caught)).toBe(false)
})

test("done() signal reason: structural, not user", async () => {
  let observedReason: unknown = null
  await scope(async s => {
    s.spawn(async () => {
      while (!s.signal.aborted) await sleep(5, s.signal).catch(() => {})
      observedReason = s.signal.reason
    })
    await sleep(10)
    s.done()
  })
  expect(isStructuralCancellation(observedReason)).toBe(true)
  expect(isUserCancellation(observedReason)).toBe(false)
})
