# Jolly v1 — Benchmarking Specification

*Measuring Scheduler Behavior, Not Just Speed*

---

## 1. Introduction

Benchmarking a structured concurrency runtime is fundamentally different from benchmarking a typical JavaScript library. Raw operations per second is only part of the story — and not even the most important part. A scheduler can be fast while simultaneously starving the event loop, leaking memory, or unfairly monopolizing execution time for certain tasks. These failures are invisible in a simple throughput test but catastrophic in production.

The Jolly v1 benchmark suite is designed to measure what actually matters: whether the scheduler behaves correctly under load. This means measuring throughput alongside event loop health, latency alongside fairness, and memory stability alongside raw capacity. A benchmark that shows high throughput but ignores event loop lag is worse than useless — it provides false confidence.

This specification defines the metrics, benchmarks, harness, baselines, and success criteria for a credible Jolly v1 benchmark suite. It is designed to be reproducible, comparable against alternative approaches, and minimal in implementation. Together with the behavioral specification (`jolly-coop.md`) and the implementation strategy (`jolly-strategy.md`), this document completes the trilogy of documents needed to build, verify, and trust the runtime.

### 1.1 What Makes a Runtime Credible

A structured concurrency runtime earns credibility by demonstrating measurable, verifiable properties under realistic conditions. Developers will not adopt Jolly based on its specification alone — they need evidence that the runtime delivers on its promises. The benchmark suite provides that evidence.

Specifically, the suite must answer five questions:

1. **How fast is Jolly?** — Raw throughput compared to native promises and alternative concurrency libraries.
2. **How fair is the scheduler?** — Whether tasks are starved under contention.
3. **Does it block the event loop?** — Whether the scheduler's `MessageChannel`-based drain loop and hybrid budget actually yield to I/O and timers as designed.
4. **Does it scale with workload?** — Whether performance degrades gracefully as task counts increase.
5. **Does it leak memory?** — Whether task and scope objects are properly released after completion.

---

## 2. Core Metrics

The benchmark suite tracks five core metrics. Each metric corresponds to a specific aspect of scheduler behavior defined in the implementation strategy.

### 2.1 Throughput

Throughput is the number of tasks completed per second. It measures the raw capacity of the scheduler — how efficiently it can create, schedule, execute, and settle tasks through the FIFO queue.

Throughput is measured in `ops/sec` where one operation is one task spawned and completed. This metric establishes a baseline for scheduler overhead: the difference between Jolly's throughput and raw `Promise.all` throughput represents the cost of structured concurrency guarantees.

### 2.2 Scheduling Latency

Scheduling latency is the time between a task being spawned and the scheduler beginning its execution. This measures the delay introduced by the scheduler's FIFO queue and `MessageChannel` triggering mechanism.

Two forms of latency are relevant:

- **Scheduling latency** — The time from `spawn()` to the first line of the task function executing. This reflects how long a task waits in the ready queue.
- **Completion latency** — The time from `spawn()` to the task reaching a terminal state. This includes both scheduling delay and execution time.

Latency should be reported as percentile distributions: p50, p95, and p99. Median latency tells you the common case; tail latency tells you the worst case.

### 2.3 Event Loop Lag

Event loop lag is the single most important metric in the suite. It measures how much the scheduler delays the JavaScript event loop — specifically, how much timers and I/O callbacks are delayed beyond their expected firing time.

This metric directly validates the implementation strategy's core design decision: using `MessageChannel` with a hybrid execution budget (capped at `MAX_TASKS = 5000` tasks or `MAX_TIME = 5ms` per drain cycle) to avoid starving the event loop. If event loop lag is high, the budget is too aggressive. If it's near zero, the scheduler is yielding correctly.

Event loop lag is measured by scheduling a recurring `setInterval` timer at a known interval and comparing the actual elapsed time against the expected elapsed time. The difference is the lag:

```javascript
function monitorLag(interval = 10) {
  let last = performance.now()
  let maxLag = 0

  const id = setInterval(() => {
    const now = performance.now()
    const lag = now - last - interval
    maxLag = Math.max(maxLag, lag)
    last = now
  }, interval)

  return function stop() {
    clearInterval(id)
    return maxLag
  }
}
```

