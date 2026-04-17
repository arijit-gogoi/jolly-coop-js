/**
 * Base class for errors that Jolly itself creates when cancelling a scope
 * for a structural reason (timeout or graceful done).
 *
 * Not thrown for manual `cancel(reason)` or external-signal aborts —
 * those preserve the reason's identity as-is. `ScopeCancelledError` only
 * appears when the runtime had to synthesize a cancellation reason.
 *
 * Use `instanceof ScopeCancelledError` to catch both structural causes
 * in one branch, or `.cause` to discriminate.
 */
export class ScopeCancelledError extends Error {
  readonly cause: "timeout" | "done"
  constructor(cause: "timeout" | "done", message: string) {
    super(message)
    this.name = "ScopeCancelledError"
    this.cause = cause
  }
}

/**
 * Thrown by a scope whose `timeout` or `deadline` elapsed before completion.
 * Subclass of `ScopeCancelledError` with `cause === "timeout"`.
 */
export class TimeoutError extends ScopeCancelledError {
  constructor(message = "Scope timed out") {
    super("timeout", message)
    this.name = "TimeoutError"
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
