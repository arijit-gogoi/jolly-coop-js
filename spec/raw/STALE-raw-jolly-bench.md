> **STALE / SCRATCH** — This is an early unstructured draft. The authoritative specs are in `spec/jolly-coop.md`, `spec/jolly-strategy.md`, and `spec/jolly-benchmarking.md`. Do not rely on values or decisions in this file.

Benchmarking this runtime is about measuring scheduler behavior under load, not just raw ops/sec. You want to capture:

throughput
latency
event loop health
fairness
memory stability

A good setup has repeatable microbenchmarks + scenario benchmarks + instrumentation.


---

1. What to Measure (Core Metrics)

2. Throughput

tasks completed per second

Measures raw scheduler capacity.


---

2. Latency

Two types:

task scheduling latency  (enqueue → start)
task completion latency  (spawn → resolve)


---

3. Event Loop Lag (Critical)

how much you delay timers/I/O

This is the most important signal of bad tuning.


---

4. Fairness

do tasks get starved?

Check:

max delay between yields


---

5. Memory Stability

heap growth
task object retention

Ensures no leaks.


---

2. Benchmark Categories

You need four types of benchmarks.


---

A. Microbenchmarks (Scheduler Core)

Example: 1M trivial tasks

```
import { scope } from "jolly"

const N = 100_000
console.time("throughput")
await scope(async s => {
  for (let i = 0; i < N; i++) {
    s.spawn(() => {})
  }
})
console.timeEnd("throughput")
```

Measure:

tasks/sec = N / time


---

B. Yield Stress Test

```
await scope(async s => {
  for (let i = 0; i < 10_000; i++) {
    s.spawn(async () => {
      for (let j = 0; j < 10; j++) {
        await yieldNow()
      }
    })
  }
})
```

Measures:

scheduler overhead
yield cost
fairness


---

C. Concurrency Limit Benchmark

```
await scope({ limit: 10 }, async s => {
  for (let i = 0; i < 1000; i++) {
    s.spawn(async () => {
      await sleep(10)
    })
  }
})
```

Measure:

actual concurrency
queue behavior


---

D. Realistic Scenario (I/O Simulation)

```
await scope(async s => {
  for (let i = 0; i < 1000; i++) {
    s.spawn(async () => {
      await sleep(Math.random() * 50)
    })
  }
})
```

Simulates:

network jitter
real workloads


---

3. Measuring Event Loop Lag

This is essential.

Simple lag detector
```
function measureEventLoopLag(interval = 10) {
  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    const lag = now - last - interval
    console.log("lag:", lag.toFixed(2), "ms")
    last = now
  }, interval)
}
```

Run alongside benchmarks.


---

Interpretation

lag < 5ms → good
lag 5–20ms → borderline
lag > 20ms → scheduler too aggressive


---

4. Measuring Task Latency

Instrument inside runtime.

Example
```
const start = performance.now()
scheduler.enqueue(() => {
  const latency = performance.now() - start
  record(latency)
})
```

Track:
```
p50 latency
p95 latency
p99 latency
```


---

5. Measuring Throughput Precisely

Avoid console.time for accuracy.

Use:
```
const start = performance.now()
await runBenchmark()
const duration = performance.now() - start
const throughput = N / (duration / 1000)
```


---

6. Fairness Test

Detect starvation.

```
await scope(async s => {
  let lastRun = performance.now()
  s.spawn(async () => {
    while (true) {
      const now = performance.now()
      const delay = now - lastRun
      if (delay > 50) {
        console.log("starvation:", delay)
      }
      lastRun = now
      await yieldNow()
    }
  })
  // heavy competing tasks
  for (let i = 0; i < 1000; i++) {
    s.spawn(async () => {
      for (let j = 0; j < 1000; j++) {}
    })
  }
})
```


---

7. Memory Benchmark

In Node:
```
console.log(process.memoryUsage())
```

Test:
```
for (let i = 0; i < 10; i++) {
  await runHeavyBenchmark()
  global.gc?.()
}
```

Look for:

heap growth over time → leak


---

8. Benchmark Harness Structure

Organize benchmarks:

```
bench/
  throughput.ts
  latency.ts
  fairness.ts
  limits.ts
  memory.ts
```

Run with:

```
node --expose-gc bench/throughput.ts
```


---

9. Compare Against Baselines

Always compare:

raw Promise.all
setTimeout loop
other libraries

Example:
```
await Promise.all(
  Array.from({ length: N }, () => Promise.resolve())
)
```


---

10. Key KPIs for [[jolly]] v1

Good targets:

100k–500k tasks/sec (no-op tasks)
< 5ms event loop lag under load
< 1ms median scheduling latency
no memory growth under stress


---

11. Common Benchmark Mistakes

Avoid:

benchmarking only no-op tasks
ignoring event loop lag
not warming up runtime
using console.time only
mixing I/O + CPU unpredictably


---

12. Warmup Phase

Always warm up:

await runBenchmark() // warmup
await runBenchmark() // measure

This avoids:

JIT noise
initial allocation cost


---

13. Automating Benchmarks

Create script:

{
  "scripts": {
    "bench": "node bench/index.js"
  }
}

Run regularly before releases.


---

14. How to Tune Using Benchmarks

Adjust:

MAX_TASKS
MAX_TIME
yield frequency

Observe:

throughput ↑
latency ↓
lag ↓

Stop when:

event loop lag starts increasing

That’s your limit.


---

Final Summary

A proper benchmarking setup includes:

microbenchmarks (throughput)
latency tracking
event loop lag measurement
fairness tests
memory checks
real workload simulations

The most important metric:

event loop lag