The lag monitor runs *concurrently with* the benchmark workload. This is essential — lag must be measured under load, not in isolation.

**Interpretation:**

- Lag under 5ms — The scheduler is yielding correctly. The event loop is healthy.
- Lag between 5ms and 20ms — Borderline. The budget may be slightly aggressive for the workload.
- Lag above 20ms — The scheduler is too aggressive. The budget must be reduced or the workload is not yielding cooperatively.

### 2.4 Fairness

Fairness measures whether tasks are starved under contention. In a FIFO cooperative scheduler, starvation occurs when one or more tasks monopolize execution time, preventing other tasks from making progress.

The fairness metric is the maximum observed delay between consecutive yield points for a task that yields cooperatively via `yieldNow()`. If this task is yielding regularly but experiencing long gaps between executions, other tasks are monopolizing the scheduler.

### 2.5 Memory Stability

Memory stability measures whether the runtime leaks memory over repeated use. Task objects, scope internal state, resource disposer references, and scheduler queue entries must all be released after a scope exits. If heap usage trends upward across repeated benchmark iterations (with garbage collection forced between iterations), the runtime has a leak.

---

## 3. Benchmark Categories

The suite is organized into six benchmark groups. Each group targets a specific aspect of scheduler behavior, and each group contains two to three individual tests.

### 3.1 Throughput Benchmarks

Throughput benchmarks measure raw scheduler capacity by spawning large numbers of tasks and timing how long it takes for all of them to complete.

**Test 1 — No-op tasks.** Spawn N tasks that do nothing. This measures pure scheduler overhead — the cost of creating a task, enqueueing it, dequeuing it, executing an empty function, transitioning the task state from `CREATED` to `RUNNING` to `COMPLETED`, and decrementing the scope's active task count.

```javascript
await scope(async s => {
  for (let i = 0; i < N; i++) {
    s.spawn(() => {})
  }
})
```

**Test 2 — Yield-heavy tasks.** Spawn N tasks that each call `yieldNow()` once. This measures the cost of cooperative yielding — how efficiently the scheduler handles tasks that suspend and re-enqueue themselves.

```javascript
await scope(async s => {
  for (let i = 0; i < N; i++) {
    s.spawn(async () => {
      await yieldNow()
    })
  }
})
```

The yield-heavy test is particularly important because it exercises the scheduler's re-enqueue path and reveals whether `yieldNow()` is cheap enough for tasks to use liberally.

### 3.2 Scheduling Latency Benchmarks

Latency benchmarks measure the time between task creation and task execution.

**Test — Enqueue-to-execution delay.** Record a timestamp immediately before each `spawn`, and record another timestamp as the first operation inside the task function. The difference is the scheduling latency.

```javascript
const latencies = []

await scope(async s => {
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    s.spawn(() => {
      latencies.push(performance.now() - t0)
    })
  }
})
```

Report p50, p95, and p99 from the collected latency samples. Scheduling latency should be well under 1ms for the median case.

### 3.3 Event Loop Lag Benchmarks

Event loop lag benchmarks verify that the scheduler yields to the event loop correctly under load.

**Test — Lag under heavy workload.** Start the lag monitor, run a heavy workload (e.g., 100k no-op tasks or 10k yield-heavy tasks), stop the monitor, and record the maximum observed lag.

```javascript
const stop = monitorLag()
await heavyWorkload()
const maxLag = stop()
```

This test should be run with both Jolly and a raw `Promise.all` baseline to compare how much additional lag the scheduler introduces over native promise resolution.

### 3.4 Fairness Benchmarks

Fairness benchmarks detect task starvation.

**Test — Yield delay under contention.** Spawn a "canary" task that repeatedly yields via `yieldNow()` and records the time between each yield-and-resume cycle. Simultaneously, spawn many CPU-bound tasks that compete for scheduler time. The maximum delay observed by the canary task is the fairness metric.

