// Basic: Spawn and manage game entities with automatic cleanup
// Shows: scope, spawn, sleep
//
// Pattern: Enemies spawn, live for a duration, then despawn. The scope
// ensures all entities are cleaned up when the wave ends.

import { scope, sleep } from "../../dist/index.js"

const world = { entities: new Set(), ticks: 0 }
const log = []

async function spawnEnemy(s, type, hp, lifetime) {
  const entity = { type, hp, alive: true, spawned: world.ticks }
  world.entities.add(entity)
  log.push(`spawned ${type} (hp:${hp})`)

  await sleep(lifetime)

  entity.alive = false
  world.entities.delete(entity)
  log.push(`despawned ${type} after ${lifetime}ms`)
}

// Run a wave of enemies
await scope(async s => {
  log.push("wave start")

  s.spawn(() => spawnEnemy(s, "goblin",  30, 100))
  s.spawn(() => spawnEnemy(s, "goblin",  30, 120))
  s.spawn(() => spawnEnemy(s, "orc",     80, 200))
  s.spawn(() => spawnEnemy(s, "dragon", 500, 300))
  s.spawn(() => spawnEnemy(s, "goblin",  30,  80))

  // Scope waits for all entities to despawn
})

log.push("wave complete")

console.log("Wave timeline:")
for (const entry of log) console.log(`  ${entry}`)

console.assert(world.entities.size === 0, "all entities should be cleaned up")
console.assert(log.filter(l => l.includes("spawned")).length === 5, "5 entities spawned")
console.assert(log.filter(l => l.includes("despawned")).length === 5, "5 entities despawned")
console.assert(log[log.length - 1] === "wave complete", "wave should complete last")

console.log("\n✓ entity-spawner passed")
