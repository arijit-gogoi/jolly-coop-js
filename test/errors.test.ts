import { expect, test } from "vitest"
import { scope, sleep } from "../src/index.js"
import { TimeoutError, ScopeDoneSignal, ScopeCancelledError } from "../src/errors.js"

test("TimeoutError is a ScopeCancelledError with cause=timeout", () => {
  const e = new TimeoutError()
  expect(e).toBeInstanceOf(TimeoutError)
  expect(e).toBeInstanceOf(ScopeCancelledError)
  expect(e).toBeInstanceOf(Error)
  expect(e.cause).toBe("timeout")
  expect(e.name).toBe("TimeoutError")
})

test("ScopeDoneSignal is a ScopeCancelledError with cause=done", () => {
  const s = new ScopeDoneSignal()
  expect(s).toBeInstanceOf(ScopeDoneSignal)
  expect(s).toBeInstanceOf(ScopeCancelledError)
  expect(s).toBeInstanceOf(Error)
  expect(s.cause).toBe("done")
  expect(s.name).toBe("ScopeDoneSignal")
})

test("scope timeout rejects with TimeoutError (also catchable as ScopeCancelledError)", async () => {
  let caught: unknown = null
  try {
    await scope({ timeout: 10 }, async s => {
      s.spawn(async () => { await sleep(100, s.signal) })
    })
  } catch (e) {
    caught = e
  }
  expect(caught).toBeInstanceOf(TimeoutError)
  expect(caught).toBeInstanceOf(ScopeCancelledError)
  expect((caught as ScopeCancelledError).cause).toBe("timeout")
})

test("scope.done() sets signal.reason to ScopeDoneSignal (catchable as ScopeCancelledError)", async () => {
  let observed: unknown = null
  await scope(async s => {
    s.spawn(async () => {
      while (!s.signal.aborted) await sleep(5, s.signal).catch(() => {})
      observed = s.signal.reason
    })
    await sleep(10)
    s.done()
  })
  expect(observed).toBeInstanceOf(ScopeDoneSignal)
  expect(observed).toBeInstanceOf(ScopeCancelledError)
  expect((observed as ScopeCancelledError).cause).toBe("done")
})

test("manual cancel(reason) preserves reason identity (NOT a ScopeCancelledError)", async () => {
  const myReason = new Error("custom reason")
  let caught: unknown = null
  try {
    await scope(async s => { s.cancel(myReason) })
  } catch (e) {
    caught = e
  }
  expect(caught).toBe(myReason) // reference equality preserved
  expect(caught).not.toBeInstanceOf(ScopeCancelledError)
})

test("external signal abort reason is preserved (NOT a ScopeCancelledError)", async () => {
  const ac = new AbortController()
  const myReason = { kind: "shutdown", when: Date.now() }
  let caught: unknown = null
  const p = scope({ signal: ac.signal }, async s => {
    s.spawn(async () => { await sleep(1000, s.signal) })
  })
  await sleep(5)
  ac.abort(myReason)
  try {
    await p
  } catch (e) {
    caught = e
  }
  expect(caught).toBe(myReason) // reference equality preserved
  expect(caught).not.toBeInstanceOf(ScopeCancelledError)
})

test("catching ScopeCancelledError unifies timeout and done (but not manual/external)", async () => {
  // Timeout → catchable as ScopeCancelledError
  let timeoutCaught = false
  try {
    await scope({ timeout: 5 }, async s => { s.spawn(async () => { await sleep(100, s.signal) }) })
  } catch (e) {
    if (e instanceof ScopeCancelledError) timeoutCaught = true
  }
  expect(timeoutCaught).toBe(true)

  // Done → scope resolves, signal.reason is catchable as ScopeCancelledError
  let doneReasonMatches = false
  await scope(async s => {
    s.spawn(async () => {
      while (!s.signal.aborted) await sleep(5, s.signal).catch(() => {})
      if (s.signal.reason instanceof ScopeCancelledError) doneReasonMatches = true
    })
    await sleep(10)
    s.done()
  })
  expect(doneReasonMatches).toBe(true)
})