```javascript
let maxDelay = 0
let last = performance.now()

await scope(async s => {
  // Canary task: yields cooperatively, measures delay
  s.spawn(async () => {
    for (let i = 0; i < 1000; i++) {
      const now = performance.now()
      maxDelay = Math.max(maxDelay, now - last)
      last = now
      await yieldNow()
    }
  })

  // Competing tasks: CPU-bound, no yielding
  for (let i = 0; i < 1000; i++) {
    s.spawn(() => {
      for (let j = 0; j < 1000; j++) { /* busy work */ }
    })
  }
})
```

In a fair FIFO scheduler, the canary's delay should be bounded by the execution budget. If the canary experiences delays significantly longer than `MAX_TIME` (5ms), competing tasks are not yielding frequently enough, or the budget is too large.

### 3.5 Concurrency Limit Benchmarks

Concurrency limit benchmarks verify that the `scope({ limit: n })` mechanism enforces its constraint correctly under load.

**Test 1 — Actual concurrency measurement.** Track the number of concurrently running tasks and verify that it never exceeds the configured limit.

```javascript
let running = 0
let maxRunning = 0

await scope({ limit: 10 }, async s => {
  for (let i = 0; i < 100; i++) {
    s.spawn(async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await sleep(10)
      running--
    })
  }
})

// Assert: maxRunning <= 10
```

This test also serves as a correctness check — if `maxRunning` exceeds the limit, the concurrency limiter is broken.

**Test 2 — Comparison with p-limit.** Run the same workload using `p-limit`, a widely-used concurrency limiter for promises, and compare throughput and latency. This positions Jolly's concurrency limiting against the most common alternative developers would otherwise reach for.

```javascript
import pLimit from "p-limit"

const limit = pLimit(10)

await Promise.all(
  items.map(i => limit(() => task(i)))
)
```

### 3.6 Memory Stability Benchmarks

Memory benchmarks verify that the runtime does not leak task objects, scope state, or scheduler entries across repeated scope lifecycles.

**Test — Repeated scope stress.** Run a heavy workload inside a scope, force garbage collection, and record heap usage. Repeat 20 times. The heap usage series should be flat — no upward trend.

```javascript
for (let i = 0; i < 20; i++) {
  await scope(async s => {
    for (let j = 0; j < 10_000; j++) {
      s.spawn(() => {})
    }
  })

  global.gc?.()
  console.log(process.memoryUsage().heapUsed)
}
```

If heap usage grows monotonically across iterations, tasks or scope internals are being retained after scope exit, violating the runtime guarantee that tasks cannot outlive their scope (Guarantee 9 in the specification).

### 3.7 Realistic I/O Simulation

Realistic benchmarks simulate production-like workloads with variable-duration tasks and concurrency limits.

**Test — Jittered I/O workload.** Spawn many tasks with random sleep durations under a concurrency limit. This simulates a workload like an API gateway or web scraper where request latencies vary.

```javascript
await scope({ limit: 20 }, async s => {
  for (let i = 0; i < 1000; i++) {
    s.spawn(async () => {
      await sleep(Math.random() * 50)
    })
  }
})
```

This test measures scheduler stability under realistic conditions — variable task durations, queue draining and refilling as tasks complete, and concurrency limit enforcement over an extended period.

---

## 4. Benchmark Harness

All benchmarks must use a standardized harness to ensure reproducibility and comparability. The harness handles warmup, timing, and result formatting.

### 4.1 Runner

Every benchmark is wrapped in a runner that performs a warmup pass (to avoid JIT compilation noise and initial allocation costs) followed by a measured pass:

```javascript
export async function run(name, fn) {
  // Warmup: execute once, discard result
  await fn()

  // Measure
  const start = performance.now()
  await fn()
  const duration = performance.now() - start

  return { name, duration }
}
```

The warmup phase is critical. Without it, the first run includes JIT compilation overhead, V8 hidden class transitions, and initial memory allocation costs that do not reflect steady-state performance. Always warm up; always measure the second run.

### 4.2 Precise Timing

Use `performance.now()` for all timing. `console.time` is convenient for debugging but lacks the precision needed for benchmark results. Throughput should be calculated as:

```javascript
const throughput = N / (duration / 1000)  // ops/sec
```

### 4.3 Result Format

Every benchmark emits a structured JSON result that includes all relevant metrics:

