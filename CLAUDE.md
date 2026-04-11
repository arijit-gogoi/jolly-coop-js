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
- `npm test` — unit tests (181 tests, all must pass)
- `npm run bench` — behavioral benchmarks (20 benchmarks via tsx: event loop lag, fairness, limits, memory)
- `npm run bench:vi` — microbenchmarks (9 benchmarks via vitest bench: throughput, latency with statistical analysis)

## Commit & Documentation Discipline
- Use Conventional Commits: `<type>(scope): description` (types: feat, fix, docs, style, refactor, test, chore).
- The git log IS the optimization history. Write well-structured commits: what changed, why, and before/after numbers for perf changes.
- Decision rationale (why X over Y) goes in code comments at the decision site, not standalone docs.
- Spec files (`spec/`) cover architectural "why". Code comments cover implementation "why".
- Do not create separate optimization docs — they duplicate git log and go stale.
