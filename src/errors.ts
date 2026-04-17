/**
 * Base class for errors that Jolly itself creates when cancelling a scope
 * for a structural reason (timeout, deadline, or graceful done).
 *
 * Not thrown for manual `cancel(reason)` or external-signal aborts —
 * those preserve the reason's identity as-is. `ScopeCancelledError` only
 * appears when the runtime had to synthesize a cancellation reason.
 *
 * ## Recommended error categorization pattern
 *
 * Use `instanceof ScopeCancelledError` to catch all structural causes in
 * one branch, then switch on `.cause` to discriminate:
 *
 * ```ts
 * try { await scope(opts, fn) }
 * catch (err) {
 *   if (err instanceof ScopeCancelledError) {
 *     switch (err.cause) {
 *       case "timeout":  // relative `timeout` option elapsed
 *       case "deadline": // absolute `deadline` option reached
 *       case "done":     // unreachable in practice — `done()` resolves
 *     }
 *   } else {
 *     // err is exactly the user-supplied `cancel(reason)` or `signal.reason`
 *   }
 * }
 * ```
 *
 * `err instanceof TimeoutError` and `err instanceof DeadlineError` are
 * both valid narrower checks that subclass `ScopeCancelledError`.
 */
export class ScopeCancelledError extends Error {
  readonly cause: "timeout" | "deadline" | "done"
  constructor(cause: "timeout" | "deadline" | "done", message: string) {
    super(message)
    this.name = "ScopeCancelledError"
    this.cause = cause
  }
}

/**
 * Thrown by a scope whose **relative** `timeout` option elapsed before
 * completion. Subclass of `ScopeCancelledError` with `cause === "timeout"`.
 *
 * For the **absolute** `deadline` option, see `DeadlineError`.
 */
export class TimeoutError extends ScopeCancelledError {
  constructor(message = "Scope timed out") {
    super("timeout", message)
    this.name = "TimeoutError"
  }
}

/**
 * Thrown by a scope whose **absolute** `deadline` option was reached before
 * completion. Subclass of `ScopeCancelledError` with `cause === "deadline"`.
 *
 * For the **relative** `timeout` option, see `TimeoutError`.
 *
 * Use `instanceof ScopeCancelledError` if you want to catch both
 * time-bound cases in one branch.
 */
export class DeadlineError extends ScopeCancelledError {
  constructor(message = "Scope deadline reached") {
    super("deadline", message)
    this.name = "DeadlineError"
  }
}

/**
 * Sentinel used as the abort signal's `reason` when `scope.done()` is called.
 * The scope itself resolves normally — this value appears only on
 * `s.signal.reason` so observers can distinguish graceful shutdown from
 * manual cancellation. Subclass of `ScopeCancelledError` with
 * `cause === "done"`. Named "Signal" (not "Error") because it represents
 * intentional shutdown, not a failure; it's an `Error` subclass only so
 * `AbortSignal.reason` consumers that expect Error-shaped values work.
 */
export class ScopeDoneSignal extends ScopeCancelledError {
  constructor(message = "Scope done") {
    super("done", message)
    this.name = "ScopeDoneSignal"
  }
}
