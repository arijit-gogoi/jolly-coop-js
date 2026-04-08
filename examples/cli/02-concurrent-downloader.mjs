// Moderate: Concurrent file downloader with progress reporting
// Shows: scope, spawn, sleep, yieldNow, limit
//
// Pattern: Download multiple files with a concurrency cap, reporting
// progress as each file completes. The limit prevents overwhelming
// the network or remote server.

import { scope, sleep, yieldNow } from "../../dist/index.js"

// Simulated download
async function download(url, signal) {
  const sizeKB = Math.floor(Math.random() * 900) + 100
  const chunks = Math.ceil(sizeKB / 100)

  let downloaded = 0
  for (let i = 0; i < chunks; i++) {
    if (signal?.aborted) throw new Error("download cancelled")
    await sleep(15 + Math.random() * 25) // simulate chunk transfer
    downloaded += Math.min(100, sizeKB - downloaded)
  }

  return { url, sizeKB, downloaded }
}

const urls = [
  "https://cdn.example.com/assets/bundle.js",
  "https://cdn.example.com/assets/styles.css",
  "https://cdn.example.com/images/hero.png",
  "https://cdn.example.com/images/logo.svg",
  "https://cdn.example.com/fonts/sans.woff2",
  "https://cdn.example.com/fonts/mono.woff2",
  "https://cdn.example.com/data/config.json",
  "https://cdn.example.com/data/i18n-en.json",
]

let completed = 0
const results = []
const start = performance.now()

await scope({ limit: 3 }, async s => {
  for (const url of urls) {
    s.spawn(async () => {
      const result = await download(url, s.signal)
      results.push(result)
      completed++
      const file = url.split("/").pop()
      console.log(`  [${completed}/${urls.length}] ${file} (${result.sizeKB}KB)`)
      await yieldNow()
    })
  }
})

const elapsed = (performance.now() - start).toFixed(0)
const totalKB = results.reduce((sum, r) => sum + r.sizeKB, 0)

console.log(`\nDownloaded ${results.length} files (${totalKB}KB total) in ${elapsed}ms`)
console.log(`Concurrency: 3 parallel downloads`)

console.assert(results.length === urls.length, `expected ${urls.length} downloads`)
console.assert(completed === urls.length, "all downloads should complete")

console.log("\n✓ concurrent-downloader passed")
