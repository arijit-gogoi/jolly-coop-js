// Basic: Transform a batch of records concurrently
// Shows: scope, spawn, sleep
//
// Pattern: ETL pipelines read records, transform them, and write results.
// Jolly parallelizes the transform step while maintaining order.

import { scope, sleep } from "../../dist/index.js"

// Simulated data source
const rawRecords = [
  { id: 1, name: "alice",   amount: "100.50" },
  { id: 2, name: "bob",     amount: "250.00" },
  { id: 3, name: "charlie", amount: "75.25"  },
  { id: 4, name: "diana",   amount: "300.10" },
  { id: 5, name: "eve",     amount: "150.75" },
  { id: 6, name: "frank",   amount: "425.00" },
  { id: 7, name: "grace",   amount: "88.50"  },
  { id: 8, name: "hank",    amount: "210.30" },
]

async function transform(record) {
  await sleep(10 + Math.random() * 20) // simulate I/O or computation
  return {
    id: record.id,
    name: record.name.charAt(0).toUpperCase() + record.name.slice(1),
    amount: parseFloat(record.amount),
    tax: parseFloat(record.amount) * 0.08,
    processed: true,
  }
}

const start = performance.now()

const results = await scope(async s => {
  const tasks = rawRecords.map(r => s.spawn(() => transform(r)))
  const out = []
  for (const t of tasks) out.push(await t)
  return out
})

const elapsed = (performance.now() - start).toFixed(0)

console.log(`Transformed ${results.length} records in ${elapsed}ms`)
const totalAmount = results.reduce((sum, r) => sum + r.amount, 0)
const totalTax = results.reduce((sum, r) => sum + r.tax, 0)
console.log(`  Total amount: $${totalAmount.toFixed(2)}`)
console.log(`  Total tax:    $${totalTax.toFixed(2)}`)
for (const r of results) {
  console.log(`  ${r.name}: $${r.amount.toFixed(2)} + $${r.tax.toFixed(2)} tax`)
}

console.assert(results.length === 8, "all records should be processed")
console.assert(results.every(r => r.processed), "all should be marked processed")
console.assert(results[0].name === "Alice", "names should be capitalized")
console.assert(Math.abs(totalTax - totalAmount * 0.08) < 0.01, "tax should be 8%")

console.log("\n✓ transform-batch passed")
