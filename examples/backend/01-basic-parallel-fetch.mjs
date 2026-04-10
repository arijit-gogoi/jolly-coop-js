// Basic: Fetch multiple endpoints concurrently, collect results
// Shows: scope, spawn, awaiting tasks

import { scope } from "../../dist/index.js"

const urls = [
  "https://jsonplaceholder.typicode.com/posts/1",
  "https://jsonplaceholder.typicode.com/posts/2",
  "https://jsonplaceholder.typicode.com/posts/3",
  "https://jsonplaceholder.typicode.com/users/1",
  "https://jsonplaceholder.typicode.com/users/2",
]

const results = await scope(async s => {
  // Spawn a task for each URL — all run concurrently
  const tasks = urls.map(url =>
    s.spawn(async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${url}: ${res.status}`)
      return res.json()
    })
  )

  // Await all tasks — if any fails, the scope cancels the rest
  const data = []
  for (const task of tasks) data.push(await task)
  return data
})

console.log(`Fetched ${results.length} resources concurrently`)
for (const r of results) {
  const label = r.title ? `Post: "${r.title.slice(0, 50)}"` : `User: ${r.name}`
  console.log(`  ${label}`)
}

console.assert(results.length === 5, `expected 5 results, got ${results.length}`)

console.log("\n✓ basic-parallel-fetch passed")
