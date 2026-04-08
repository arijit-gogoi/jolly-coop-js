# Jolly v1 — Comprehensive Specification

*Structured Concurrency for JavaScript*

---

## 1. Introduction

Jolly is a structured concurrency runtime for JavaScript. It provides deterministic task lifetimes, cancellation propagation, and scoped resource management — the foundational primitives that JavaScript's async ecosystem currently lacks.

JavaScript has excellent low-level async building blocks: promises, `async/await`, and `AbortController`. What it does not have is a model that enforces *structure* over concurrent work. Developers are left to manually track task lifetimes, wire up cancellation chains, and ensure resources are cleaned up across error paths. This leads to a well-known class of bugs — leaked connections, orphan promises, fire-and-forget tasks that silently fail, and inconsistent error handling when multiple concurrent operations interact.

Jolly addresses this by introducing a single organizing principle: **all async work lives inside scopes, and nothing escapes a scope**. A scope owns its tasks, waits for them to finish, cancels them when something goes wrong, and cleans up resources when it exits. The developer writes their concurrent logic; the runtime handles the lifecycle.

This specification defines the public API, execution semantics, runtime guarantees, task lifecycle, error model, and cancellation behavior for Jolly v1. It forms the contract between the runtime and its users. Any compliant implementation must uphold every guarantee described here.

### 1.1 Target Environments

This specification targets single-process JavaScript runtimes:

- Node.js
- Bun
- Deno
- Browsers

Distributed execution, multi-process coordination, and shared-memory parallelism are outside the scope of v1.

---

## 2. Terminology

This section defines the core concepts used throughout the specification.

### 2.1 Scope

A **scope** is a structured concurrency boundary. It owns tasks, child scopes, and resources. A scope represents a *lifetime region* — everything created within it is guaranteed to be completed or cancelled, and all resources cleaned up, before the scope exits. Scopes form a tree: a scope may contain child scopes, and cancellation propagates downward through this tree.

### 2.2 Task

A **task** is a unit of asynchronous work created by `spawn`. Every task belongs to exactly one scope. Tasks are the primary mechanism for expressing concurrency within Jolly. They follow a strict state machine that governs their lifecycle from creation through terminal completion.

### 2.3 Resource

A **resource** is a value paired with a disposer function, registered with a scope. When the scope exits — whether through successful completion, error, or cancellation — the runtime calls the disposer to clean up the resource. This guarantees deterministic cleanup of connections, file handles, subscriptions, and any other external state.

### 2.4 Cancellation

**Cancellation** is a cooperative signal propagated through the scope tree. When a scope is cancelled, it requests that its tasks terminate early. Cancellation does not forcibly interrupt execution; tasks observe the cancellation signal and choose to stop. This cooperative model integrates cleanly with JavaScript's existing `AbortSignal` mechanism.

---

## 3. Public API

Jolly v1 exposes a deliberately minimal API surface. The entire library reduces to one core function, two scheduling primitives, a small set of interfaces, and a single error type. There are no global configuration objects, no class hierarchies, no event emitters, and no hidden lifecycle hooks.

### 3.1 Exports

```typescript
// Core
export function scope<T>(
  fn: (s: Scope) => Promise<T> | T
): Promise<T>

export function scope<T>(
  options: ScopeOptions,
  fn: (s: Scope) => Promise<T> | T
): Promise<T>

// Scheduling primitives
export function sleep(ms: number): Promise<void>
export function yieldNow(): Promise<void>

// Types
export interface Scope {
  spawn<T>(fn: () => Promise<T> | T): Task<T>

  resource<T>(
    value: Promise<T> | T,
    disposer: (value: T) => Promise<void> | void
  ): Promise<T>

  cancel(reason?: any): void

  readonly signal: AbortSignal
}

export interface Task<T> extends PromiseLike<T> {
  readonly id: number
  readonly state: "running" | "completed" | "failed" | "cancelled"
}

export interface ScopeOptions {
  timeout?: number
  deadline?: number
  limit?: number
  signal?: AbortSignal
}

// Errors
export class TimeoutError extends Error {}
```

### 3.2 `scope(options?, fn)`

