# Jolly Examples

27 self-contained examples across 9 categories. Each exits 0 on success — the examples are their own tests.

## Running

```bash
npm run examples              # build + run all 27
npm run examples -- backend   # run one category
npm run examples -- pipeline  # filter by keyword
npm run examples -- 01-basic  # run a single example
```

## Backend

| Example | Description | Key features |
|---------|-------------|--------------|
| [01-basic-parallel-fetch](backend/01-basic-parallel-fetch.mjs) | Fetch multiple endpoints in parallel | `scope`, `spawn`, await tasks |
| [02-rate-limited-pipeline](backend/02-rate-limited-pipeline.mjs) | Batch job with concurrency cap and timeout | `limit`, `timeout`, `sleep`, `yieldNow`, first-error-wins |
| [03-full-api-server-simulation](backend/03-full-api-server-simulation.mjs) | Connection pool, cache, nested request scopes | `resource`, `cancel`, `signal`, nested scopes |

## Frontend

| Example | Description | Key features |
|---------|-------------|--------------|
| [01-dashboard-loader](frontend/01-dashboard-loader.mjs) | Load profile, notifications, feed in parallel | `scope`, `spawn`, parallel data loading |
| [02-search-with-cancellation](frontend/02-search-with-cancellation.mjs) | Typeahead with debounce, cancel previous search | `cancel`, `sleep`, `signal` |
| [03-component-lifecycle](frontend/03-component-lifecycle.mjs) | Components as scopes, navigation cancels everything | `resource`, `cancel`, `signal`, nested scopes |

## Library Authors

| Example | Description | Key features |
|---------|-------------|--------------|
| [01-retry-with-backoff](library/01-retry-with-backoff.mjs) | Reusable retry utility that respects cancellation | `scope`, `spawn`, `sleep`, `signal` |
| [02-async-pool](library/02-async-pool.mjs) | Bounded concurrency pool with per-item timeout | `limit`, `timeout`, `yieldNow`, nested scopes |
| [03-pubsub-with-lifecycle](library/03-pubsub-with-lifecycle.mjs) | Message broker with subscriber lifecycle management | `resource`, `cancel`, `signal`, `limit`, nested scopes |

## CLI Tools

| Example | Description | Key features |
|---------|-------------|--------------|
| [01-parallel-file-hash](cli/01-parallel-file-hash.mjs) | Hash multiple files concurrently | `scope`, `spawn`, `sleep` |
| [02-concurrent-downloader](cli/02-concurrent-downloader.mjs) | Download with concurrency cap and progress | `limit`, `sleep`, `yieldNow`, `signal` |
| [03-build-system](cli/03-build-system.mjs) | Dependency graph, parallel builds, cleanup on failure | `resource`, `sleep`, `yieldNow`, `limit`, nested scopes |

## Game Development

| Example | Description | Key features |
|---------|-------------|--------------|
| [01-entity-spawner](gamedev/01-entity-spawner.mjs) | Spawn entities with automatic cleanup on wave end | `scope`, `spawn`, `sleep` |
| [02-ability-cooldowns](gamedev/02-ability-cooldowns.mjs) | Abilities, cooldowns, combo chains, stun cancellation | `cancel`, `sleep`, `yieldNow`, `signal`, nested scopes |
| [03-game-loop](gamedev/03-game-loop.mjs) | Scene management, entity systems, resource lifecycle | `resource`, `done`, `signal`, nested scopes |

## Data Pipelines

| Example | Description | Key features |
|---------|-------------|--------------|
| [01-transform-batch](data-pipeline/01-transform-batch.mjs) | Transform records in parallel, maintain order | `scope`, `spawn`, `sleep` |
| [02-fan-out-fan-in](data-pipeline/02-fan-out-fan-in.mjs) | Extract/transform/load with backpressure | `limit`, `yieldNow`, nested scopes |
| [03-streaming-etl](data-pipeline/03-streaming-etl.mjs) | Partitioned processing, dead-letter queue, checkpointing | `resource`, `timeout`, `limit`, `signal`, nested scopes |

## AI / ML

| Example | Description | Key features |
|---------|-------------|--------------|
| [01-parallel-inference](ai-ml/01-parallel-inference.mjs) | Same prompt to multiple models, pick best | `scope`, `spawn`, `sleep` |
| [02-prompt-fan-out](ai-ml/02-prompt-fan-out.mjs) | Chunk summarization with rate limit and per-chunk timeout | `limit`, `timeout`, `yieldNow`, nested scopes |
| [03-streaming-token-merge](ai-ml/03-streaming-token-merge.mjs) | Producer/consumer: merge streaming tokens from N models | `resource`, `done`, `signal`, `yieldNow` |

## Testing

| Example | Description | Key features |
|---------|-------------|--------------|
| [01-parallel-setup](testing/01-parallel-setup.mjs) | Parallel test setup with guaranteed teardown | `scope`, `spawn`, `resource` |
| [02-timeout-and-retry](testing/02-timeout-and-retry.mjs) | Per-test timeout and flaky test retry | `timeout`, `cancel`, `sleep`, nested scopes |
| [03-integration-harness](testing/03-integration-harness.mjs) | Full harness: lifecycle hooks, parallel suites, isolation | `resource`, `limit`, `timeout`, `yieldNow`, nested scopes |

## Patterns

| Example | Description | Key features |
|---------|-------------|--------------|
| [01-first-to-resolve](patterns/01-first-to-resolve.mjs) | Spawn N tasks, first result wins, clean up the rest | `scope`, `spawn`, `done` |
| [02-bounded-channel](patterns/02-bounded-channel.mjs) | Fixed-capacity buffer with backpressure | `resource`, `signal`, `yieldNow`, `sleep` |
| [03-errors-as-values](patterns/03-errors-as-values.mjs) | Collect all results without triggering first-error-wins | `scope`, `spawn`, `limit` |