Because that reflects real-world impact.


---
---

Below is a publishable benchmark suite spec for Jolly v1. It is designed to be:

credible (measures real behavior)
comparable (against Promise/other libs)
reproducible (deterministic harness)
minimal (small codebase)

This is what makes a runtime “real” in the ecosystem.


---

1. Goals of the Benchmark Suite

The suite must answer:

How fast is Jolly?
How fair is the scheduler?
Does it block the event loop?
Does it scale with workload?
Does it leak memory?

And compare against:

raw Promise / async-await
p-limit / concurrency libs
setTimeout-based schedulers


---

2. Benchmark Categories

Define 6 core benchmark groups.

1. Throughput
2. Scheduling latency
3. Event loop lag
4. Fairness
5. Concurrency limits
6. Memory stability

Each group should have 2–3 tests.


---

3. Standardized Benchmark Harness

All benchmarks must use a shared harness.

3.1 Runner

```
export async function run(name: string, fn: () => Promise<void>) {
  // warmup
  await fn()
  const start = performance.now()
  await fn()
  const duration = performance.now() - start
  return {
    name,
    duration
  }
}
```


---

3.2 Result Format

Every benchmark outputs:
```
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

This allows comparison across runtimes.


---

4. Benchmark 1 — Throughput

4.1 No-op tasks

```
await scope(async s => {
  for (let i = 0; i < N; i++) {
    s.spawn(() => {})
  }
})
```

Compare:

```
await Promise.all(
  Array.from({ length: N }, () => Promise.resolve())
)
```


---

4.2 Yield-heavy tasks

```
await scope(async s => {
  for (let i = 0; i < N; i++) {
    s.spawn(async () => {
      await yieldNow()
    })
  }
})
```

Measures scheduler overhead.


---

5. Benchmark 2 — Scheduling Latency

Measure enqueue → execution delay.

```
const latencies: number[] = []
await scope(async s => {
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    s.spawn(() => {
      latencies.push(performance.now() - t0)
    })
  }
})
```

Report:

```
p50
p95
p99
```


---

6. Benchmark 3 — Event Loop Lag

6.1 Lag monitor

```
function monitorLag(interval = 10) {
  let last = performance.now()
  let maxLag = 0
  const id = setInterval(() => {
    const now = performance.now()
    const lag = now - last - interval
    maxLag = Math.max(maxLag, lag)
    last = now
  }, interval)
    clearInterval(id)
    return maxLag
  }
}
```


---

6.2 Test

```
const stop = monitorLag()
await heavyWorkload()
const lag = stop()
```

Compare Jolly vs Promise baseline.


---

7. Benchmark 4 — Fairness

Detect starvation.

```
let maxDelay = 0
let last = performance.now()
await scope(async s => {
  s.spawn(async () => {
    for (let i = 0; i < 1000; i++) {
      const now = performance.now()
      maxDelay = Math.max(maxDelay, now - last)
      last = now
      await yieldNow()
    }
  })
  for (let i = 0; i < 1000; i++) {
    s.spawn(() => {
      for (let j = 0; j < 1000; j++) {}
    })
  }
})
```

Metric:

```
max scheduling delay
```


---

8. Benchmark 5 — Concurrency Limits

8.1 Measure actual concurrency

```
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
```

Verify:

```
maxRunning <= 10
```


---

8.2 Compare with p-limit

Baseline:

```
import pLimit from "p-limit"

const limit = pLimit(10)

await Promise.all(
  items.map(i => limit(() => task(i)))
)
```


---

9. Benchmark 6 — Memory Stability

9.1 Stress loop

```
for (let i = 0; i < 20; i++) {

  await scope(async s => {

    for (let j = 0; j < 10000; j++) {
      s.spawn(() => {})
    }
  })
  global.gc?.()
}
```

Track:

```
process.memoryUsage().heapUsed
```

Expected:

```
no upward trend
```


---

10. Benchmark 7 — Realistic I/O Simulation

```
await scope({ limit: 20 }, async s => {
  for (let i = 0; i < 1000; i++) {
    s.spawn(async () => {
      await sleep(Math.random() * 50)
    })
  }
})
```

Measures:
```
scheduler stability under jitter
```


---

11. Benchmark Matrix

Run each benchmark with:

```
N = 1k
N = 10k
N = 100k
```

Environments:
```
Node (LTS)
Bun
Deno
Browser
```


---

12. Comparison Targets

Each benchmark should include:

```
Jolly
Promise.all
p-limit
setTimeout loop
```

This makes results meaningful.


---

13. Output Format (CLI)

Benchmark: throughput-basic
```
Ops: 100000
Time: 120ms
Ops/sec: 833k
Lag: 3.2ms
p95 latency: 1.1ms
```


---

14. CI Integration

Add:

```
{
  "scripts": {
    "bench": "node bench/index.js",
    "bench:ci": "node bench/index.js --json"
  }
}
```

Store results for regression tracking.


---

15. Success Criteria for Jolly v1

Jolly is “credible” if it achieves:

```
> throughput close to Promise baseline
> < 5ms event loop lag under load
> stable latency distribution
> correct limit enforcement
> no memory leaks
```


---

16. Public Benchmark Report

Publish:

```
README benchmarks table
graphs (ops/sec vs N)
latency percentiles
event loop lag comparison
```

This is what convinces developers.


---

Final Summary

A credible Jolly benchmark suite includes:

```
6 benchmark categories
standard harness
latency + lag metrics
comparisons with baseline approaches
repeatable workloads
```

This transforms Jolly from:
```
"interesting idea"
```

into:
```
"measurable, trustworthy runtime"
```


---
