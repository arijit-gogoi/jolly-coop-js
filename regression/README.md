# regression — runtime regression harness

Catches performance regressions in jolly-coop's scheduler, `{ limit }` queue, timer wiring, and signal-propagation path by running a runtime-heavy jolly-bench scenario and diffing percentiles against a tracked baseline.

Not a unit test. Not a microbenchmark. This is integration-level: real concurrency, real timers, real `AbortSignal` listeners under load.

## Files

| | |
|---|---|
| `scope-stress.mjs` | Scenario — one iteration = nested scope with 10-task fan-out + `sleep(1ms)` each. Pure runtime work, no HTTP. |
| `diff.mjs`         | Compares two NDJSON outputs. Flags p50/p95/p99 regressions > 10%. |
| `run.mjs`          | Orchestrator — invokes jolly-bench, then diff. |
| `baseline-latest.json`   | Committed baseline — tiny summary JSON (count, p50, p95, p99, max, captured version). Regenerated at each release. |

## Prerequisites

`jolly-bench` must be invokable. In order of preference, the runner picks:

1. **`node_modules/.bin/jolly-bench`** — installed as a devDependency of this repo (`npm install --save-dev jolly-bench`). Preferred: version is locked in `package-lock.json`, so baseline and candidate runs use the same binary.
2. **`../jolly-bench/dist/cli.js`** — sibling repo checkout (`C:\Users\hp\claude-projects\jolly-bench`). Useful during co-development.
3. **`npx jolly-bench`** — fetched from npm on demand. Works but unpinned.

## Baseline format

The committed baseline (`baseline-latest.json`) is a summary, not the raw sample stream:

```json
{
  "count": 162342,
  "p50": 8.25,
  "p95": 15.69,
  "p99": 16.92,
  "max": 28.46,
  "capturedAt": "2026-04-17T17:18:14.604Z",
  "jollyCoopVersion": "0.3.3",
  "config": { "concurrency": "50", "duration": "30s", "scenario": "scope-stress" }
}
```

~300 bytes. Committed to git. The diff tool accepts either a summary `.json` or a raw `.ndjson` on either side. Candidate runs write NDJSON to `regression/out/` (git-ignored), then diff against the committed summary.

## Usage

### Check current source against baseline

```sh
npm run regression
```

This runs `scope-stress.mjs` for 30s with 50 VUs, then diffs against `baseline-latest.ndjson`. Exits 0 if within ±10% on p50/p95/p99; exits 1 on regression.

### Capture a new baseline (after releasing a jolly-coop version)

```sh
npm run regression:baseline
```

Overwrites `baseline-latest.ndjson`. Commit the new baseline with the release tag.

### Ad-hoc runs with custom bench options

```sh
node regression/run.mjs --duration 60s --concurrency 100
node regression/run.mjs --baseline regression/baseline-v0.3.3.ndjson
node regression/run.mjs --capture regression/baseline-v0.3.4.ndjson
```

## Interpreting output

```
metric   baseline    candidate   delta
------   --------    ---------   -----
count    128450      121330        -5.5%
p50      11.20 ms    11.50 ms      +2.7%
p95      14.80 ms    22.10 ms     +49.3%  REGRESSED
p99      18.30 ms    31.70 ms     +73.2%  REGRESSED
max      245.00 ms   342.00 ms    +39.6%
```

- **count**: total successful iterations in the run. A large drop (say >20%) can indicate the runtime is slower and each iteration takes longer, reducing total iterations in the fixed 30s window. Not itself a failure condition.
- **p50/p95/p99**: time for one iteration. These are the watched metrics.
- **max**: worst case. Noisy; informational only.

Regression threshold is `10%` on any watched percentile (see `THRESHOLD_PCT` in `diff.mjs`).

## When to run

- Before merging any change to `src/scheduler.ts`, `src/scope.ts`, `src/sleep.ts`, or `src/task.ts`
- Before tagging a release
- When investigating user-reported slowness

Not worth running:
- After doc-only changes
- After test-only changes
- On a machine under load (numbers will be meaningless)

## When to rebaseline

- After a jolly-coop version is tagged and published, if runtime cost materially changed (either direction). Commit new baseline with a message like `regression: rebaseline for v0.3.4`.
- If you change `scope-stress.mjs` itself (fan-out count, sleep duration, etc.) — old baseline is invalidated. Document the change.

Do NOT rebaseline to make a failing regression go green. That defeats the purpose.

## Why this works

The scenario has three properties that let runtime cost show up as a measurable delta:

1. **No HTTP** — `fetch()` variance would drown out scheduler cost. Keeping work pure (sleep + scope + spawn) means every millisecond of `duration_ms` is cost you control.
2. **50 concurrent VUs** — the scheduler, limit queue, and signal-listener path only come under pressure when many tasks are in flight. One VU wouldn't exercise them.
3. **30 seconds × ~5k iterations/sec = ~150k samples** — enough volume for stable percentiles. p95 of 10 samples is noise.

## Relationship to `bench/`

`bench/` (in the repo root) contains microbenchmarks that measure specific jolly-coop primitives directly: `throughput.bench.ts`, `latency.bench.ts`. Those are best for narrow, targeted scheduler questions ("does spawn cost X ns?").

`regression/` is integration: does the whole runtime, composed the way users use it, still hit the same percentile numbers? The two tools answer different questions. Use micros for design, regression harness for release-gating.
