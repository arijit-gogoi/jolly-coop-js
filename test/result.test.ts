import { expect, test } from "vitest"
import { scope, sleep, toResult, TimeoutError, DeadlineError, ScopeCancelledError } from "../src/index.js"
import type { Result } from "../src/index.js"

// --- Input shapes (Shape C: promise | async thunk | sync thunk) ---

test("accepts a bare promise", async () => {
  const r = await toResult(Promise.resolve(42))
  expect(r).toEqual({ ok: true, value: 42 })
})

test("accepts an async thunk", async () => {
  const r = await toResult(async () => 42)
  expect(r).toEqual({ ok: true, value: 42 })
})

test("accepts a sync thunk that returns a value", async () => {
  const r = await toResult(() => 42)
  expect(r).toEqual({ ok: true, value: 42 })
})

test("accepts a sync thunk that returns a promise", async () => {
  const r = await toResult(() => Promise.resolve(42))
  expect(r).toEqual({ ok: true, value: 42 })
})

// --- Error capture ---

test("captures a bare promise rejection", async () => {
  const err = new Error("boom")
  const r = await toResult(Promise.reject(err))
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error).toBe(err)
})

test("captures a sync throw from a sync thunk", async () => {
  const err = new Error("sync boom")
  const r = await toResult(() => { throw err })
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error).toBe(err)
})

test("captures a sync throw from an async thunk (pre-await)", async () => {
  const err = new Error("before promise")
  const r = await toResult(async () => { throw err })
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error).toBe(err)
})

// --- Identity preservation (jolly-coop core contract) ---

test("preserves non-Error rejection values (strings, objects, primitives)", async () => {
  const r1 = await toResult(Promise.reject("string reason"))
  expect(r1.ok).toBe(false)
  if (!r1.ok) expect(r1.error).toBe("string reason")

  const obj = { code: "E_CUSTOM" }
  const r2 = await toResult(Promise.reject(obj))
  expect(r2.ok).toBe(false)
  if (!r2.ok) expect(r2.error).toBe(obj) // reference equality

  const r3 = await toResult(Promise.reject(42))
  expect(r3.ok).toBe(false)
  if (!r3.ok) expect(r3.error).toBe(42)
})

// --- Canonical jolly-coop usage: expected rejection from scope ---

test("observes TimeoutError from a timed-out scope", async () => {
  const r = await toResult(
    scope({ timeout: 10 }, async s => {
      s.spawn(async () => { await sleep(200, s.signal) })
    })
  )
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.error).toBeInstanceOf(TimeoutError)
    expect(r.error).toBeInstanceOf(ScopeCancelledError)
  }
})

test("observes DeadlineError from a deadline scope", async () => {
  const r = await toResult(() =>
    scope({ deadline: Date.now() + 10 }, async s => {
      s.spawn(async () => { await sleep(200, s.signal) })
    })
  )
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.error).toBeInstanceOf(DeadlineError)
    expect(r.error).toBeInstanceOf(ScopeCancelledError)
  }
})

test("observes user-supplied cancel reason with identity preserved", async () => {
  const myReason = { code: "USER_STOP" }
  const r = await toResult(
    scope(async s => {
      s.cancel(myReason)
    })
  )
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error).toBe(myReason) // identity, not wrapped
})

// --- Happy path still works ---

test("wraps a resolved scope normally", async () => {
  const r = await toResult(
    scope(async s => {
      const t = s.spawn(async () => 99)
      return await t
    })
  )
  expect(r).toEqual({ ok: true, value: 99 })
})

// --- Generic narrowing (compile-time demonstration via runtime check) ---

test("second generic narrows the error type at compile time", async () => {
  // No runtime assertion needed — this test documents the expected usage.
  // If the second generic is removed or changed, type-check will catch it.
  const r: Result<void, TimeoutError | DeadlineError> = await toResult<void, TimeoutError | DeadlineError>(
    scope({ timeout: 5 }, async s => {
      s.spawn(async () => { await sleep(100, s.signal) })
    })
  )
  expect(r.ok).toBe(false)
  if (!r.ok) {
    // r.error is typed as TimeoutError | DeadlineError (narrowing burden on caller)
    expect(r.error).toBeInstanceOf(ScopeCancelledError)
  }
})
