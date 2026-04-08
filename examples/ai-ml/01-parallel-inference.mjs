// Basic: Run multiple model inferences in parallel, pick the best
// Shows: scope, spawn, sleep
//
// Pattern: Send the same prompt to multiple models (or the same model
// with different temperatures), collect all results, pick the best.

import { scope, sleep } from "../../dist/index.js"

async function inference(model, prompt, temperature) {
  // Simulate model inference with varying latency
  const latency = 50 + Math.random() * 150
  await sleep(latency)

  // Simulate model output (quality varies with temperature)
  const quality = Math.random() * (1 - Math.abs(temperature - 0.7))
  return {
    model,
    temperature,
    text: `[${model} t=${temperature}] Response to: "${prompt.slice(0, 30)}..."`,
    quality: Math.round(quality * 100) / 100,
    latency: Math.round(latency),
  }
}

const prompt = "Explain structured concurrency in JavaScript"

const start = performance.now()

const results = await scope(async s => {
  const candidates = [
    s.spawn(() => inference("gpt-4o", prompt, 0.3)),
    s.spawn(() => inference("gpt-4o", prompt, 0.7)),
    s.spawn(() => inference("gpt-4o", prompt, 1.0)),
    s.spawn(() => inference("claude-sonnet", prompt, 0.5)),
    s.spawn(() => inference("claude-sonnet", prompt, 0.8)),
  ]

  const all = []
  for (const c of candidates) all.push(await c)
  return all
})

const elapsed = (performance.now() - start).toFixed(0)
const best = results.sort((a, b) => b.quality - a.quality)[0]

console.log(`Ran ${results.length} inferences in ${elapsed}ms (parallel)`)
for (const r of results) {
  const marker = r === best ? " ← best" : ""
  console.log(`  ${r.model} t=${r.temperature}: quality=${r.quality} (${r.latency}ms)${marker}`)
}

console.assert(results.length === 5, "should have 5 results")
console.assert(best.quality >= 0, "best should have quality score")
console.assert(Number(elapsed) < 500, "parallel should be fast")

console.log("\n✓ parallel-inference passed")