```json
{
  "name": "throughput-basic",
  "ops": 100000,
  "duration_ms": 120,
  "ops_per_sec": 833333,
  "p50_latency_ms": 0.2,
  "p95_latency_ms": 1.2,
  "event_loop_lag_ms": 3.5
}
```

This format enables automated comparison across runs, environments, and versions. Not every field applies to every benchmark — latency benchmarks won't report `ops_per_sec`, and throughput benchmarks won't report latency percentiles — but the schema is consistent.

---

## 5. Benchmark Scale Matrix

Each benchmark should be run at multiple scales to reveal how the scheduler behaves as workload increases. The standard scale levels are:

- **N = 1,000** — Light load. Establishes baseline behavior.
- **N = 10,000** — Moderate load. Reveals scheduling overhead.
- **N = 100,000** — Heavy load. Stress-tests the scheduler's queue management, budget enforcement, and memory behavior.

Running at multiple scales reveals whether performance degrades linearly (acceptable), sub-linearly (good), or super-linearly (indicates a scaling problem in the implementation).

---

## 6. Comparison Baselines

Benchmarks are only meaningful in context. Every benchmark should include results for the following baselines alongside Jolly:

- **Raw `Promise.all`** — The native JavaScript approach. This is the theoretical throughput ceiling since it has no scheduler overhead, no structured lifetime management, and no concurrency limits. Jolly should be within the same order of magnitude for throughput.
- **`p-limit`** — The most widely-used concurrency limiter for promises. Relevant for the concurrency limit benchmarks specifically, since this is the library developers would otherwise use.
- **`setTimeout` loop** — A macrotask-based scheduling approach. This represents the "naive scheduler" baseline and demonstrates why `MessageChannel` is the better primitive (lower latency, no clamping).

Comparing against these baselines positions Jolly's performance in terms developers already understand and provides evidence for the implementation strategy's design decisions.

---

## 7. Target Environments

The benchmark suite should run across all Jolly v1 target environments:

- Node.js (LTS)
- Bun
- Deno
- Browser (optional, but valuable for validating UI-sensitive tuning)

Cross-environment benchmarking validates the portability claims in the specification and reveals environment-specific performance characteristics (e.g., `MessageChannel` performance differences between V8 and JavaScriptCore).

---

## 8. Benchmark Project Structure

The benchmark suite should be organized as a standalone directory within the Jolly project:

```
bench/
  throughput.ts
  latency.ts
  event-loop-lag.ts
  fairness.ts
  limits.ts
  memory.ts
  io-simulation.ts
  harness.ts
  index.ts
```

Each file contains the benchmarks for one category. `harness.ts` provides the shared runner, timing utilities, and result formatting. `index.ts` orchestrates all benchmarks and handles CLI output.

Benchmarks should be runnable with:

```bash
node --expose-gc bench/index.js
```

The `--expose-gc` flag is required for memory benchmarks that need to force garbage collection between iterations.

---

## 9. CI Integration

Benchmarks should be integrated into the project's CI pipeline for regression detection. Two modes are needed:

```json
{
  "scripts": {
    "bench": "node --expose-gc bench/index.js",
    "bench:ci": "node --expose-gc bench/index.js --json"
  }
}
```

The `bench` script outputs human-readable results for local development. The `bench:ci` script outputs structured JSON for automated storage and comparison. Benchmark results should be stored across commits so that performance regressions are detected early — before a release, not after.

Benchmarks should run on every release and optionally on every commit to a main branch. They do not need to run on every pull request (they are slower than unit tests), but they must run before any version is published.

---

## 10. Using Benchmarks to Tune the Scheduler

The benchmark suite is not just a validation tool — it is the primary instrument for tuning the scheduler's execution budget. The implementation strategy defines default values (`MAX_TASKS = 5000`, `MAX_TIME = 5ms`), but these defaults should be verified and potentially adjusted based on benchmark results.

The tuning process is:

1. **Run throughput benchmarks.** Establish baseline ops/sec.
2. **Run event loop lag benchmarks.** Verify lag is under 5ms.
3. **Adjust `MAX_TASKS` and `MAX_TIME`.** Increase for more throughput; decrease for less lag.
4. **Re-run both.** Find the point where increasing the budget starts to push lag above 5ms.
5. **Stop.** That boundary is the optimal budget for the workload.

