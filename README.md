# Jolly

Structured concurrency runtime for JavaScript. Scoped task lifetimes, guaranteed cleanup, cooperative cancellation via AbortSignal, first-error-wins semantics.

## Introduction

JavaScript has excellent low-level async building blocks: promises, `async/await`, and `AbortController`. What it does not have is a model that enforces *structure* over concurrent work. Developers are left to manually track task lifetimes, wire up cancellation chains, and ensure resources are cleaned up across error paths. This leads to a well-known class of bugs — leaked connections, orphan promises, fire-and-forget tasks that silently fail, and inconsistent error handling when multiple concurrent operations interact.

Jolly addresses this by introducing a single organizing principle: **all async work lives inside scopes, and nothing escapes a scope**. A scope owns its tasks, waits for them to finish, cancels them when something goes wrong, and cleans up resources when it exits. The developer writes their concurrent logic; the runtime handles the lifecycle.

## Install

Published as `jolly-coop`.

```bash
npm install jolly-coop
```

## Quick example

```js
import { scope } from "jolly-coop"

const results = await scope(async s => {
  const profile = s.spawn(async () => {
    const res = await fetch("https://api.example.com/profile", { signal: s.signal })
    return res.json()
  })

  const feed = s.spawn(async () => {
    const res = await fetch("https://api.example.com/feed", { signal: s.signal })
    return res.json()
  })

  // Both run concurrently. If either fails, the other is cancelled.
  // Resources are cleaned up. No leaked promises.
  return { profile: await profile, feed: await feed }
})
```

### Cancellation in task bodies

`sleep` and `yieldNow` take an optional `AbortSignal`. To make them cancellation-aware inside a task, pass `s.signal`:

```js
await scope(async s => {
  s.spawn(async () => {
    await sleep(100, s.signal)   // rejects if scope is cancelled
    await sleep(200, s.signal)   // every await must thread the signal
  })
})
```

Signals are **explicit** in Jolly. There is no ambient signal context — each `sleep`, `yieldNow`, and nested `scope({ signal: s.signal }, ...)` call must be passed the signal it should observe.

### Handling expected failures

Any uncaught throw from a task body fails the scope (fail-fast). To handle an expected failure without cancelling siblings, catch it inside the task body and return a result:

```js
await scope(async s => {
  const t = s.spawn(async () => {
    try { return { ok: true, value: await risky() } }
    catch (err) { return { ok: false, error: err } }
  })
  const r = await t
  if (!r.ok) { /* handle locally */ }
})
```

Catching after `await t` is too late — the scope will have already started cancelling.

## API

### Exports

