// Moderate: Fan-out a document into chunk summaries, then synthesize
// Shows: scope, spawn, sleep, yieldNow, limit, timeout
//
// Pattern: Split a document into chunks, summarize each chunk in parallel
// with a concurrency limit (API rate limit), then combine summaries
// into a final synthesis. Per-chunk timeout prevents slow API calls
// from blocking the pipeline.

import { scope, sleep, yieldNow } from "../../dist/index.js"

// Simulated LLM API
async function summarizeChunk(chunk, index) {
  const latency = 30 + Math.random() * 80
  await sleep(latency)

  // Simulate: chunk 7 is sometimes slow (would timeout)
  if (index === 7) await sleep(300)

  const words = chunk.split(" ").length
  return {
    index,
    summary: `Chunk ${index}: ${words} words about ${chunk.split(" ").slice(0, 3).join(" ")}...`,
    tokens: Math.floor(words * 1.3),
  }
}

async function synthesize(summaries) {
  await sleep(50) // simulate final LLM call
  return {
    text: `Synthesis of ${summaries.length} sections covering the document.`,
    totalTokens: summaries.reduce((sum, s) => sum + s.tokens, 0),
  }
}

// Simulated document chunks
const chunks = [
  "Structured concurrency ensures that concurrent tasks have well-defined lifetimes",
  "The scope function creates a boundary that all spawned tasks must complete within",
  "Cancellation propagates downward through the task tree using AbortSignal",
  "Resources registered with a scope are cleaned up in reverse order on exit",
  "The scheduler uses a MessageChannel-based FIFO queue with cooperative yielding",
  "Sleep and yieldNow are the primary cooperative scheduling primitives",
  "Concurrency limits provide backpressure for resource-constrained operations",
  "Timeouts and deadlines prevent unbounded execution of slow operations",
  "Error propagation follows first-error-wins semantics within a scope",
  "Nested scopes enable hierarchical task organization with isolated lifetimes",
]

const start = performance.now()
const stats = { summarized: 0, timedOut: 0, totalTokens: 0 }

const result = await scope(async s => {
  // Phase 1: Fan-out — summarize chunks with rate limit and per-chunk timeout
  const summaries = []

  await scope({ limit: 3 }, async fanOutScope => {
    for (let i = 0; i < chunks.length; i++) {
      const index = i
      fanOutScope.spawn(async () => {
        try {
          const summary = await scope({ timeout: 150 }, async chunkScope => {
            return await chunkScope.spawn(() => summarizeChunk(chunks[index], index))
          })
          summaries.push(summary)
          stats.summarized++
        } catch {
          stats.timedOut++
          summaries.push({ index, summary: `Chunk ${index}: [timed out]`, tokens: 0 })
        }
        await yieldNow()
      })
    }
  })

  // Sort by original order
  summaries.sort((a, b) => a.index - b.index)

  // Phase 2: Synthesize
  const synthesis = await s.spawn(() => synthesize(summaries))
  stats.totalTokens = synthesis.totalTokens

  return synthesis
})

const elapsed = (performance.now() - start).toFixed(0)

console.log(`Document processed in ${elapsed}ms`)
console.log(`  Chunks summarized: ${stats.summarized}`)
console.log(`  Chunks timed out:  ${stats.timedOut}`)
console.log(`  Total tokens:      ${stats.totalTokens}`)
console.log(`  Result: ${result.text}`)

console.assert(stats.summarized + stats.timedOut === chunks.length, "all chunks should be handled")
console.assert(stats.timedOut >= 1, "chunk 7 should timeout")
console.assert(stats.summarized >= 8, "most chunks should succeed")
console.assert(result.text.includes("Synthesis"), "should produce synthesis")

console.log("\n✓ prompt-fan-out passed")
