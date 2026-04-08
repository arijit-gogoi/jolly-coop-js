// Moderate: Typeahead search with debounce and cancellation
// Shows: scope, spawn, cancel, sleep, signal
//
// Pattern: Each keystroke cancels the previous search scope and starts
// a new one. The debounce delay (sleep) is inside the scope, so
// cancelling the scope also cancels the pending debounce. No stale
// results, no race conditions.

import { scope, sleep } from "../../dist/index.js"

// Simulated search API
async function searchAPI(query, signal) {
  await sleep(50) // simulate network
  if (signal.aborted) return []
  const all = ["react", "redux", "react-router", "remix", "rollup", "rust", "ruby", "rails"]
  return all.filter(item => item.includes(query.toLowerCase()))
}

// Simulated keystroke stream: user types "re", pauses, types "act"
const keystrokes = [
  { char: "r", delay: 50 },
  { char: "e", delay: 80 },
  { char: "a", delay: 300 },  // pause — debounce fires for "re"
  { char: "c", delay: 60 },
  { char: "t", delay: 60 },
  // final pause lets "react" search complete
]

let currentScope = null
let displayedResults = null
let searchCount = 0
let cancelCount = 0

async function onKeystroke(query) {
  // Cancel previous search if still running
  if (currentScope) {
    currentScope.cancel()
    cancelCount++
  }

  // Start a new search scope
  try {
    await scope(async s => {
      currentScope = s

      // Debounce: wait 150ms before searching
      await sleep(150)

      // If we get here, the debounce wasn't cancelled
      searchCount++
      const results = await s.spawn(() => searchAPI(query, s.signal))
      displayedResults = { query, results }
    })
  } catch {
    // Scope was cancelled — that's expected
  } finally {
    currentScope = null
  }
}

// Simulate the keystroke stream
let typed = ""
for (const { char, delay } of keystrokes) {
  await sleep(delay)
  typed += char
  // Fire and forget — each keystroke starts its own scope
  onKeystroke(typed)
}
// Wait for final search to complete
await sleep(400)

console.log(`Keystrokes: 5 ("r", "e", "a", "c", "t")`)
console.log(`Searches executed: ${searchCount} (debounce filtered the rest)`)
console.log(`Scopes cancelled: ${cancelCount}`)
console.log(`Final results for "${displayedResults?.query}": [${displayedResults?.results.join(", ")}]`)

console.assert(displayedResults.query === "react", `expected "react", got "${displayedResults?.query}"`)
console.assert(displayedResults.results.includes("react"), "results should include react")
console.assert(displayedResults.results.includes("react-router"), "results should include react-router")
console.assert(searchCount < 5, "debounce should prevent all 5 keystrokes from searching")

console.log("\n✓ search-with-cancellation passed")