The `scope` function is the single entry point for all structured concurrent work. It creates a new scope, passes it to the provided function, waits for all spawned tasks to complete, cleans up resources, and then resolves or rejects.

When called with an options object, the scope is configured with timeouts, deadlines, concurrency limits, or an external abort signal. When called with only a function, default behavior applies (no timeout, no limit, no external signal).

The scope returns a promise that resolves with the return value of `fn`, or rejects with the first error thrown by any child task.

### 3.3 `sleep(ms)`

Suspends the current task for the specified number of milliseconds. The sleep is cancellation-aware — if the scope is cancelled while a task is sleeping, the sleep resolves early and the task can observe the cancellation signal.

### 3.4 `yieldNow()`

Yields control back to the scheduler, allowing other tasks in the run queue to execute. This enables cooperative multitasking within a scope. Long-running computational tasks should call `yieldNow` periodically to avoid starving other tasks.

### 3.5 `Scope.spawn(fn)`

Creates a new task within the scope. The function `fn` must be a callable that returns a value, a promise, or an async function. `spawn` does **not** accept raw promises — it requires a function so that the runtime controls when execution begins.

The returned `Task` object implements `PromiseLike` and can be awaited to retrieve the task's result. The task begins execution under scheduler control, not synchronously at the call site.

### 3.6 `Scope.resource(value, disposer)`

Registers a resource with the scope. The `value` may be a direct value or a promise that resolves to the value. The `disposer` is a function called with the resolved value when the scope exits. Disposers may be synchronous or asynchronous.

Resources are cleaned up in **reverse registration order** — the last resource registered is the first to be disposed. This mirrors the stack-like semantics familiar from other resource management patterns (e.g., `defer` in Go, RAII in C++).

### 3.7 `Scope.cancel(reason?)`

Manually cancels the scope. This marks the scope as cancelled, triggers the abort signal, and propagates cancellation to all child tasks and child scopes. An optional reason may be provided for diagnostic purposes. Calling `cancel` multiple times is safe and idempotent.

### 3.8 `Scope.signal`

A read-only `AbortSignal` tied to the scope's lifetime. Tasks can pass this signal to cancellation-aware APIs like `fetch`, readable streams, or any other API that accepts an `AbortSignal`. When the scope is cancelled, this signal aborts automatically.

### 3.9 `Task`

A `Task` represents a unit of work within a scope. It extends `PromiseLike`, so it can be awaited like a standard promise. Each task has a unique numeric `id` and a `state` property reflecting its current position in the lifecycle state machine.

### 3.10 `ScopeOptions`

Configuration for a scope's behavior:

- **`timeout`** — A relative duration in milliseconds. If the scope hasn't completed within this window, it cancels itself and rejects with a `TimeoutError`.
- **`deadline`** — An absolute timestamp (milliseconds since epoch). Functions like `timeout` but expressed as a point in time rather than a duration.
- **`limit`** — The maximum number of tasks that may run concurrently within the scope. Excess tasks are queued and start as running tasks complete.
- **`signal`** — An external `AbortSignal` that, when aborted, cancels the scope. This allows integration with external cancellation sources.

### 3.11 `TimeoutError`

A dedicated error class thrown when a scope exceeds its configured timeout or deadline. Extends the built-in `Error` class.

---

## 4. Execution Semantics

### 4.1 Scope Lifecycle

When `scope(fn)` is called, the runtime executes the following sequence:

1. **Create** a new scope with its own `AbortController`, task counter, resource stack, and optional configuration.
2. **Run** `fn(scope)`, giving the user function access to the scope's API.
3. **Wait** for all child tasks to complete (or be cancelled).
4. **Clean up** all registered resources in reverse order.
5. **Resolve** with the return value of `fn`, or **reject** with the first error encountered.

The scope does not resolve until every spawned task has reached a terminal state. This is the core structured concurrency guarantee — work cannot leak out of a scope.

### 4.2 Spawn Semantics

When `s.spawn(fn)` is called:

1. A new `Task` object is created in the `CREATED` state.
2. The task is attached to the scope, incrementing the scope's active task count.
3. The task is handed to the scheduler for execution.

The task does not execute synchronously at the `spawn` call site. The scheduler determines when it runs. This indirection is essential for concurrency limit enforcement and cooperative scheduling.

