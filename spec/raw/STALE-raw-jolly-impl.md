> **STALE / SCRATCH** — This is an early unstructured draft. The authoritative specs are in `spec/jolly-coop.md`, `spec/jolly-strategy.md`, and `spec/jolly-benchmarking.md`. Do not rely on values or decisions in this file.

These are foundational runtime decisions. If you get them wrong, everything above (scopes, cancellation, fairness) becomes unstable.

I’ll answer each precisely and then give you the recommended v1 design.


---

1. Microtask vs Macrotask vs MessageChannel

❌ Microtasks (queueMicrotask, Promise.then)

Do NOT use microtasks as your main scheduler.

Why:

microtasks run before the event loop yields
can starve I/O, timers, rendering
can create infinite loops without yielding

Example failure mode:

task → queueMicrotask → task → queueMicrotask → ...

This blocks:

setTimeout
fetch callbacks
UI updates

Microtasks are too aggressive.


---

❌ Macrotasks (setTimeout(0))

Problems:

high latency (clamped)
slow scheduling
coarse-grained control

Good for:

yielding back to event loop

Bad for:

fine-grained scheduling


---

✅ MessageChannel (Best for v1)

This is the correct primitive.

Why:

fast (faster than setTimeout)
yields to event loop
does not starve I/O
widely supported (Node, browsers, Bun, Deno)

This is what React, many schedulers, and runtimes use.


---

✅ Final Recommendation (Scheduling Primitive)

primary: MessageChannel
fallback: setTimeout
never: microtask-only scheduler


---

2. Scheduling Strategy

What are we optimizing for?

[[jolly]] v1 goals:

predictability
fairness
simplicity
no starvation
low overhead


---

❌ Round-robin

Not ideal because:

requires explicit task list rotation
complex bookkeeping
doesn't map naturally to async continuations


---

❌ Work-stealing (for v1)

You already deferred this.

Reasons:

multi-thread complexity
atomic state
debug difficulty

Correct decision to exclude for v1.


---

❌ Priority scheduling

Adds:

API complexity
non-deterministic behavior
starvation risk

Avoid in v1.


---

✅ FIFO + Cooperative Yielding (Correct for v1)

Use:

single global FIFO queue
tasks append to tail
scheduler executes from head

With:

execution budget
explicit yield points (await, yieldNow)


---

Why FIFO Works

Because your runtime is:

cooperative (not preemptive)
structured (bounded lifetime)

This ensures:

no starvation (if yield exists)
predictable behavior
simple implementation


---

3. The Key Insight: Cooperative Scheduling

Jolly is not preemptive.

That means:

tasks must yield voluntarily

Yield points:

await
yieldNow()
sleep()

So fairness is achieved via:

cooperation + FIFO


---

4. Should Jolly Sit “Above the Event Loop”?

Short Answer

Yes — but not replace it.


---

What This Means

Jolly acts as a userland scheduler layer:

JS event loop
    ↓
Jolly scheduler
    ↓
tasks

Jolly:

controls ordering of tasks
controls when tasks run
controls cancellation

But still relies on:

I/O
timers
network

from the underlying runtime.


---

Determinism Clarification

You cannot make JS fully deterministic because:

I/O timing is external
event loop ordering varies

But Jolly can guarantee:

deterministic task lifecycle
deterministic cancellation
deterministic scope behavior

Not:

deterministic scheduling order


---

5. Recommended v1 Scheduler Design

This is the exact architecture you should implement.


---

Core Components

readyQueue (FIFO)
MessageChannel trigger
execution budget


---

Execution Loop

function drain() {

  let count = 0

  while (queue.length > 0) {

    const task = queue.shift()

    run(task)

    if (++count >= BUDGET) {
      scheduleNextTick()
      return
    }

  }

}


---

Scheduling

function schedule(task) {

  queue.push(task)

  if (!scheduled) {
    scheduled = true
    messageChannel.postMessage(0)
  }

}


---

Yielding

function yieldNow() {
  return new Promise(resolve => {
    schedule(resolve)
  })
}


---

Budget

Critical parameter:

BUDGET ≈ 100–1000 tasks per tick

Prevents:

event loop starvation
long blocking loops


---

6. Final Decisions (Lock These)

Scheduling primitive

MessageChannel (primary)
setTimeout fallback


---

Scheduling strategy

FIFO queue
cooperative yielding
execution budget


---

Runtime position

Jolly sits above the event loop
but does not replace it


---

Determinism

deterministic lifecycle ✔
deterministic cancellation ✔
deterministic scheduling ✘ (not guaranteed)


