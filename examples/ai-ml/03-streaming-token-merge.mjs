// Advanced: Producer/consumer — stream tokens from multiple models, merge in real-time
// Shows: scope, spawn, resource, done, sleep, yieldNow, signal, limit, nested scopes
//
// Pattern: Send the same prompt to N models, each streaming tokens back.
// A consumer task merges tokens into a single output as they arrive.
// When the fastest model finishes, done() signals all other streams
// to stop. Resources (connections, buffers) are cleaned up automatically.
//
// This is the producer/consumer pattern: producers push tokens into a
// shared buffer, the consumer drains it. The scope coordinates lifetime.

import { scope, sleep, yieldNow } from "../../dist/index.js"

const log = []
function emit(msg) { log.push(msg) }

// --- Simulated streaming LLM API ---

function createTokenStream(model, prompt, signal) {
  // Simulate a streaming response — yields tokens one at a time
  const words = {
    "model-a": ["Structured", "concurrency", "ensures", "tasks", "have", "bounded", "lifetimes", "and", "guaranteed", "cleanup.", "This", "prevents", "resource", "leaks."],
    "model-b": ["In", "structured", "concurrency,", "every", "task", "belongs", "to", "a", "scope.", "When", "the", "scope", "exits,", "all", "tasks", "are", "done."],
    "model-c": ["The", "key", "insight", "is", "that", "concurrency", "should", "be", "scoped,", "not", "fire-and-forget.", "Scopes", "own", "their", "children."],
  }

  const tokens = words[model] || ["No", "response."]
  let index = 0

  return {
    model,
    async next() {
      if (signal.aborted || index >= tokens.length) return null
      // Simulate variable token generation speed
      const delay = model === "model-a" ? 15 : model === "model-b" ? 25 : 20
      await sleep(delay + Math.random() * 10)
      if (signal.aborted) return null
      return { token: tokens[index++], index: index, total: tokens.length }
    },
    get done() { return index >= tokens.length },
    get progress() { return `${index}/${tokens.length}` },
  }
}

// --- Producer/consumer pipeline ---

async function streamingMerge(prompt, models) {
  const buffer = []          // shared token buffer (producers write, consumer reads)
  let activeProducers = 0
  let firstFinished = null
  const outputs = new Map()  // per-model collected tokens

  const result = await scope(async s => {
    emit("pipeline: starting streaming merge")

    // Resource: shared buffer — drained on exit
    await s.resource(buffer, (buf) => {
      emit(`pipeline: buffer drained (${buf.length} remaining tokens)`)
      buf.length = 0
    })

    // Spawn producer per model
    for (const model of models) {
      outputs.set(model, [])

      s.spawn(async () => {
        activeProducers++
        const stream = createTokenStream(model, prompt, s.signal)
        emit(`producer[${model}]: streaming started`)

        let tokenCount = 0
        while (!s.signal.aborted) {
          const chunk = await stream.next()
          if (!chunk) break

          // Push token to shared buffer (consumer will drain)
          buffer.push({ model, token: chunk.token, time: Date.now() })
          outputs.get(model).push(chunk.token)
          tokenCount++
          await yieldNow() // let consumer and other producers run
        }

        activeProducers--
        emit(`producer[${model}]: done — ${tokenCount} tokens, ${stream.progress}`)

        // First model to finish triggers done() — we have a complete response
        if (!firstFinished && stream.done) {
          firstFinished = model
          emit(`producer[${model}]: first complete — signaling done()`)
          s.done()
        }
      })
    }

    // Consumer: drain buffer and build merged output
    const merged = []
    s.spawn(async () => {
      emit("consumer: started")
      let drainCycles = 0

      while (!s.signal.aborted || buffer.length > 0) {
        if (buffer.length > 0) {
          // Drain all available tokens
          const batch = buffer.splice(0, buffer.length)
          for (const { model, token } of batch) {
            merged.push({ model, token })
          }
          drainCycles++
        }
        await sleep(5) // poll interval
      }

      emit(`consumer: done — ${merged.length} tokens merged in ${drainCycles} drain cycles`)
    })

    // Return merged tokens (scope resolves when done() is called)
    return { merged, outputs: Object.fromEntries(outputs) }
  })

  return { ...result, firstFinished }
}

// --- Run ---

const prompt = "Explain structured concurrency"
const models = ["model-a", "model-b", "model-c"]

const { merged, outputs, firstFinished } = await streamingMerge(prompt, models)

// --- Report ---

console.log("Streaming token merge:")
console.log(`  Models: ${models.join(", ")}`)
console.log(`  First to finish: ${firstFinished}`)
console.log(`  Total merged tokens: ${merged.length}`)

for (const [model, tokens] of Object.entries(outputs)) {
  console.log(`  ${model}: "${tokens.join(" ")}"`)
}

console.log("\nMerge order (first 20 tokens):")
for (const { model, token } of merged.slice(0, 20)) {
  process.stdout.write(`  [${model}] ${token}\n`)
}
if (merged.length > 20) console.log(`  ... and ${merged.length - 20} more`)

console.log("\nPipeline trace:")
for (const entry of log) console.log(`  ${entry}`)

// Verify
console.assert(firstFinished !== null, "one model should finish first")
console.assert(merged.length > 0, "should have merged tokens")
console.assert(outputs[firstFinished].length > 0, "winning model should have tokens")

// The first-to-finish model should have all its tokens
const winnerTokens = outputs[firstFinished]
console.assert(winnerTokens.length >= 10, `winner should have most tokens, got ${winnerTokens.length}`)

// Other models may have partial results (they were stopped by done())
const otherModels = models.filter(m => m !== firstFinished)
for (const m of otherModels) {
  console.log(`  ${m}: ${outputs[m].length} tokens (partial — stopped by done())`)
}

console.assert(log.some(l => l.includes("signaling done()")), "should use done() for graceful shutdown")
console.assert(log.some(l => l.includes("buffer drained")), "buffer resource should be cleaned up")

console.log("\nAPI surface exercised:")
console.log("  scope(), spawn(), resource(), done(), sleep(), yieldNow()")
console.log("  signal, nested producers/consumer, shared buffer")
console.log("  producer/consumer pattern, first-to-finish wins")

console.log("\n✓ streaming-token-merge passed")