`spawn` requires a function, not a promise. This is an intentional design constraint — it ensures the runtime controls when work begins, which is necessary for limits, cancellation of not-yet-started tasks, and deterministic lifecycle management.

### 4.3 Awaiting Tasks

Tasks implement `PromiseLike` and can be awaited using standard `await` syntax. Awaiting a task suspends the current execution until the task reaches a terminal state, then resolves with the task's result value or rejects with its error.

```typescript
const task = s.spawn(fetchUser)
const user = await task
```

Tasks can also be used anywhere a `PromiseLike` is accepted — passed to `Promise.all`, stored in arrays, or composed with other async patterns.

---

## 5. Cancellation Semantics

### 5.1 How Cancellation Works

Cancellation in Jolly is **cooperative and downward-propagating**. When a scope is cancelled — whether manually via `scope.cancel()`, by a timeout/deadline, by an external abort signal, or because a child task failed — the following happens:

1. The scope is marked as cancelled internally.
2. The scope's `AbortController` is aborted, which triggers its `AbortSignal`.
3. All child tasks observe the cancellation through the signal.
4. All child scopes are cancelled recursively.

Cancellation does **not** forcibly interrupt a running task. JavaScript has no preemption mechanism, so tasks must cooperate by checking the abort signal, passing it to signal-aware APIs, or awaiting cancellation-aware primitives like `sleep`.

### 5.2 Cancellation Is Idempotent

Calling `cancel()` on an already-cancelled scope is a no-op. The abort signal fires at most once, and duplicate cancellation requests are silently ignored.

### 5.3 Cancellation of Queued Tasks

When a scope with a concurrency limit is cancelled, tasks that are still in the queue (in the `CREATED` state, not yet running) transition directly to `CANCELLED` without ever executing. This is a key efficiency property — the runtime avoids starting work that would be immediately cancelled.

### 5.4 Integration with AbortSignal

The scope's `signal` property is a standard `AbortSignal`. This means Jolly's cancellation integrates natively with:

- `fetch(url, { signal: s.signal })`
- Readable and writable streams
- Any third-party API that accepts an `AbortSignal`

No custom cancellation protocol is needed. Jolly builds on the platform's existing mechanism.

---

## 6. Error Semantics

### 6.1 The First Error Rule

When a task within a scope throws an error, the runtime applies a simple deterministic rule:

1. The **first error** thrown becomes the scope's primary error.
2. The scope **cancels all remaining tasks** (both running and queued).
3. The scope **rejects** with the primary error.

This is a fail-fast strategy. The scope does not wait for other tasks to finish naturally once an error occurs — it cancels them and propagates the first failure upward.

### 6.2 Secondary Errors

Errors thrown by tasks that are being cancelled (as a result of the first error) are **captured internally and discarded**. They do not replace the primary error, they are not aggregated, and they are not thrown.

This is an intentional design choice. Aggregating errors from cancelled tasks would introduce nondeterminism — the set of secondary errors depends on timing, which tasks have started, and how far along they are when cancellation arrives. By committing to the first error only, Jolly produces deterministic, predictable error behavior.

### 6.3 Error and Cancellation Interaction

When a task fails and the scope cancels sibling tasks, some of those siblings may throw errors during their cancellation (for example, an abort error from `fetch`). These cancellation-induced errors are secondary and are suppressed by the runtime. Only the original causal error surfaces.

---

## 7. Concurrency Limits

### 7.1 Configuration

Scopes can specify a maximum number of concurrently running tasks:

```typescript
await scope({ limit: 5 }, async s => {
  for (const url of urls) {
    s.spawn(() => fetch(url))
  }
})
```

### 7.2 Behavior

When a concurrency limit is set:

1. The first `limit` tasks spawned are immediately scheduled for execution.
2. Subsequent tasks are placed in a **queue** in the `CREATED` state.
3. When a running task completes (reaches any terminal state), the next queued task is dequeued and scheduled.

This guarantees that at any given moment, no more than `limit` tasks are actively executing within the scope. Limit enforcement is deterministic — it does not depend on timing or scheduling order.

### 7.3 Queued Task Cancellation

