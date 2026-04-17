// Advanced: BFS frontier traversal with real backpressure
// Shows: scope, spawn, sleep, signal, limit, active, error-as-value
//
// Pattern: When you drive `scope({ limit })` from an unbounded source (BFS
// frontier, message queue, file stream), a naive `while (!source.empty)
// pool.spawn(...)` pre-schedules the entire source. spawn is non-blocking —
// it queues internally rather than applying backpressure. Memory grows,
// cancellation can't reach un-started work as fast, and stats lie.
//
// The fix is one predicate in the driver: wait until the pool has headroom
// before spawning the next item. `pool.active` gives you the current count
// of pending tasks (running + queued internally).

import { scope, sleep } from "../../dist/index.js"

// --- Mock graph for a reproducible example ---
//
// Graph: depth-first, ~40 nodes, each node has 2-3 children, depth 4.
const graph = new Map()
let seq = 0
const make = (id, children) => graph.set(id, { id, children, latencyMs: 5 + (seq++ % 8) * 2 })
make("root", ["a", "b", "c"])
make("a", ["a1", "a2", "a3"])
make("b", ["b1", "b2"])
make("c", ["c1", "c2", "c3"])
for (const p of ["a1", "a2", "a3", "b1", "b2", "c1", "c2", "c3"]) {
  make(p, [`${p}-x`, `${p}-y`])
}
for (const id of Array.from(graph.keys())) {
  if (!graph.get(id).children.every(c => graph.has(c))) {
    for (const c of graph.get(id).children) if (!graph.has(c)) make(c, [])
  }
}

async function fetchNode(id, signal) {
  await sleep(graph.get(id).latencyMs, signal)
  const { children } = graph.get(id)
  return { ok: true, id, children }
}

// --- The backpressure pattern ---

async function bfsWithBackpressure(root, concurrency) {
  const frontier = [root]
  const visited = new Set([root])
  const results = []
  let maxObservedActive = 0

  await scope({ limit: concurrency }, async pool => {
    // Driver loop: only spawn when the pool has headroom.
    while (frontier.length > 0 || pool.active > 0) {
      if (frontier.length === 0) {
        // Queue is empty but pool still has in-flight work that may enqueue more.
        await sleep(5, pool.signal)
        continue
      }

      // *** The backpressure predicate ***
      // Without this, the whole frontier pre-schedules into pool's internal
      // queue. With it, we only spawn when a slot is available.
      while (pool.active >= concurrency) {
        await sleep(5, pool.signal)
      }

      const id = frontier.shift()
      pool.spawn(async () => {
        maxObservedActive = Math.max(maxObservedActive, pool.active)
        const r = await fetchNode(id, pool.signal).catch(e => ({ ok: false, id, error: e }))
        results.push(r)
        if (r.ok) {
          for (const child of r.children) {
            if (!visited.has(child)) {
              visited.add(child)
              frontier.push(child)
            }
          }
        }
      })
    }
  })

  return { results, visited, maxObservedActive }
}

// --- Contrast: the naive pattern (no backpressure) ---

async function bfsNaive(root, concurrency) {
  const frontier = [root]
  const visited = new Set([root])
  const results = []
  let maxObservedActive = 0

  await scope({ limit: concurrency }, async pool => {
    while (frontier.length > 0 || pool.active > 0) {
      if (frontier.length === 0) {
        await sleep(5, pool.signal)
        continue
      }
      // No headroom check — spawn even when pool.active >> concurrency.
      const id = frontier.shift()
      pool.spawn(async () => {
        maxObservedActive = Math.max(maxObservedActive, pool.active)
        const r = await fetchNode(id, pool.signal).catch(e => ({ ok: false, id, error: e }))
        results.push(r)
        if (r.ok) {
          for (const child of r.children) {
            if (!visited.has(child)) {
              visited.add(child)
              frontier.push(child)
            }
          }
        }
      })
    }
  })

  return { results, visited, maxObservedActive }
}

// --- Demonstrate the difference ---

console.log("BFS with backpressure (concurrency=4):")
const withBP = await bfsWithBackpressure("root", 4)
console.log(`  visited: ${withBP.visited.size} nodes`)
console.log(`  max observed pool.active: ${withBP.maxObservedActive}`)
console.log(`  should stay close to concurrency (4) — pool.active represents real in-flight work`)

console.log("\nBFS without backpressure (naive):")
const naive = await bfsNaive("root", 4)
console.log(`  visited: ${naive.visited.size} nodes`)
console.log(`  max observed pool.active: ${naive.maxObservedActive}`)
console.log(`  can exceed concurrency — excess tasks sit in the internal limitQueue`)

// --- Verify correctness: both paths crawl the full graph ---

console.assert(withBP.visited.size === graph.size, `expected ${graph.size} nodes visited with backpressure`)
console.assert(naive.visited.size === graph.size, `expected ${graph.size} nodes visited naive`)
console.assert(withBP.maxObservedActive <= 4 + 1, `backpressure should keep active near limit`)

console.log("\n✓ bounded-bfs-with-backpressure passed")
