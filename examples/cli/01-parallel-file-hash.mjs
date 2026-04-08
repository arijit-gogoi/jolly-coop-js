// Basic: Hash multiple files in parallel
// Shows: scope, spawn, sleep
//
// Pattern: CLI tools often process multiple files concurrently.
// Jolly scope ensures all tasks complete before the tool exits.

import { scope, sleep } from "../../dist/index.js"

// Simulated file operations (replace with fs.readFile + crypto in real code)
async function hashFile(path) {
  const size = Math.floor(Math.random() * 5000) + 500
  await sleep(10 + size / 500) // simulate read time proportional to size
  // Simulate a hash digest
  const hash = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
  return { path, size, hash }
}

const files = [
  "src/index.ts",
  "src/scheduler.ts",
  "src/scope.ts",
  "src/task.ts",
  "src/sleep.ts",
  "src/errors.ts",
  "src/types.ts",
  "package.json",
  "tsconfig.json",
]

const start = performance.now()

const results = await scope(async s => {
  const tasks = files.map(f => s.spawn(() => hashFile(f)))
  const out = []
  for (const t of tasks) out.push(await t)
  return out
})

const elapsed = (performance.now() - start).toFixed(0)

console.log(`Hashed ${results.length} files in ${elapsed}ms`)
for (const { path, size, hash } of results) {
  console.log(`  ${hash}  ${path} (${size}B)`)
}

console.assert(results.length === files.length, `expected ${files.length} results`)
console.assert(results.every(r => r.hash.length === 8), "all hashes should be 8 chars")
console.assert(Number(elapsed) < 500, "parallel should be fast")

console.log("\n✓ parallel-file-hash passed")