If the scope is cancelled while tasks are queued, all queued tasks transition directly from `CREATED` to `CANCELLED` without executing.

---

## 8. Resource Management

### 8.1 Registration

Resources are registered with a scope using the `resource` method:

```typescript
const conn = await s.resource(
  openConnection(),
  c => c.close()
)
```

The first argument is the resource value (or a promise resolving to it). The second argument is a disposer function that will be called with the resolved value when the scope exits.

### 8.2 Ownership

Resources belong to the scope they are registered with. The scope is responsible for calling the disposer when it exits, regardless of *how* it exits — whether by successful completion, error, or cancellation.

### 8.3 Cleanup Order

Resources are disposed in **reverse registration order**. If resource A is registered first and resource B second, then B's disposer runs before A's. This stack-like ordering ensures that resources which depend on earlier resources are cleaned up first.

### 8.4 Cleanup Timing

Resource cleanup happens **after** all tasks in the scope have reached terminal states, but **before** the scope's promise resolves or rejects. The full sequence is: tasks complete → resources clean up → scope settles.

### 8.5 Async Disposers

Disposer functions may be synchronous or asynchronous. The runtime awaits each disposer before proceeding to the next, maintaining the reverse-order guarantee even for async cleanup.

---

## 9. Timeout and Deadline Semantics

### 9.1 Timeout

A timeout specifies a **relative duration** in milliseconds:

```typescript
await scope({ timeout: 5000 }, async s => {
  // Must complete within 5 seconds
})
```

If the scope has not completed when the timeout elapses, the runtime cancels the scope and rejects with a `TimeoutError`.

### 9.2 Deadline

A deadline specifies an **absolute point in time** as a timestamp (milliseconds since epoch):

```typescript
await scope({ deadline: Date.now() + 5000 }, async s => {
  // Must complete before the deadline
})
```

Deadlines behave identically to timeouts in terms of cancellation and error behavior, but are expressed as fixed points rather than durations. This makes them composable — a deadline can be computed once and passed down through nested scopes.

### 9.3 Early Completion

If the scope completes before the timeout or deadline, the timer is cleaned up and has no effect. The scope resolves normally.

---

## 10. Scheduler Semantics

### 10.1 Scheduler Role

The runtime includes a scheduler that controls when tasks execute. All task execution flows through the scheduler — tasks never run synchronously at the `spawn` call site.

### 10.2 Cooperative Yielding

Tasks may yield control back to the scheduler by calling `yieldNow()`. This allows other tasks in the run queue to make progress. Long-running computational work should yield periodically to maintain responsiveness.

### 10.3 Scheduling Order

The specification does **not** guarantee a specific execution order for tasks. The scheduler may execute tasks in any order, and different implementations may use different scheduling strategies. What is guaranteed is that all spawned tasks *will* execute (unless cancelled) and that concurrency limits are respected.

### 10.4 Fairness

The scheduler does not guarantee fairness across scopes. A scope with many tasks may receive more execution time than a scope with few. Fairness guarantees are outside the scope of v1.

---

## 11. Task State Machine

Every task in Jolly follows a strict state machine that governs its lifecycle. This state machine is the core correctness model for the runtime — it prevents double completions, execution after cancellation, orphan tasks, and incorrect error propagation.

### 11.1 States

A task exists in exactly one of five states at any given time:

- **`CREATED`** — The task object exists, but execution has not begun. The task has been attached to a scope and is either in the scheduler's run queue or a concurrency limit queue. Its function has not been invoked.

- **`RUNNING`** — The scheduler has started executing the task's function. The task may be actively computing, suspended on an `await`, or yielded. It remains in this state until it reaches a terminal outcome.

- **`COMPLETED`** — The task finished successfully. Its function returned a value (or a promise that resolved). The result is available to anyone awaiting the task.

- **`FAILED`** — The task threw an error (or its function returned a promise that rejected). The error has been captured and propagated to the scope's error handling logic.

- **`CANCELLED`** — The task was cancelled before it could complete. This may happen before execution (while queued) or during execution (while running or suspended).

### 11.2 Valid Transitions

The following state transitions are the **only** legal transitions:

| From | To | Cause |
|---|---|---|
| `CREATED` | `RUNNING` | Scheduler starts the task |
| `CREATED` | `CANCELLED` | Scope cancelled before task executed |
| `RUNNING` | `COMPLETED` | Task function resolves successfully |
| `RUNNING` | `FAILED` | Task function throws an error |
| `RUNNING` | `CANCELLED` | Scope cancelled while task was running |

### 11.3 Terminal States

`COMPLETED`, `FAILED`, and `CANCELLED` are terminal. Once a task enters a terminal state, it **cannot transition again**. This invariant prevents a wide class of concurrency bugs:

- A completed task cannot later be marked as failed.
- A cancelled task cannot later be marked as completed.
- A failed task cannot be retried or restarted.

### 11.4 Illegal Transitions

Any transition not listed in Section 11.2 is illegal and indicates a runtime bug. Examples of illegal transitions include:

- `COMPLETED` → `FAILED`
- `FAILED` → `COMPLETED`
- `CANCELLED` → `RUNNING`
- `RUNNING` → `CREATED`

### 11.5 Transition Enforcement

Each transition is enforced by a specific subsystem:

| Transition | Enforced By |
|---|---|
| `CREATED` → `RUNNING` | Scheduler |
| `CREATED` → `CANCELLED` | Spawn + cancellation system |
| `RUNNING` → `COMPLETED` | Task execution wrapper |
| `RUNNING` → `FAILED` | Task execution wrapper |
| `RUNNING` → `CANCELLED` | Cancellation system |

The runtime should include a transition guard that validates every state change and throws on illegal transitions.

### 11.6 State Diagram

```
        spawn()
           │
           ▼
        CREATED ──────────────┐
           │                  │
           ▼                  ▼
        RUNNING           CANCELLED
        │  │  │
        │  │  │
        ▼  ▼  ▼
  COMPLETED FAILED CANCELLED
```

---

## 12. Nested Scopes

Scopes may be nested. A task within a parent scope can create a child scope using the `scope` function:

```typescript
await scope(async s => {
  s.spawn(async () => {
    await scope(async inner => {
      inner.spawn(taskA)
      inner.spawn(taskB)
    })
  })
})
```

Each nested scope is an independent structured concurrency boundary with its own tasks, resources, and cancellation. However, because the child scope runs within a task owned by the parent scope, cancellation of the parent propagates to the child — the parent's abort signal triggers the child scope's cancellation.

Nested scopes are the primary mechanism for composing structured concurrent operations. A function that uses Jolly internally can be called from within another scope without any special integration.

---

## 13. Runtime Guarantees

Jolly v1 guarantees the following invariants. Violation of any of these indicates a bug in the runtime implementation, not in user code.

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

### 13.1 Guarantee Enforcement by Subsystem

Each guarantee maps to a specific subsystem in the runtime architecture:

| Guarantee | Enforced By |
|---|---|
| Tasks belong to scopes | Task system + Scope system |
| Resources belong to scopes | Resource subsystem |
| Scopes wait for tasks | Scope lifecycle manager |
| Scopes clean resources | Resource manager |
| Scheduler controls execution | Scheduler subsystem |
| Cancellation propagates downward | Scope cancellation logic |
| Limits enforce concurrency | Concurrency limit subsystem |
| Scope fails on first error | Task error handling + scope cancellation |
| Tasks cannot outlive scope | Scope lifecycle manager |
| Task completion happens once | Task lifecycle logic (state machine) |
| Spawned tasks begin under scheduler | `spawn()` implementation |

---

## 14. Determinism

Jolly provides deterministic behavior for the following aspects of execution:

- **Task lifetime** — Tasks are created, run, and terminated according to the state machine. The lifecycle is deterministic.
- **Scope completion** — A scope always waits for all tasks and cleans up all resources before settling. The sequence is deterministic.
- **Resource cleanup** — Resources are always disposed in reverse registration order. The order is deterministic.
- **Cancellation propagation** — Cancellation always flows downward through the scope tree. The propagation is deterministic.

**Scheduling order is not deterministic.** The order in which tasks execute may vary between runs and between implementations. Code that depends on specific task execution order is incorrect. Jolly guarantees *that* tasks run, not *when* they run relative to each other.