| Export | Signature | Description |
|--------|-----------|-------------|
| `scope` | `(fn) => Promise<T>` | Create a scope, run `fn`, wait for all tasks, clean up |
| `scope` | `(options, fn) => Promise<T>` | Same, with options (timeout, limit, signal) |
| `sleep` | `(ms, signal?) => Promise<void>` | Cancellation-aware sleep. Pass `s.signal` to observe scope cancellation. |
| `yieldNow` | `(signal?) => Promise<void>` | Yield to the scheduler. Pass `s.signal` to observe scope cancellation. |
| `toResult` | `(p \| thunk) => Promise<Result<T>>` | Turn an expected-rejection promise into `{ ok, value } \| { ok, error }`. Preserves error identity. |
| `parseDuration` | `(number \| string) => number` | Convert `"500ms"`/`"30s"`/`"2m"`/`"1h"` (or a raw ms number) to milliseconds. Throws on malformed input. Composes naturally with `{ timeout }` and `deadline: Date.now() + parseDuration(...)`. |
| `isStructuralCancellation` | `(reason) => reason is ScopeCancelledError` | Type-guard: was this cancellation synthesized by the runtime (timeout/deadline/done)? See [Settle-reason precedence](#settle-reason-precedence). |
| `isUserCancellation` | `(reason) => boolean` | Was this cancellation user-driven (manual `cancel(reason)` or external signal)? Truthy non-`ScopeCancelledError`. |
| `TimeoutError` | class | Thrown when a scope's **relative** `timeout` elapses. Subclass of `ScopeCancelledError`, `.cause === "timeout"`. |
| `DeadlineError` | class | Thrown when a scope's **absolute** `deadline` is reached. Subclass of `ScopeCancelledError`, `.cause === "deadline"`. |
| `ScopeDoneSignal` | class | Signal reason when `s.done()` aborts the scope's signal. Subclass of `ScopeCancelledError`, `.cause === "done"`. Named "Signal" because it marks intentional shutdown, not failure. |
| `ScopeCancelledError` | class | Parent of `TimeoutError`, `DeadlineError`, `ScopeDoneSignal`. Catch this to handle all structural cancellations in one branch. Has a `.cause: "timeout" \| "deadline" \| "done"` discriminator. Manual `cancel(reason)` and external-signal aborts preserve the reason's identity and are NOT wrapped. |

### Scope

| Method / Property | Signature | Description |
|-------------------|-----------|-------------|
| `spawn` | `(fn) => Task<T>` | Spawn a task. `fn` is `() => T \| Promise<T>`. **Non-blocking** — queues internally under `{ limit }`. |
| `resource` | `(value, disposer) => Promise<T>` | Register a resource with cleanup on scope exit. Cleanup is **LIFO**. |
| `cancel` | `(reason?) => void` | Cancel the scope. Aborts signal, scope rejects with `reason` (identity preserved). |
| `done` | `() => void` | Signal work is complete. Aborts signal with `ScopeDoneSignal`, scope resolves. |
| `signal` | `AbortSignal` | Tied to scope lifetime. Pass to fetch, streams, etc. |
| `active` | `number` (readonly) | Count of non-terminal tasks (running + queued). |
| `completed` | `number` (readonly) | Monotonic count of tasks that reached `"completed"`. |
| `failed` | `number` (readonly) | Monotonic count of tasks that reached `"failed"`. |
| `cancelled` | `number` (readonly) | Monotonic count of tasks that reached `"cancelled"`. |

### ScopeOptions

| Option | Type | Description |
|--------|------|-------------|
| `timeout` | `number` | **Relative** duration in ms. Scope rejects with `TimeoutError` if not settled in time. |
| `deadline` | `number` | **Absolute** timestamp (`Date.now()`-based). Composable — compute once, pass down. |
| `limit` | `number` | Max **concurrently running** tasks. Excess `spawn` calls queue internally (FIFO). See [Backpressure](#backpressure). |
| `signal` | `AbortSignal` | External signal. If aborted, scope rejects with `signal.reason` (identity preserved). Not auto-inherited by nested scopes — see [Nested scopes](#nested-scopes). |

### Task

| Property | Type | Description |
|----------|------|-------------|
| `id` | `number` | Unique task identifier |
| `state` | `string` | `"running"`, `"completed"`, `"failed"`, or `"cancelled"` |

Tasks implement `PromiseLike<T>` and can be awaited.

## Contract

Load-bearing behaviors. Full JSDoc on hover in your IDE.

- **`timeout`** — relative ms, fires `TimeoutError`. **`deadline`** — absolute `Date.now()`-based ts, fires `DeadlineError`. Both extend `ScopeCancelledError`. `deadline` wins if both are set.
- **`spawn` is non-blocking.** Returns a `Task<T>` immediately; under `{ limit }` excess tasks queue FIFO and honor cancellation.
- **Task bodies must yield.** A sync loop with no `await` can't be cancelled and may exhaust memory before abort propagates. Call `yieldNow(s.signal)` in tight loops without natural I/O.
- **`sleep`/`yieldNow` accept an optional signal — *use it* in task bodies.** Omitting the signal produces a sleep that ignores cancellation and runs to its full duration even if the scope cancels. Acceptable in tests and one-off scripts; in long-running tasks always pass `s.signal`.
- **`done()` resolves; `cancel(reason)` rejects.** `done` aborts `signal` with `ScopeDoneSignal` (graceful); `cancel` rejects with `reason` (identity preserved).
- **Error identity is preserved.** `cancel(reason)` and external `signal.reason` pass through unwrapped. Only structural cancels (timeout, deadline, done) synthesize — all extend `ScopeCancelledError`.
- **LIFO resource cleanup.** Disposers run in reverse registration order on scope exit. Disposer errors are contained.
- **Fail-fast on task errors.** Uncaught throw from a `spawn`'d body cancels the scope immediately. To recover, catch inside the body and return `{ ok, value | error }`. Catching after `await task` is too late.

### Settle-reason precedence

When multiple cancellation sources race, the first to fire wins:

| First to fire              | Scope settles with                                     |
|----------------------------|--------------------------------------------------------|
| `options.signal` aborts    | rejects with `signal.reason` (identity preserved)      |
| `options.deadline` reached | rejects with `DeadlineError` (`.cause = "deadline"`)   |
| `options.timeout` elapsed  | rejects with `TimeoutError` (`.cause = "timeout"`)     |
| `s.cancel(reason)`         | rejects with `reason` (identity preserved)             |
| `s.done()`                 | **resolves**; signal reason = `ScopeDoneSignal`        |

### Observing an expected rejection: `toResult`

When rejection is anticipated (scope timed out, was cancelled), wrap the call in `toResult` to flatten into a discriminated union, then use `isStructuralCancellation` to discriminate runtime-driven cancellation from user-driven ones without an `instanceof` chain:

```js
import { scope, toResult, isStructuralCancellation } from "jolly-coop"

const r = await toResult(scope({ timeout: 500 }, async s => doWork(s)))
if (!r.ok) {
  if (isStructuralCancellation(r.error)) {
    // runtime decided: timeout, deadline, or graceful done
    // r.error.cause is "timeout" | "deadline" | "done"
  } else {
    // r.error is exactly the cancel(reason) or external signal.reason
    throw r.error
  }
}
```

`toResult` accepts a promise, an async thunk, or a sync thunk. Error identity is preserved. Prefer plain `try/catch` when the rejection would be a bug, not a known outcome.

### Error categorization

For finer-grained branching, use `.cause` directly. The two helpers cover the common groupings; `instanceof` and `.cause` cover everything else.

```js
try { await scope(opts, fn) }
catch (err) {
  if (isStructuralCancellation(err)) {
    switch (err.cause) {
      case "timeout":  // relative `timeout` elapsed
      case "deadline": // absolute `deadline` reached
      case "done":     // unreachable — done() resolves, doesn't throw
    }
  } else if (isUserCancellation(err)) {
    // err is the cancel(reason) or external signal.reason — identity preserved
  } else {
    // err is null/undefined/empty — unusual; treat as unexpected
    throw err
  }
}
```

`instanceof ScopeCancelledError` catches all structural cancels; `.cause` or a narrower `instanceof` discriminates.

## Backpressure

`scope({ limit })` enforces max **concurrently running** tasks, but `spawn` is non-blocking — under the limit, excess tasks queue internally. For sources like message queues or BFS frontiers, a naive driver pre-schedules the entire input:

```js
// Pre-schedules every URL — internal queue grows unbounded
await scope({ limit: 10 }, async pool => {
  while (!urls.isEmpty()) {
    pool.spawn(() => fetch(urls.pop()))
  }
})
```

For real backpressure — don't pull from the source faster than the pool processes — guard the driver loop:

```js
await scope({ limit: 10 }, async pool => {
  while (!urls.isEmpty()) {
    while (pool.active >= 10) await sleep(5, pool.signal)
    pool.spawn(() => fetch(urls.pop()))
  }
})
```

See [`examples/library/04-bounded-bfs-with-backpressure.mjs`](examples/library/04-bounded-bfs-with-backpressure.mjs) for a worked example with a BFS frontier.

## Nested scopes

Nested scopes do **not** automatically inherit the parent's signal. You must pass it explicitly:

```js
await scope(async parent => {
  parent.spawn(async () => {
    // ✗ Silent bug: parent cancellation doesn't reach this scope
    await scope(async inner => {
      inner.spawn(async () => await sleep(1000, inner.signal))
    })

    // ✓ Correct: parent signal threaded into child
    await scope({ signal: parent.signal }, async inner => {
      inner.spawn(async () => await sleep(1000, inner.signal))
    })
  })
})
```

This is deliberate. Ambient signal context was considered and rejected — a prior implementation lost the signal across `await` boundaries because of how `try/finally` around async calls interacts with the microtask queue. Explicit threading makes cancellation propagation visible at the call site and survives every code transformation.

If you forget, the failure mode is silent: the inner scope runs to completion ignoring parent cancellation. Treat `scope({...}, ...)` inside a task body as always needing `signal: parent.signal`.

## Patterns

Self-contained examples in the repo, grouped by domain:

- Backend: [`examples/backend/`](https://github.com/arijit-gogoi/jolly-coop-js/tree/main/examples/backend) — parallel fetch, rate-limited pipeline, API server simulation
- Frontend: [`examples/frontend/`](https://github.com/arijit-gogoi/jolly-coop-js/tree/main/examples/frontend) — dashboard loader, search with cancellation, component lifecycle
- CLI: [`examples/cli/`](https://github.com/arijit-gogoi/jolly-coop-js/tree/main/examples/cli) — file hash, downloader, build system
- Data pipelines: [`examples/data-pipeline/`](https://github.com/arijit-gogoi/jolly-coop-js/tree/main/examples/data-pipeline) — transform batch, fan-out/fan-in, streaming ETL
- Library authors: [`examples/library/`](https://github.com/arijit-gogoi/jolly-coop-js/tree/main/examples/library) — retry with backoff, async pool, pub/sub with lifecycle, **BFS with backpressure**
- Patterns: [`examples/patterns/`](https://github.com/arijit-gogoi/jolly-coop-js/tree/main/examples/patterns) — first-to-resolve, bounded channel, errors-as-values
- Other: [ai-ml](https://github.com/arijit-gogoi/jolly-coop-js/tree/main/examples/ai-ml), [gamedev](https://github.com/arijit-gogoi/jolly-coop-js/tree/main/examples/gamedev), [testing](https://github.com/arijit-gogoi/jolly-coop-js/tree/main/examples/testing)

All 27 examples run end-to-end: `npm run examples` (in a checkout of this repo).

## Runtime guarantees

Jolly v1 guarantees the following invariants. Violation of any of these indicates a bug in the runtime, not in user code.

1. **Tasks belong to exactly one scope.** Every task created by `spawn` is attached to the scope in which it was spawned. There are no orphan tasks.
2. **Resources belong to scopes.** Every resource registered with `resource` is owned by a scope and will be cleaned up when that scope exits.
3. **Scopes wait for tasks before exiting.** A scope does not resolve or reject until every child task has reached a terminal state (`COMPLETED`, `FAILED`, or `CANCELLED`).
4. **Scopes clean resources on exit.** After all tasks finish, the scope disposes all registered resources in reverse registration order before settling.
5. **The scheduler controls task execution.** Tasks execute only through the scheduler. They never run synchronously at the `spawn` call site.
6. **Cancellation propagates downward.** When a scope is cancelled, all child tasks and child scopes observe the cancellation.
7. **Concurrency limits are enforced.** When a limit is configured, no more than `limit` tasks run concurrently within the scope at any time.
8. **Scope fails on first error.** The first task error becomes the scope's rejection reason. The scope does not wait for other tasks to fail independently.
9. **Tasks cannot outlive their scope.** All tasks are either completed or cancelled before the scope exits. No task can continue running after its owning scope has settled.
10. **Task completion occurs exactly once.** A task resolves or rejects exactly once. The state machine prevents double completion.
11. **Spawned tasks begin execution through the scheduler.** Every task created by `spawn` is enqueued with the scheduler. No task bypasses scheduling.

## Platform support

Node 22+, Bun, Deno, browser. Zero dependencies. ESM only.

## Examples

27 self-contained examples across 9 categories: backend, frontend, CLI, library authors, game development, data pipelines, AI/ML, testing, and concurrency patterns.

See [examples/README.md](examples/README.md) for the full guide.

```bash
npm run examples              # run all 27
npm run examples -- backend   # run one category
npm run examples -- pipeline  # filter by keyword
```

## Specification

The full behavioral specification — execution semantics, task state machine, error model, cancellation, and compliance requirements — is in [spec/jolly-coop.md](spec/jolly-coop.md).

## Status

Pre-1.0. The API may change.

## License

[MIT](LICENSE)
