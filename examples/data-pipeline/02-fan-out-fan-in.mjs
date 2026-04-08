// Moderate: Fan-out/fan-in pipeline with stages and backpressure
// Shows: scope, spawn, sleep, yieldNow, limit
//
// Pattern: Data flows through stages — extract, transform, load.
// The transform stage fans out to multiple workers with a concurrency
// limit (backpressure). Results fan back in for the load stage.

import { scope, sleep, yieldNow } from "../../dist/index.js"

// Stage 1: Extract — read records from source
async function extract() {
  const records = []
  for (let i = 1; i <= 30; i++) {
    records.push({ id: i, raw: `data-${i}`, bytes: Math.floor(Math.random() * 10000) })
  }
  return records
}

// Stage 2: Transform — enrich, validate, normalize (CPU-bound simulation)
async function transformRecord(record) {
  await sleep(10 + record.bytes / 1000) // processing time scales with size
  return {
    ...record,
    normalized: record.raw.toUpperCase(),
    valid: record.bytes > 500,
    checksum: (record.id * 7 + record.bytes) % 256,
  }
}

// Stage 3: Load — write to destination (I/O-bound simulation)
async function loadRecord(record) {
  await sleep(5) // simulate DB write
  return record.id
}

const start = performance.now()
const stats = { extracted: 0, transformed: 0, loaded: 0, skipped: 0 }

const loadedIds = await scope(async s => {
  // Extract
  const records = await s.spawn(extract)
  stats.extracted = records.length
  console.log(`Extracted ${records.length} records`)

  // Transform — fan out with concurrency limit (backpressure)
  const transformed = []
  await scope({ limit: 5 }, async transformScope => {
    for (const record of records) {
      transformScope.spawn(async () => {
        const result = await transformRecord(record)
        stats.transformed++
        if (result.valid) {
          transformed.push(result)
        } else {
          stats.skipped++
        }
        await yieldNow()
      })
    }
  })
  console.log(`Transformed ${stats.transformed}, valid: ${transformed.length}, skipped: ${stats.skipped}`)

  // Load — fan in with concurrency limit
  const ids = []
  await scope({ limit: 10 }, async loadScope => {
    for (const record of transformed) {
      loadScope.spawn(async () => {
        const id = await loadRecord(record)
        ids.push(id)
        stats.loaded++
        await yieldNow()
      })
    }
  })

  return ids
})

const elapsed = (performance.now() - start).toFixed(0)

console.log(`Loaded ${stats.loaded} records in ${elapsed}ms`)
console.log(`Pipeline: ${stats.extracted} → ${stats.transformed} → ${stats.loaded} (${stats.skipped} filtered)`)

console.assert(stats.extracted === 30, "should extract 30")
console.assert(stats.transformed === 30, "should transform all 30")
console.assert(stats.loaded + stats.skipped === 30, "loaded + skipped should equal total")
console.assert(stats.loaded > 0, "should load some records")
console.assert(loadedIds.length === stats.loaded, "loaded IDs should match count")

console.log("\n✓ fan-out-fan-in passed")