---

## 15. Compatibility

Jolly integrates with the existing JavaScript async ecosystem through standard mechanisms:

- **Promise compatibility** — Tasks implement `PromiseLike` and can be awaited, passed to `Promise.all`, or used anywhere a promise is expected. Tasks may also await any standard promise internally.
- **AbortSignal propagation** — Scopes expose a standard `AbortSignal` that integrates with `fetch`, streams, and any API that supports signal-based cancellation.
- **async/await support** — The entire API is designed around `async/await`. No callbacks, no event emitters, no special syntax.

---

## 16. Implementation Freedom

Runtime implementations may vary in their internal strategies as long as all behavioral guarantees in this specification are upheld. Implementations may:

- Use different scheduling strategies (FIFO, round-robin, work-stealing, etc.)
- Optimize task queues and data structures
- Use `MessageChannel`, macrotasks, or other event-loop-yielding primitives for scheduling (microtasks must not be used as the primary scheduling mechanism — they run before the event loop yields, which can starve I/O, timers, and rendering)
- Employ web workers for parallel execution (while maintaining the single-scope-thread model)

The specification constrains *observable behavior*, not internal architecture.

---

## 17. What v1 Does NOT Provide

To keep the runtime focused and the API stable, Jolly v1 intentionally excludes the following:

- **No global scheduler configuration.** The scheduler is internal and not configurable by the user.
- **No task groups.** All grouping is done through scopes.
- **No priority system.** Tasks have no priority. All are equal within a scope.
- **No manual task handles.** Tasks cannot be paused, resumed, or restarted.
- **No event emitters.** No task lifecycle events are emitted.
- **No debugging APIs.** No introspection hooks for observing scheduler state.
- **No parallel CPU scheduling.** v1 targets cooperative concurrency, not true parallelism.
- **No distributed execution.** Cross-process or cross-machine coordination is not supported.
- **No fairness guarantees across scopes.** Scopes do not get equal time slices.

These features may be considered for future versions but are out of scope for v1.

---

## 18. Usage Patterns

This section demonstrates idiomatic Jolly usage for common async patterns.

### 18.1 Basic Parallel Tasks

```typescript
import { scope } from "jolly"

await scope(async s => {
  const user = s.spawn(fetchUser)
  const posts = s.spawn(fetchPosts)

  return {
    user: await user,
    posts: await posts
  }
})
```

Both tasks run in parallel. The scope waits for both. If either fails, the other is cancelled and the scope rejects with the first error.

### 18.2 Sequential Within Parallel

```typescript
await scope(async s => {
  const user = await s.spawn(fetchUser)
  const posts = s.spawn(() => fetchPosts(user.id))

  return await posts
})
```

The first task completes before the second is spawned. This allows data dependencies between tasks while still benefiting from structured lifetime management.

### 18.3 Fail-Fast Error Propagation

```typescript
await scope(async s => {
  s.spawn(async () => {
    throw new Error("fail")
  })

  s.spawn(async () => {
    await sleep(100)
    console.log("never runs")
  })
})
```

The first task's error cancels the second task. The scope rejects with the error. The second task's work is never completed.

### 18.4 Timeout

```typescript
import { scope, TimeoutError } from "jolly"

await scope({ timeout: 1000 }, async s => {
  s.spawn(async () => {
    await sleep(5000) // takes too long
  })
})
// Throws TimeoutError after 1 second
```

### 18.5 Concurrency-Limited Work

```typescript
await scope({ limit: 5 }, async s => {
  for (const url of urls) {
    s.spawn(() => fetch(url))
  }
})
```

At most 5 fetches run concurrently. The rest queue and start as earlier ones complete.

### 18.6 Resource Scoping

```typescript
await scope(async s => {
  const conn = await s.resource(
    openConnection(),
    c => c.close()
  )

  s.spawn(() => conn.query("SELECT * FROM users"))
})
```

The connection is guaranteed to be closed when the scope exits, regardless of whether the query succeeds, fails, or is cancelled.

### 18.7 Integration with Fetch and AbortSignal

```typescript
await scope(async s => {
  const res = await s.spawn(() =>
    fetch(url, { signal: s.signal })
  )

  return res.json()
})
```

