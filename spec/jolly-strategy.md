# Jolly v1 — Implementation Strategy

*Scheduler Architecture, Tuning, and Runtime Decisions*

---

## 1. Introduction

This document defines the foundational runtime decisions for implementing a Jolly v1 compliant scheduler. These are the decisions that everything else — scopes, cancellation, fairness, resource cleanup — depends on. If the scheduler is wrong, the guarantees in the Jolly specification become unstable.

Three questions drive the entire implementation:

1. **What scheduling primitive should the runtime use?** — How does the scheduler yield control back to the event loop between batches of task execution?
2. **What scheduling strategy should tasks follow?** — How are tasks ordered, queued, and dispatched?
3. **Where does Jolly sit relative to the JavaScript event loop?** — Is the scheduler a replacement for the event loop, or a layer on top of it?

The answers to these questions determine the scheduler's throughput, latency, fairness, and portability characteristics. This document specifies the correct answers for v1 and explains why.

---

## 2. Choosing a Scheduling Primitive

The scheduling primitive is the mechanism the runtime uses to schedule its next batch of work. JavaScript offers three options: microtasks, macrotasks, and `MessageChannel`. Only one is correct for Jolly v1.

### 2.1 Microtasks — Do Not Use

Microtasks (`queueMicrotask`, `Promise.then`) execute before the event loop yields. This makes them dangerously aggressive as a scheduling primitive. A microtask-based scheduler creates a feedback loop — each task schedules the next via microtask, which runs immediately, which schedules another — and the event loop never gets a chance to process I/O, fire timers, or update the UI.

The failure mode is straightforward: `task → queueMicrotask → task → queueMicrotask → ...` This chain blocks `setTimeout` callbacks, `fetch` responses, and browser rendering indefinitely. Microtasks are too eager and too hungry. They are the wrong primitive for a cooperative scheduler.

### 2.2 Macrotasks — Acceptable as Fallback Only

Macrotasks (`setTimeout(fn, 0)`) do yield to the event loop, which makes them safe from a starvation perspective. However, they suffer from high latency. Browsers clamp `setTimeout` to a minimum of ~4ms after a few nested calls, and even in Node.js, the overhead is coarser than necessary. This makes macrotasks too slow for fine-grained scheduling where tasks may be very short-lived.

Macrotasks are acceptable as a **fallback** in environments where `MessageChannel` is unavailable, but they should not be the primary scheduling mechanism.

### 2.3 MessageChannel — The Correct Primitive

`MessageChannel` is the right scheduling primitive for Jolly v1. It is faster than `setTimeout` (no clamping), it yields to the event loop (so I/O and rendering are not starved), and it is widely supported across all target environments — Node.js, Bun, Deno, and browsers.

This is not a novel choice. React's scheduler uses `MessageChannel` for exactly the same reasons. The pattern is well-established in production systems: post a message to a `MessageChannel` port, and the handler fires on the next event loop turn, giving the runtime a chance to process I/O and timers between scheduler drains.

### 2.4 Final Decision

The scheduling primitive for Jolly v1 is:

- **Primary:** `MessageChannel`
- **Fallback:** `setTimeout` (for environments without `MessageChannel`)
- **Never:** A microtask-only scheduler

This decision is locked. It should not be revisited unless the target environment set changes fundamentally.

---

## 3. Scheduling Strategy

The scheduling strategy determines how tasks are ordered, queued, and dispatched for execution. Several strategies were evaluated for v1; only one fits the runtime's goals.

### 3.1 Goals

Jolly v1 optimizes for predictability, simplicity, and no starvation, with low overhead. It does not optimize for maximum throughput at the expense of fairness, nor does it attempt to provide real-time scheduling guarantees. The scheduler should be boring and correct.

### 3.2 Strategies Evaluated and Rejected

**Round-robin** requires explicit task list rotation and complex bookkeeping. It doesn't map naturally to async continuations in JavaScript, where tasks suspend and resume at arbitrary `await` points. The overhead is not justified for v1.

**Work-stealing** is designed for multi-threaded runtimes where idle threads can steal work from busy ones. It requires atomic state management, introduces debugging complexity, and solves a problem Jolly v1 doesn't have — true parallelism. This was correctly deferred from v1.

**Priority scheduling** adds API complexity (how do users specify priority?), introduces non-deterministic behavior (priority inversion, starvation of low-priority tasks), and conflicts with the v1 goal of keeping the API minimal. Avoid entirely in v1.

### 3.3 FIFO with Cooperative Yielding — The Correct Strategy

The correct strategy for Jolly v1 is a **single global FIFO queue with cooperative yielding and an execution budget**.

