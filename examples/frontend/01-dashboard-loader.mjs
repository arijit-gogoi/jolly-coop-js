// Basic: Load multiple data sources for a dashboard concurrently
// Shows: scope, spawn, awaiting tasks
//
// Pattern: A dashboard needs user profile, notifications, and feed data.
// Fetch all at once instead of sequentially — the scope ensures all
// complete (or all fail) before rendering.

import { scope, sleep } from "../../dist/index.js"

// Simulated API calls with varying latency
async function fetchProfile()       { await sleep(80); return { name: "Ada Lovelace", avatar: "ada.png" } }
async function fetchNotifications() { await sleep(40); return [{ id: 1, text: "New follower" }, { id: 2, text: "Reply to your post" }] }
async function fetchFeed()          { await sleep(120); return [{ id: 1, title: "Structured concurrency in JS" }, { id: 2, title: "Why async/await isn't enough" }] }

const start = performance.now()

const dashboard = await scope(async s => {
  const profileTask       = s.spawn(fetchProfile)
  const notificationsTask = s.spawn(fetchNotifications)
  const feedTask          = s.spawn(fetchFeed)

  return {
    profile:       await profileTask,
    notifications: await notificationsTask,
    feed:          await feedTask,
  }
})

const elapsed = (performance.now() - start).toFixed(0)

console.log(`Dashboard loaded in ${elapsed}ms (concurrent, not ${80 + 40 + 120}ms sequential)`)
console.log(`  Profile: ${dashboard.profile.name}`)
console.log(`  Notifications: ${dashboard.notifications.length}`)
console.log(`  Feed items: ${dashboard.feed.length}`)

console.assert(dashboard.profile.name === "Ada Lovelace", "profile wrong")
console.assert(dashboard.notifications.length === 2, "notifications wrong")
console.assert(dashboard.feed.length === 2, "feed wrong")
console.assert(Number(elapsed) < 200, "should be concurrent, not sequential")

console.log("\n✓ dashboard-loader passed")