The scope's signal is passed to `fetch`. If the scope is cancelled, the HTTP request is aborted automatically.

### 18.8 Manual Cancellation

```typescript
await scope(async s => {
  s.spawn(async () => {
    await sleep(1000)
  })

  s.cancel()
})
```

### 18.9 Nested Scopes

```typescript
await scope(async s => {
  s.spawn(async () => {
    await scope(async inner => {
      inner.spawn(taskA)
      inner.spawn(taskB)
    })
  })
})
```

Each scope is isolated. The inner scope completes before its parent task completes.

### 18.10 Cooperative Yielding

```typescript
await scope(async s => {
  s.spawn(async () => {
    for (let i = 0; i < 1000; i++) {
      heavyComputation(i)
      await yieldNow()
    }
  })
})
```

Yielding allows the scheduler to interleave other tasks between iterations of the loop.

### 18.11 Deadline

```typescript
await scope(
  { deadline: Date.now() + 1000 },
  async s => {
    s.spawn(longRunningTask)
  }
)
```

---

## 19. API Design Philosophy

The Jolly API enforces a strict mental model:

- **All work lives inside scopes.** There is no way to spawn a task outside a scope.
- **Tasks belong to scopes.** There are no free-floating tasks.
- **Nothing escapes a scope.** When a scope exits, everything it started is done.

Developers never manually manage task lifecycle, cleanup logic, or cancellation propagation. The runtime handles all of it. This makes concurrent code *locally reasonable* — you can look at a scope block and know exactly what it owns, what it waits for, and what gets cleaned up.

The API is small by design. Six functions and methods, four types, one error class. This minimizes API churn, makes the library easy to learn, and makes it hard to misuse.

---

## 20. Versioning and Forward Compatibility

This specification defines Jolly v1 semantics. Future versions may extend the API — for example, by adding task groups, priority scheduling, or debugging hooks — but must not break:

- Scope semantics
- Task lifecycle guarantees
- Cancellation behavior
- Resource cleanup ordering
- Error propagation rules

Any program that is correct under v1 must remain correct under future versions.

---

## 21. Compliance

An implementation is **Jolly v1 compliant** if and only if:

1. All API contracts described in Section 3 are implemented and behave as specified.
2. All runtime guarantees listed in Section 13 hold under all circumstances.
3. All task state machine transitions conform to Section 11.
4. All lifecycle semantics — scope execution order, resource cleanup ordering, cancellation propagation, and error handling — behave as described in this specification.

---

## Appendix A: Guarantee Enforcement Architecture

The following diagram shows how runtime guarantees map to implementation subsystems:

```
Scope System
 ├── Tasks belong to scopes
 ├── Scopes wait for tasks
 ├── Tasks cannot outlive scopes
 └── Cancellation propagation

Task System
 ├── Task completion exactly once
 └── Spawn semantics

Scheduler
 ├── Scheduler controls execution
 └── Cooperative yielding

Concurrency Limits
 └── Limit enforcement

Resources
 └── Resource cleanup
```

Each guarantee is enforced by exactly one subsystem. This separation keeps the architecture clean and makes it straightforward to test each guarantee in isolation.

## Appendix B: Test Coverage Requirements

A production-ready Jolly v1 implementation should include a comprehensive test suite covering the following areas with approximately the following distribution:

| Area | Approximate Test Count |
|---|---|
| Scope behavior | 20 |
| Task lifecycle | 20 |
| Cancellation | 20 |
| Concurrency limits | 15 |
| Resource safety | 15 |
| Timeouts and deadlines | 10 |
| Scheduler and yielding | 10 |
| Nested scopes | 10 |
| Stress and race conditions | 10 |
| **Total** | **~130** |

Tests should verify both the happy path and edge cases: error-cancel races, cleanup during failure, queued task cancellation, nested scope propagation, and concurrent limit enforcement under load. The test suite should run across all target environments (Node, Bun, Deno, and optionally browsers) via a CI matrix.

A healthy test-to-implementation ratio for a correctness-critical library like Jolly is roughly 3:1 — more lines of test code than implementation code.

---

*This document forms the complete contract between the Jolly v1 runtime and its users.*
