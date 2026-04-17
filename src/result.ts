/**
 * Discriminated-union result. `ok: true` carries a value; `ok: false` carries
 * an error whose identity is preserved (not wrapped). The error type defaults
 * to `unknown` because jolly-coop preserves thrown-value identity — a scope
 * can reject with any value, not just `Error`. Narrow via the second generic
 * when you know the rejection type:
 *
 *     const r: Result<void, TimeoutError> = await toResult(...)
 */
export type Result<T, E = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E }

/**
 * Turn a promise, async thunk, or sync thunk into a `Result` — never rejects,
 * always resolves. The canonical way to observe an expected rejection (scope
 * timeout, deadline, signal abort) without `.catch(() => {})` ceremony or
 * a sibling variable to record the error.
 *
 * Accepts three input shapes:
 * - a `Promise<T>` — awaited directly
 * - an async thunk `() => Promise<T>` — called, then awaited
 * - a sync thunk `() => T` — called; sync throws are captured
 *
 * Error identity is preserved: if the source rejects with or throws value `X`,
 * the returned `Result` has `error === X` (no wrapping, no normalization).
 *
 * @example
 *   // Expected rejection: scope timed out
 *   const r = await toResult(scope({ timeout: 500 }, async s => doWork(s)))
 *   if (!r.ok) {
 *     if (r.error instanceof TimeoutError) handleTimeout()
 *     else throw r.error  // unexpected
 *   }
 *
 * @example
 *   // Thunk form composes with dynamic construction
 *   const r = await toResult(() => scope({ deadline: d }, fn))
 */
export async function toResult<T, E = unknown>(
  input: Promise<T> | (() => Promise<T> | T)
): Promise<Result<T, E>> {
  try {
    const value = typeof input === "function" ? await input() : await input
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: error as E }
  }
}