Tasks are appended to the tail of the queue when spawned. The scheduler executes tasks from the head. When the execution budget is exhausted (either by task count or elapsed time), the scheduler yields to the event loop via `MessageChannel` and resumes on the next turn.

Fairness is achieved not through preemption but through cooperation. Tasks yield voluntarily at `await` points, `yieldNow()` calls, and `sleep()` suspensions. Combined with the FIFO ordering, this ensures that no task is starved as long as tasks cooperate — which they must, since Jolly is a cooperative runtime.

This strategy works because the runtime is cooperative (not preemptive) and structured (bounded lifetime). Tasks don't run forever; they belong to scopes that eventually exit. The FIFO queue ensures that every task gets its turn in order, and the execution budget ensures the event loop gets its turn between batches.

---

## 4. Jolly's Relationship to the Event Loop

### 4.1 Jolly Sits Above the Event Loop

Jolly acts as a **userland scheduler layer** that sits on top of the JavaScript event loop. It does not replace the event loop — it coordinates on top of it.

```
JavaScript event loop
        ↓
  Jolly scheduler
        ↓
     Tasks
```

Jolly controls the ordering of tasks, when tasks run, and how cancellation propagates. But it still relies on the underlying runtime for I/O, timers, network operations, and everything else the event loop provides. When a task calls `fetch` or `setTimeout`, those operations go through the platform's event loop, not through Jolly.

### 4.2 Implications for Determinism

JavaScript cannot be made fully deterministic. I/O timing is external, event loop ordering varies across runtimes and platforms, and system load affects scheduling. Jolly does not attempt to overcome this.

What Jolly *can* guarantee is deterministic behavior for the things it controls:

- **Task lifecycle** — deterministic (state machine enforced)
- **Cancellation propagation** — deterministic (always downward, always through AbortSignal)
- **Scope completion** — deterministic (wait for all tasks, clean up resources, settle)
- **Scheduling order** — **not** deterministic (depends on event loop, I/O timing, and task yielding patterns)

Code that depends on specific task execution order is incorrect. Jolly guarantees *that* tasks run, not *when* they run relative to each other.

---

## 5. Scheduler Architecture

This section defines the exact architecture a Jolly v1 implementation should use.

### 5.1 Core Components

The scheduler consists of three components:

- **Ready queue** — A FIFO queue of tasks ready for execution.
- **MessageChannel trigger** — A `MessageChannel` instance whose port handler drains the ready queue.
- **Execution budget** — A limit on how much work the scheduler performs per drain cycle before yielding back to the event loop.

### 5.2 The Drain Loop

The scheduler's main loop dequeues and executes tasks until the budget is exhausted or the queue is empty:

```javascript
function drain() {
  let count = 0
  const start = performance.now()

  while (queue.length > 0) {
    const task = queue.shift()
    run(task)

    if (
      ++count >= MAX_TASKS ||
      performance.now() - start > MAX_TIME
    ) {
      scheduleNextTick()
      return
    }
  }
}
```

When the budget runs out, the scheduler calls `scheduleNextTick()` to post a message to the `MessageChannel`, which will fire the drain loop again on the next event loop turn. This ensures the event loop always gets a chance to process I/O between scheduler drains.

### 5.3 Task Scheduling

When a task is spawned, it is pushed onto the ready queue. If the scheduler isn't already scheduled to drain, it posts a message to trigger the next drain:

```javascript
function schedule(task) {
  queue.push(task)

  if (!scheduled) {
    scheduled = true
    messageChannel.postMessage(0)
  }
}
```

This is an important subtlety — the scheduler coalesces multiple `spawn` calls into a single drain cycle. If you spawn 100 tasks in a loop, only one `MessageChannel` message is posted, and all 100 tasks are available in the queue when the drain begins.

### 5.4 Yielding

`yieldNow()` is implemented by scheduling the current continuation as a task:

```javascript
function yieldNow() {
  return new Promise(resolve => {
    schedule(resolve)
  })
}
```

When a task calls `await yieldNow()`, it suspends, its continuation is placed at the back of the queue, and other tasks get a chance to run before it resumes. This is how cooperative fairness works — tasks voluntarily move to the back of the line.

---

## 6. Execution Budget and Tuning

