# Jolly

Structured concurrency runtime for JavaScript. Scoped task lifetimes, guaranteed cleanup, cooperative cancellation via AbortSignal, first-error-wins semantics.

## Introduction

JavaScript has excellent low-level async building blocks: promises, `async/await`, and `AbortController`. What it does not have is a model that enforces *structure* over concurrent work. Developers are left to manually track task lifetimes, wire up cancellation chains, and ensure resources are cleaned up across error paths. This leads to a well-known class of bugs — leaked connections, orphan promises, fire-and-forget tasks that silently fail, and inconsistent error handling when multiple concurrent operations interact.

Jolly addresses this by introducing a single organizing principle: **all async work lives inside scopes, and nothing escapes a scope**. A scope owns its tasks, waits for them to finish, cancels them when something goes wrong, and cleans up resources when it exits. The developer writes their concurrent logic; the runtime handles the lifecycle.

## Install

```bash
npm install jolly-coop
```

## Quick example

```js
import { scope, sleep } from "jolly-coop"

const results = await scope(async s => {
  const profile = s.spawn(async () => {
    const res = await fetch("https://api.example.com/profile")
    return res.json()
  })

  const feed = s.spawn(async () => {
    const res = await fetch("https://api.example.com/feed")
    return res.json()
  })

  // Both run concurrently. If either fails, the other is cancelled.
  // Resources are cleaned up. No leaked promises.
  return { profile: await profile, feed: await feed }
})
```

## API

### Exports

| Export | Signature | Description |
|--------|-----------|-------------|
| `scope` | `(fn) => Promise<T>` | Create a scope, run `fn`, wait for all tasks, clean up |
| `scope` | `(options, fn) => Promise<T>` | Same, with options (timeout, limit, signal) |
| `sleep` | `(ms) => Promise<void>` | Cancellation-aware sleep |
| `yieldNow` | `() => Promise<void>` | Yield to the scheduler, let other tasks run |
| `TimeoutError` | class | Thrown when a scope exceeds its timeout |

### Scope

| Method / Property | Signature | Description |
|-------------------|-----------|-------------|
| `spawn` | `(fn) => Task<T>` | Spawn a task. `fn` is `() => T \| Promise<T>` |
| `resource` | `(value, disposer) => Promise<T>` | Register a resource with cleanup on scope exit |
| `cancel` | `(reason?) => void` | Cancel the scope. Aborts signal, scope rejects |
| `done` | `() => void` | Signal work is complete. Aborts signal, scope resolves |
| `signal` | `AbortSignal` | Tied to scope lifetime. Pass to fetch, streams, etc. |
| `active` | `number` | Count of pending tasks (running + queued) |

### ScopeOptions

| Option | Type | Description |
|--------|------|-------------|
| `timeout` | `number` | Milliseconds before the scope times out |
| `deadline` | `number` | Absolute timestamp (`Date.now()` based) |
| `limit` | `number` | Max concurrent tasks |
| `signal` | `AbortSignal` | External signal to cancel the scope |

### Task

| Property | Type | Description |
|----------|------|-------------|
| `id` | `number` | Unique task identifier |
| `state` | `string` | `"running"`, `"completed"`, `"failed"`, or `"cancelled"` |

Tasks implement `PromiseLike<T>` and can be awaited.

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

## Status

Pre-1.0. The API may change.

## License

[MIT](LICENSE)
