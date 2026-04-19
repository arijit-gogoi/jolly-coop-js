import { schedule } from "./scheduler.js"

/**
 * Suspend for `ms` milliseconds. Resolves when the timer fires; rejects
 * with `signal.reason` if `signal` is provided and aborts before then.
 *
 * **The `signal` parameter is optional, but omitting it produces a sleep
 * that ignores cancellation entirely.** This is acceptable in tests,
 * one-off scripts, or any context where the sleep is short and outliving
 * a parent scope's cancellation is fine. In long-running task bodies,
 * always pass a signal — typically `s.signal` from the enclosing scope:
 *
 * ```ts
 * await scope(async s => {
 *   s.spawn(async () => {
 *     await sleep(100)            // ⚠ ignores cancellation; will run to completion even if scope cancels
 *     await sleep(100, s.signal)  // ✓ rejects on scope cancel
 *   })
 * })
 * ```
 *
 * The runtime cannot enforce this discipline at the type level without
 * breaking the simple `await sleep(50)` use case in tests and one-off
 * scripts. A workflow runner or a scope-aware scheduler that *always*
 * wants the signal threaded should wrap this with its own context-aware
 * variant rather than calling `sleep` directly.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      reject(signal!.reason)
    }

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
    }
  })
}

/**
 * Yield control to the scheduler, letting other tasks in the run queue
 * make progress. Resolves on the next scheduler tick; rejects with
 * `signal.reason` if `signal` is provided and aborts before then.
 *
 * Same caveat as `sleep`: omitting `signal` produces a yield that ignores
 * cancellation. Long-running tight loops should pass `s.signal` so the
 * loop terminates promptly when the scope cancels.
 */
export function yieldNow(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    schedule(() => {
      if (signal?.aborted) {
        reject(signal.reason)
      } else {
        resolve()
      }
    })
  })
}