Tuning the scheduler is about balancing two competing goals: **throughput** (finish work fast) and **responsiveness** (don't block the event loop). You control this balance via two parameters: the execution budget (how many tasks per drain) and yield frequency (how often tasks give control back).

### 6.1 What the Execution Budget Controls

The execution budget is the maximum amount of work the scheduler performs in a single drain cycle before yielding to the event loop. If the budget is too high, the scheduler starves I/O, delays timers, and freezes the UI in browser environments. If the budget is too low, the scheduler spends too much time context-switching between drain cycles and throughput suffers.

### 6.2 Count-Based vs. Time-Based Budgets

A simple count-based budget caps the number of tasks executed per drain cycle. This is easy to implement but has a flaw: tasks are not equal cost. One task might take 1 microsecond; another might take 5 milliseconds. A count of 500 could mean 0.5ms of work or 2.5 seconds of work, depending on the task mix.

A time-based budget caps the elapsed wall-clock time per drain cycle instead. This provides consistent responsiveness regardless of individual task cost:

```javascript
const SLICE_MS = 5

function drain() {
  const start = performance.now()

  while (queue.length > 0) {
    run(queue.shift())

    if (performance.now() - start > SLICE_MS) {
      scheduleNextTick()
      return
    }
  }
}
```

Time-based budgets are strictly better for responsiveness because they adapt to the actual cost of work rather than treating all tasks as equal.

### 6.3 The Hybrid Approach — Recommended for v1

The best v1 strategy combines both: a **maximum task count** and a **maximum time slice**. The scheduler yields when either limit is hit first:

```javascript
const MAX_TASKS = 5000
const MAX_TIME = 5 // milliseconds

function drain() {
  let count = 0
  const start = performance.now()

  while (queue.length > 0) {
    run(queue.shift())

    if (
      ++count >= MAX_TASKS ||
      performance.now() - start > MAX_TIME
    ) {
      scheduleNextTick()
      return
    }
  }
}
```

The count limit provides a safety net for pathological cases where `performance.now()` might be expensive or imprecise. The time limit provides the actual responsiveness guarantee. Together, they are robust and simple.

### 6.4 Recommended Defaults

For Jolly v1, the recommended starting configuration is:

- `MAX_TASKS = 5000`
- `MAX_TIME = 5` (milliseconds)

This provides good throughput without starving the event loop, and works well across Node.js and browser environments. These values can be adjusted based on benchmarking, but they are a safe, boring starting point.

### 6.5 Tuning by Workload

Different workload profiles may benefit from different budget configurations:

| Scenario | Task Budget | Time Slice |
|---|---|---|
| I/O-heavy (API calls, database queries) | 500 | 5ms |
| Mixed workload | 500–800 | 5ms |
| CPU-heavy (computation, parsing) | 800–1500 | 8ms |
| UI-sensitive (browser rendering) | 200–400 | 3ms |

However, for v1, a single static configuration is sufficient. Adaptive tuning can be added in future versions if benchmarking reveals a need.

---

## 7. Cooperative Yielding

The scheduler's execution budget controls fairness at the macro level — between drain cycles. But fairness *within* a drain cycle depends on tasks cooperating by yielding voluntarily.

### 7.1 Why the Scheduler Alone Is Not Enough

A task that runs a tight loop for 50ms without yielding will monopolize the scheduler for that entire duration, even if the budget is set to 5ms. The budget only checks between tasks, not within them. This means tasks themselves must be yield-aware.

### 7.2 Yield Points

Tasks should yield at natural suspension points:

- **`await` expressions** — Any `await` is an implicit yield point if the awaited value is not yet resolved.
- **`await yieldNow()`** — An explicit yield that moves the task to the back of the queue.
- **`await sleep(ms)`** — Suspends the task for a duration, freeing the scheduler to run other work.

### 7.3 Yield Frequency Guidelines

For CPU-bound loops, the recommended heuristic is to yield every 0.5–2ms of CPU work. In practice, this translates to yielding roughly every 500–2,000 iterations, depending on the cost per iteration:

```javascript
for (let i = 0; i < N; i++) {
  doWork(i)

  if (i % 1000 === 0) {
    await yieldNow()
  }
}
```

This is a guideline, not a hard rule. The right frequency depends on the workload. But the principle is absolute: **never run unbounded loops without yielding**.

### 7.4 Two Kinds of Yielding

There is an important distinction between the two kinds of yielding in Jolly:

- **`MessageChannel` yielding** — The scheduler yields to the *event loop*. This allows I/O callbacks, timers, and rendering to proceed. This is event loop fairness.
- **`yieldNow()` yielding** — A task yields to the *scheduler*. This allows other tasks in the run queue to proceed. This is inter-task fairness.

Together, they provide both levels of fairness that a cooperative runtime needs.

---

## 8. Adaptive Budget (Optional)

For v1, a static budget configuration is sufficient. However, a simple adaptive heuristic can be added if needed:

```javascript
if (queue.length > 1000) {
  MAX_TASKS = 1000  // large backlog: prioritize throughput
} else {
  MAX_TASKS = 300   // small backlog: prioritize responsiveness
}
```

The idea is simple: when there's a large backlog of work, the scheduler should lean toward throughput (larger budget). When the backlog is small, it should lean toward responsiveness (smaller budget). This is a minor optimization and should be kept simple for v1 — complex adaptive schedulers introduce instability.

---

## 9. Detecting Starvation

Starvation occurs when the scheduler monopolizes the event loop, preventing I/O, timers, and rendering from executing in a timely manner. The primary signal for starvation is **event loop lag** — the difference between when a timer was expected to fire and when it actually fires.

A simple starvation detector:

```javascript
const lag = performance.now() - expectedTime
```

If lag grows consistently, the scheduler's budget is too aggressive and should be reduced. In production, event loop lag should remain under 5ms. Lag above 20ms indicates a serious tuning problem.

This metric is critical for benchmarking and should be measured alongside throughput and latency during development.

---

## 10. Anti-Patterns

The following patterns must be avoided in a Jolly v1 implementation. They are common mistakes in async scheduler design and each leads to observable failures.

**Infinite microtask loops.** Scheduling the next drain via `queueMicrotask` instead of `MessageChannel` creates an unbreakable loop that starves the event loop entirely. I/O never completes, timers never fire, and the browser freezes.

**Unbounded drain loops.** Running the drain loop until the queue is empty, without any budget limit, allows a burst of task spawns to monopolize the runtime for an arbitrary duration.

**Complex adaptive schedulers.** Sophisticated heuristics that adjust budget, priority, and fairness dynamically add significant complexity and are difficult to reason about. For v1, simplicity and correctness are more important than optimal scheduling in every scenario.

**Priority queues.** Adding priority to tasks requires API surface changes, introduces starvation risk for low-priority tasks, and makes scheduling behavior non-deterministic. This is explicitly excluded from v1.

---

## 11. Implementation Size Estimate

The scheduler described in this document — a FIFO queue with `MessageChannel` triggering, hybrid budget, and cooperative yielding — is approximately **150–200 lines of code**. This is intentional. A scheduler this small is easy to audit, debug, and maintain. The simplicity is a feature, not a limitation.

---

## 12. Portability

The scheduler design described here is portable across all Jolly v1 target environments:

- **Node.js** — `MessageChannel` available via `worker_threads` or global (v15+). Fallback to `setTimeout`.
- **Bun** — `MessageChannel` supported natively.
- **Deno** — `MessageChannel` supported natively.
- **Browsers** — `MessageChannel` supported in all modern browsers.

No environment-specific code paths are needed beyond the `MessageChannel` / `setTimeout` fallback.

---

## 13. Precedent

This design is not novel. It follows established patterns from production systems:

- **React's scheduler** uses `MessageChannel` with cooperative yielding and a time-sliced execution budget. React's scheduler is arguably the most battle-tested userland JavaScript scheduler in existence.
- **Async runtimes** (Tokio in Rust, Go's goroutine scheduler) use cooperative FIFO scheduling with budget-based yielding. The concepts translate directly to JavaScript's single-threaded model.

Jolly's scheduler is simpler than React's because it does not need priority lanes or transition scheduling. But the core mechanism — `MessageChannel` + FIFO + budget — is the same proven pattern.

---

## 14. Summary of Locked Decisions

The following decisions are final for Jolly v1 and should not be revisited without significant justification.

**Scheduling primitive:** `MessageChannel` as primary, `setTimeout` as fallback. Microtasks are never used as the scheduling primitive.

**Scheduling strategy:** Single global FIFO queue with cooperative yielding and a hybrid execution budget (task count + time slice).

**Runtime position:** Jolly sits above the JavaScript event loop as a userland scheduler layer. It does not replace the event loop. It relies on the event loop for I/O, timers, and platform services.

**Determinism scope:** Task lifecycle, cancellation propagation, and scope completion are deterministic. Scheduling order is not deterministic and is not guaranteed.

**Default tuning:** `MAX_TASKS = 5000`, `MAX_TIME = 5ms`. Tasks should yield via `yieldNow()` in long-running loops.

**Complexity budget:** The scheduler should be approximately 150–200 lines of code. If it grows significantly beyond this, the design is too complex for v1.

These decisions produce a scheduler that is simple, portable, predictable, and debuggable — the correct foundation for a structured concurrency runtime.

---

*This document forms the implementation strategy companion to the Jolly v1 specification. Together, they define both the behavioral contract and the architectural approach for the runtime.*
