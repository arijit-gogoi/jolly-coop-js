# Jolly — Structured Concurrency Runtime for JavaScript

## What It Is
Jolly is a structured concurrency runtime for JS (Node, Bun, Deno, browser). Scoped task lifetimes, guaranteed cleanup, cooperative cancellation via AbortSignal, first-error-wins semantics.

## Core API
`scope`, `spawn`, `resource`, `cancel`, `sleep`, `yieldNow`

## Architecture Constraints
- Microtasks must NEVER be used as a scheduling primitive (they starve I/O, timers, rendering)
- MessageChannel is the scheduling primitive; setTimeout as fallback
- Single global FIFO queue with cooperative yielding
- Hybrid execution budget: MAX_TASKS=500, MAX_TIME=5ms
- Scheduler complexity budget: ~150-200 lines

## Key Docs
- @jolly-coop.md — behavioral specification (task state machine, cancellation, cleanup)
- @jolly-strategy.md — implementation guide (scheduler design, drain loop, yielding)
- @jolly-benchmarking.md — benchmark spec (metrics, harness, success criteria)
- @jolly.md — source spec + API surface + test plan

## Commands
- `npm test` — unit tests
- `npm run bench` — benchmarks
- `node --expose-gc bench/index.js` — benchmarks with GC access
