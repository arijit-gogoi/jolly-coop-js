export interface BenchResult {
  name: string
  ops?: number
  duration_ms: number
  ops_per_sec?: number
  p50_latency_ms?: number
  p95_latency_ms?: number
  p99_latency_ms?: number
  event_loop_lag_ms?: number
  max_concurrency?: number
  details?: Record<string, unknown>
}

export async function run(
  name: string,
  fn: () => Promise<BenchResult | void>,
  { warmup = true } = {}
): Promise<BenchResult> {
  // Warmup: execute once, discard
  if (warmup) await fn()

  // Measure
  const start = performance.now()
  const result = await fn()
  const duration = performance.now() - start

  if (result) {
    result.duration_ms = result.duration_ms ?? duration
    return result
  }

  return { name, duration_ms: duration }
}

export function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

export function monitorLag(interval = 10) {
  let last = performance.now()
  let maxLag = 0
  const lags: number[] = []

  const id = setInterval(() => {
    const now = performance.now()
    const lag = now - last - interval
    if (lag > 0) {
      maxLag = Math.max(maxLag, lag)
      lags.push(lag)
    }
    last = now
  }, interval)

  return function stop() {
    clearInterval(id)
    return { maxLag, lags }
  }
}

export function formatResult(r: BenchResult, json: boolean): string {
  if (json) return JSON.stringify(r)

  const lines: string[] = [`  ${r.name}`]
  if (r.ops_per_sec !== undefined)
    lines.push(`    throughput: ${r.ops_per_sec.toLocaleString()} ops/sec`)
  lines.push(`    duration:   ${r.duration_ms.toFixed(1)}ms`)
  if (r.p50_latency_ms !== undefined)
    lines.push(`    latency:    p50=${r.p50_latency_ms.toFixed(3)}ms  p95=${r.p95_latency_ms?.toFixed(3)}ms  p99=${r.p99_latency_ms?.toFixed(3)}ms`)
  if (r.event_loop_lag_ms !== undefined)
    lines.push(`    ev-loop lag: ${r.event_loop_lag_ms.toFixed(2)}ms`)
  if (r.max_concurrency !== undefined)
    lines.push(`    max concurrency: ${r.max_concurrency}`)

  return lines.join("\n")
}
