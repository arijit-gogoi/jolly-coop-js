# Jolly

Structured concurrency runtime for JavaScript. Scoped task lifetimes, guaranteed cleanup, cooperative cancellation via AbortSignal, first-error-wins semantics.

## Install

```bash
npm install jolly
```

## Quick example

```js
import { scope, sleep } from "jolly"

const results = await scope(async s => {
  const profile = s.spawn(async () => {
    const res = await fetch("https://api.example.com/profile")
    return res.json()
  })

  const feed = s.spawn(async () => {
    const res = await fetch("https://api.example.com/feed")
    return res.json()
  })

  // Both run in parallel. If either fails, the other is cancelled.
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
| `active` | `number` | Count of running tasks |

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

## Platform support

Node 16+, Bun, Deno, browser. Zero dependencies. 11.6KB ESM bundle.

All 136 tests pass on Node, Bun, and Deno.

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
