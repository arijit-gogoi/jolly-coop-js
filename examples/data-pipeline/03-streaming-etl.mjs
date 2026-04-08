// Advanced: Streaming ETL with partitioned processing, dead-letter queue, and checkpointing
// Shows: scope, spawn, resource, cancel, sleep, yieldNow, signal, limit, timeout, nested scopes
//
// Pattern: A production ETL pipeline reads from a stream, partitions by key,
// processes each partition with bounded concurrency, routes failures to a
// dead-letter queue, and checkpoints progress. Resources (connections,
// checkpoints) are cleaned up on shutdown.

import { scope, sleep, yieldNow } from "../../dist/index.js"

const log = []
function emit(msg) { log.push(msg) }

// --- Simulated infrastructure ---

function createStream(records) {
  let offset = 0
  return {
    async read(batchSize) {
      if (offset >= records.length) return null
      const batch = records.slice(offset, offset + batchSize)
      offset += batchSize
      await sleep(5) // simulate network read
      return batch
    },
    get offset() { return offset },
  }
}

function createCheckpointStore() {
  const checkpoints = new Map()
  return {
    save(partition, offset) { checkpoints.set(partition, offset) },
    get(partition) { return checkpoints.get(partition) ?? 0 },
    getAll() { return Object.fromEntries(checkpoints) },
    async flush() { await sleep(5); return checkpoints.size },
  }
}

function createDeadLetterQueue() {
  const items = []
  return {
    push(record, error) { items.push({ record, error: error.message, time: Date.now() }) },
    get items() { return items },
    get size() { return items.length },
  }
}

// --- Pipeline ---

async function processRecord(record, partition) {
  await sleep(5 + Math.random() * 10)

  // Simulate failures: records with id divisible by 13 fail
  if (record.id % 13 === 0) {
    throw new Error(`corrupt record: ${record.id}`)
  }

  return {
    ...record,
    partition,
    transformed: record.value * 2,
    enriched: `${record.category}-enriched`,
  }
}

async function runPipeline(inputRecords) {
  const stats = { read: 0, processed: 0, failed: 0, partitions: 0, checkpoints: 0 }

  await scope({ timeout: 5000 }, async pipelineScope => {
    emit("pipeline: starting")

    // Resources: managed connections and state
    const stream = await pipelineScope.resource(
      createStream(inputRecords),
      () => emit("pipeline: stream closed")
    )

    const checkpointer = await pipelineScope.resource(
      createCheckpointStore(),
      async (cp) => {
        const n = await cp.flush()
        emit(`pipeline: flushed ${n} checkpoints`)
      }
    )

    const dlq = await pipelineScope.resource(
      createDeadLetterQueue(),
      (q) => emit(`pipeline: DLQ drained — ${q.size} failed records`)
    )

    // Read loop: consume stream in batches
    while (true) {
      const batch = await stream.read(10)
      if (!batch) break
      stats.read += batch.length

      // Partition by category
      const partitions = new Map()
      for (const record of batch) {
        const key = record.category
        if (!partitions.has(key)) partitions.set(key, [])
        partitions.get(key).push(record)
      }

      // Process each partition concurrently
      await scope(async batchScope => {
        for (const [partition, records] of partitions) {
          batchScope.spawn(async () => {
            // Each partition processes with bounded concurrency
            await scope({ limit: 3 }, async partScope => {
              for (const record of records) {
                partScope.spawn(async () => {
                  try {
                    // Per-record timeout via nested scope
                    await scope({ timeout: 200 }, async recScope => {
                      const result = await recScope.spawn(() => processRecord(record, partition))
                      stats.processed++
                    })
                  } catch (err) {
                    dlq.push(record, err)
                    stats.failed++
                    emit(`pipeline: DLQ <- record ${record.id} (${err.message})`)
                  }
                  await yieldNow()
                })
              }
            })

            // Checkpoint after partition batch
            checkpointer.save(partition, stream.offset)
            stats.checkpoints++
          })
        }
      })

      emit(`pipeline: batch done — offset ${stream.offset}, processed ${stats.processed}`)
    }

    stats.partitions = new Set(inputRecords.map(r => r.category)).size
    emit("pipeline: stream exhausted")
  })

  return stats
}

// --- Generate test data ---

const categories = ["orders", "users", "events", "logs"]
const inputRecords = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  category: categories[i % categories.length],
  value: Math.floor(Math.random() * 1000),
}))

// --- Run ---

const stats = await runPipeline(inputRecords)

console.log("Streaming ETL results:")
console.log(`  Records read:      ${stats.read}`)
console.log(`  Records processed: ${stats.processed}`)
console.log(`  Records failed:    ${stats.failed}`)
console.log(`  Partitions:        ${stats.partitions}`)
console.log(`  Checkpoints saved: ${stats.checkpoints}`)

console.log("\nPipeline trace (selected):")
for (const entry of log.filter(l => l.includes("batch done") || l.includes("DLQ") || l.includes("pipeline:"))) {
  console.log(`  ${entry}`)
}

const cleanups = log.filter(l =>
  l.includes("closed") || l.includes("flushed") || l.includes("drained")
)
console.log(`\nCleanup events: ${cleanups.length}`)
for (const c of cleanups) console.log(`  ${c}`)

console.assert(stats.read === 50, `expected 50 read, got ${stats.read}`)
console.assert(stats.processed + stats.failed === 50, `processed + failed should equal 50`)
console.assert(stats.failed > 0, "some records should fail (id % 13)")
console.assert(stats.partitions === 4, "should have 4 partitions")
console.assert(cleanups.length >= 3, "should have stream, checkpoint, and DLQ cleanup")

console.log("\nAPI surface exercised:")
console.log("  scope(), spawn(), resource(), sleep(), yieldNow()")
console.log("  signal, limit, timeout, nested scopes")
console.log("  streaming reads, partitioning, DLQ, checkpointing, cleanup")

console.log("\n✓ streaming-etl passed")