The key insight is that throughput and event loop health are in tension. The budget controls the tradeoff. Benchmarks make the tradeoff visible and measurable rather than guesswork.

---

## 11. Common Benchmarking Mistakes

Several common mistakes produce misleading benchmark results. The suite must avoid all of them.

**Benchmarking only no-op tasks.** No-op tasks measure scheduler overhead in isolation, which is useful, but says nothing about behavior under realistic workloads. Always include yield-heavy, I/O-simulated, and CPU-bound benchmarks alongside no-op tests.

**Ignoring event loop lag.** A benchmark that reports high throughput without measuring event loop lag is dangerously incomplete. The scheduler could be achieving that throughput by starving the event loop — which would be invisible in the throughput number but devastating in production.

**Skipping the warmup phase.** The first execution of a benchmark includes JIT compilation, hidden class transitions, and initial memory allocation. These costs are amortized in steady-state operation and should not be included in the measurement. Always warm up.

**Using `console.time` for measurement.** `console.time` is imprecise and not suitable for benchmarking. Use `performance.now()` for all timing.

**Mixing I/O and CPU unpredictably.** Benchmarks that combine I/O waits and CPU work without controlling the ratio produce results that vary with system load, network conditions, and disk speed. Either simulate I/O deterministically (using `sleep`) or isolate CPU benchmarks from I/O benchmarks.

---

## 12. Success Criteria

Jolly v1 is considered benchmark-credible when it meets the following targets:

- **Throughput:** 100,000–500,000 tasks/sec for no-op tasks. This demonstrates that the scheduler's overhead is small enough for the structured concurrency guarantees to be "free" in practical terms.
- **Event loop lag:** Under 5ms under heavy load. This validates the `MessageChannel` + hybrid budget design from the implementation strategy.
- **Scheduling latency:** Under 1ms at p50. Tasks should begin executing quickly after being spawned.
- **Latency distribution:** Stable p95 and p99. Tail latency should not spike unpredictably under load.
- **Concurrency limit correctness:** Observed concurrency never exceeds the configured limit. This is a correctness check, not a performance target.
- **Memory stability:** No upward trend in heap usage across 20 repeated heavy-workload iterations. Zero leaks.

These targets are achievable with the implementation strategy described in `jolly-strategy.md`. If the runtime meets them, it demonstrates that structured concurrency can be added to JavaScript without meaningful performance cost — which is the central claim that justifies Jolly's existence.

---

## 13. Publishing Benchmark Results

Benchmark results should be published as part of the project's public documentation. Credible, transparent performance data is what distinguishes a serious runtime from a toy project.

The published report should include:

- **A summary table** in the README showing throughput, latency, and event loop lag for the standard benchmarks at N = 100,000.
- **Throughput scaling graphs** showing ops/sec across N = 1k, 10k, and 100k for both Jolly and the `Promise.all` baseline.
- **Latency percentile charts** showing p50, p95, and p99 scheduling latency.
- **Event loop lag comparison** showing Jolly's lag versus the `Promise.all` baseline under equivalent workloads.

Graphs should be regenerated with each release. Stale benchmark data undermines credibility.

---

## 14. Summary

The Jolly v1 benchmark suite measures six dimensions of scheduler behavior: throughput, scheduling latency, event loop lag, fairness, concurrency limit correctness, and memory stability. Of these, event loop lag is the most important — it is the metric that reveals whether the scheduler's core design (a `MessageChannel`-triggered FIFO queue with a hybrid time-and-count execution budget) is actually delivering on its promise to cooperate with the event loop rather than starve it.

The suite uses a standardized harness with warmup, precise timing, and structured output. Every benchmark is run against baselines — raw `Promise.all`, `p-limit`, and `setTimeout` loops — so that results are meaningful in context. Benchmarks run at three scale levels and across all target environments.

Together with the behavioral specification and the implementation strategy, this benchmarking specification completes the evidence chain: the spec defines what the runtime promises, the strategy defines how it delivers, and the benchmarks prove that it works.

---

*This document forms the benchmarking companion to the Jolly v1 specification (`jolly-coop.md`) and implementation strategy (`jolly-strategy.md`).*