---

7. Why This Is the Right v1 Choice

This design is:

simple (~150–200 LOC)
portable (Node/Bun/Deno/browser)
predictable
debuggable

And matches what successful systems do:

React scheduler → MessageChannel + yielding
async runtimes → cooperative + FIFO


---

Final Summary

For Jolly v1:

Use MessageChannel for scheduling
Use FIFO queue with cooperative yielding
Use execution budget to avoid starvation
Run above (not instead of) the event loop
Do not attempt full determinism

This gives you a correct, stable, production-ready scheduler.


---
---
Tuning the scheduler is about balancing two competing goals:

throughput (finish work fast)
responsiveness (don’t block the event loop)

You control this via:

execution budget (how many tasks per drain)
yield frequency (how often tasks give control back)

For Jolly v1, you want simple, adaptive heuristics—not complex policies.


---

1. What “Execution Budget” Really Means

The budget is:

max number of task continuations executed in one scheduler drain

Example:

while (queue.length > 0) {
  run(task)

  if (++count >= BUDGET) {
    yieldToEventLoop()
    return
  }
}

If too high:

event loop starvation
UI freezes (browser)
timers delayed

If too low:

too many context switches
poor throughput


---

2. What “Yield Frequency” Means

Yielding happens at:

await points
yieldNow()
sleep()
budget exhaustion

You control it indirectly by:

task design (cooperative)
scheduler budget


---

3. Recommended v1 Defaults

Start with safe, boring defaults:

BUDGET = 500

Why:

small enough to avoid starvation
large enough for good throughput
works across Node + browsers

You can go up to:

1000 (CPU-heavy workloads)

But 500 is a good baseline.


---

4. Time-Based Budget (Better Than Count-Based)

Count-based budget is simple, but not ideal.

Better approach:

limit by time instead of number of tasks

Example:

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


---

Why Time-Based Is Better

Because:

tasks are not equal cost

Example:

task A = 1µs
task B = 5ms

Count-based fails here.

Time-based ensures:

consistent responsiveness


---

5. Best v1 Strategy (Hybrid)

Use both:

maxTasks + maxTime

Example:

const MAX_TASKS = 500
const MAX_TIME = 5 // ms

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

This is robust and simple.


---

6. Yield Frequency Inside Tasks

Scheduler alone is not enough.

Tasks must cooperate.


---

Rule: Yield in Long Loops

for (let i = 0; i < N; i++) {

  if (i % 1000 === 0) {
    await yieldNow()
  }

}


---

Heuristic

yield every 0.5–2ms of CPU work

or:

every 500–2000 iterations (depends on workload)


---

7. Adaptive Budget (Optional, Still Simple)

You can slightly adapt budget dynamically.

Example:

if (queue.length > 1000) {
  MAX_TASKS = 1000
} else {
  MAX_TASKS = 300
}

Idea:

large backlog → increase throughput
small backlog → prioritize responsiveness

Keep this simple for v1.


---

8. Detecting Starvation

You can detect bad tuning via:

setTimeout delays
slow UI updates
event loop lag

Simple metric:

const lag = performance.now() - expectedTime

If lag grows → reduce budget.


---

9. Practical Tuning Table

Scenario	Budget	Time Slice

IO-heavy (APIs)	500	5ms
Mixed workload	500–800	5ms
CPU-heavy	800–1500	8ms
UI-sensitive (browser)	200–400	3ms



---

10. MessageChannel vs Yield Interaction

Important subtlety:

MessageChannel → yields to event loop
yieldNow() → yields within scheduler

Together they provide:

inter-task fairness + event loop fairness


---

11. Golden Rules

Follow these and you won’t go wrong:

1. Never run unbounded loops without yielding
2. Always cap scheduler drain (count or time)
3. Prefer time-based slicing over pure count
4. Keep heuristics simple for v1
5. Optimize later with real benchmarks


---

12. What NOT to Do

Avoid:

infinite microtask loops
unbounded drain loops
complex adaptive schedulers (v1)
priority queues (v1)

These introduce instability early.


---

13. Minimal Production-Ready Config

For Jolly v1, this is enough:

const MAX_TASKS = 500
const MAX_TIME = 5

Plus:

await yieldNow() in long tasks

That alone gives:

good throughput
no starvation
predictable behavior


---

Final Summary

Tuning boils down to:

limit how long you run
force cooperative yielding

Best v1 strategy:

MessageChannel scheduling
FIFO queue
hybrid budget (count + time)
explicit yield points

This gives you a stable, production-grade scheduler without complexity.


---
---

