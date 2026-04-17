# Jolly — Structured Concurrency Runtime for JavaScript

## What It Is
Jolly is a structured concurrency runtime for JS (Node, Bun, Deno, browser). Scoped task lifetimes, guaranteed cleanup, cooperative cancellation via AbortSignal, first-error-wins semantics.

## Core API
`scope`, `spawn`, `resource`, `cancel`, `done`, `sleep`, `yieldNow`

## Architecture Constraints
- Microtasks must NEVER be used as a scheduling primitive (they starve I/O, timers, rendering)
- MessageChannel is the scheduling primitive; setTimeout as fallback
- Single global FIFO queue with cooperative yielding
- Hybrid execution budget: MAX_TASKS=5000, MAX_TIME=5ms
- Scheduler complexity budget: ~150-200 lines
- Platform independent: no Node/Bun/Deno/browser-specific APIs
- No per-task data structures: use incremental counters and flags, not Sets/Maps that grow with task count

## Key Docs
- @jolly-coop.md — behavioral specification (task state machine, cancellation, cleanup)
- @jolly-strategy.md — implementation guide (scheduler design, drain loop, yielding)
- @jolly-benchmarking.md — benchmark spec (metrics, harness, success criteria)
- @jolly.md — source spec + API surface + test plan

## Commands
- `npm test` — unit tests (all must pass)
- `npm run bench` — behavioral benchmarks (event loop lag, fairness, limits, I/O sim, memory)
- `npm run bench:vi` — microbenchmarks via vitest bench (throughput, latency with statistical analysis)
- `npm run regression` — integration regression vs committed baseline (uses jolly-bench downstream)
- `npm run regression:baseline` — capture a new baseline (after a release)

## Which benchmark when
- `bench/` — behavioral *property* check ("did fairness hold? did event loop stall?"). Run when designing a scheduler change to confirm the property still holds, not for absolute numbers.
- `bench:vi/` — primitive-level *cost* check ("how many ns does one spawn cost?"). Run when optimizing a hot path; use the statistical output, not eyeball deltas.
- `regression/` — integration-level *delta* check ("did the runtime as a whole slow down vs the published baseline?"). Run before tagging a release or merging changes to scheduler/scope/sleep/task. Not for narrow questions; this catches what the other two miss.

## Commit & Documentation Discipline
- Use Conventional Commits: `<type>(scope): description` (types: feat, fix, docs, style, refactor, test, chore).
- The git log IS the optimization history. Write well-structured commits: what changed, why, and before/after numbers for perf changes.
- Decision rationale (why X over Y) goes in code comments at the decision site, not standalone docs.
- Spec files (`spec/`) cover architectural "why". Code comments cover implementation "why".
- Do not create separate optimization docs — they duplicate git log and go stale.
