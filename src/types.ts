/**
 * A structured concurrency boundary. Owns tasks, child scopes, and resources.
 *
 * Created by `scope(fn)` or `scope(options, fn)`. Within the scope function,
 * you `spawn` tasks, `resource`-register cleanup, and read `signal` / `active`.
 * The scope does not settle until every spawned task reaches a terminal state.
 *
 * ## Behavioral contract
 *
 * - `spawn` is **non-blocking** and returns immediately. Under `{ limit }`,
 *   excess tasks queue internally (FIFO) and honor cancellation.
 * - `resource` registrations are cleaned up **LIFO** on scope exit, regardless
 *   of whether the scope resolved, rejected, or was cancelled.
 * - `cancel(reason?)` **rejects** the scope with `reason`. If `reason` is
 *   provided, its identity is preserved (`err === reason` after catch).
 * - `done()` **resolves** the scope and aborts `signal` with a
 *   `ScopeDoneSignal` reason, so cooperating tasks can distinguish graceful
 *   shutdown from manual cancellation.
 * - Any uncaught throw from a `spawn`'d task body fails the scope (fail-fast).
 *   To recover from an expected failure, catch inside the task body and
 *   return an error-as-value: `{ ok: true, ... } | { ok: false, error }`.
 */
export interface Scope {
  /**
   * Spawn a task within this scope. Non-blocking — returns immediately with
   * a `Task<T>` handle. Under `{ limit }`, excess tasks queue internally.
   *
   * Uncaught throws from `fn` fail the scope. To handle an expected failure
   * without cancelling siblings, catch inside `fn` and return an
   * error-as-value result.
   */
  spawn<T>(fn: () => Promise<T> | T): Task<T>

  /**
   * Register a resource with the scope. The `disposer` is called with the
   * resolved value on scope exit (success, failure, or cancel). Disposers
   * run in **LIFO order** — last registered, first disposed.
   *
   * Disposer errors are contained (logged internally, do not replace the
   * scope's settle reason).
   */
  resource<T>(
    value: Promise<T> | T,
    disposer: (value: T) => Promise<void> | void
  ): Promise<T>

  /**
   * Cancel the scope. Aborts `signal`, cancels running tasks, rejects the
   * scope promise with `reason`. Idempotent. If `reason` is passed, its
   * identity is preserved — `err === reason` after catch.
   */
  cancel(reason?: unknown): void

  /**
   * Signal graceful shutdown. Aborts `signal` with a `ScopeDoneSignal` reason
   * so observers can distinguish graceful from manual cancellation. The
   * scope **resolves normally** (does not reject) assuming no prior errors.
   * Idempotent. If `cancel()` was called first, cancel wins.
   */
  done(): void

  /**
   * AbortSignal tied to the scope's lifetime. Pass to signal-aware APIs
   * (`fetch`, streams) to propagate scope cancellation. Aborts when the
   * scope cancels, times out, or `done()` is called. Check
   * `signal.reason instanceof ScopeDoneSignal` to distinguish graceful
   * shutdown from cancellation.
   */
  readonly signal: AbortSignal

  /**
   * Count of tasks that haven't reached a terminal state (running + queued
   * under `{ limit }`). Useful for backpressure: in a driver loop,
   * `active < limit` indicates headroom to spawn more work.
   */
  readonly active: number
}

/**
 * Handle to a spawned task. Implements `PromiseLike<T>` — awaitable directly.
 * `state` reflects the task's current position in the lifecycle state machine.
 */
export interface Task<T> extends PromiseLike<T> {
  readonly id: number
  readonly state: "running" | "completed" | "failed" | "cancelled"
}

/**
 * Options for `scope(options, fn)`.
 *
 * All fields are optional and independent. If multiple time bounds are set
 * (`timeout` and `deadline`), `deadline` takes precedence.
 */
export interface ScopeOptions {
  /**
   * **Relative** duration in milliseconds. If the scope hasn't completed
   * within this window, it is cancelled and rejects with `TimeoutError`.
   *
   * Contrast with `deadline` (absolute). Use `timeout` for "finish within N
   * ms"; use `deadline` for "finish before timestamp T".
   */
  timeout?: number

  /**
   * **Absolute** timestamp (milliseconds since epoch, `Date.now()`-based).
   * If the scope hasn't completed by this time, it is cancelled and rejects
   * with `TimeoutError`.
   *
   * Deadlines are composable: compute once at a top-level entry point and
   * pass down through nested scopes to enforce a single end-time across the
   * whole tree.
   */
  deadline?: number

  /**
   * Max **concurrently running** tasks in the scope. Excess `spawn` calls
   * queue internally (FIFO). Queued tasks honor cancellation — cancelling
   * the scope transitions them to `"cancelled"` without ever executing.
   *
   * Note: `spawn` itself is non-blocking even when at the limit; it returns
   * immediately and the task runs when a slot frees. For true backpressure
   * (not pulling from a source faster than the pool processes), guard your
   * driver loop with `while (scope.active >= limit) await sleep(...)`.
   */
  limit?: number

  /**
   * External AbortSignal. If it aborts, the scope cancels and rejects with
   * `signal.reason` (identity preserved). Use this to wire SIGINT, request
   * cancellation, or parent-scope cancellation down to nested scopes.
   *
   * Nested scopes do **not** automatically inherit the parent's signal —
   * pass `{ signal: parent.signal }` explicitly. This is deliberate
   * (ambient signal context was tried and removed in v0.2.0 because it
   * created timing-dependent bugs).
   */
  signal?: AbortSignal
}

export type TaskState = "created" | "running" | "completed" | "failed" | "cancelled"
