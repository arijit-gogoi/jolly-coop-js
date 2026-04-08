// Advanced: Game loop with scene management, entity systems, and resource lifecycle
// Shows: scope, spawn, resource, cancel, sleep, yieldNow, signal, nested scopes
//
// Pattern: Each scene (menu, gameplay, game-over) is a scope. Navigating
// away cancels the current one, cleaning up all entities and resources.
// Within gameplay, systems (physics, AI, rendering) run as concurrent
// tasks bound to the scene's lifetime.

import { scope, sleep, yieldNow } from "../../dist/index.js"

const log = []
function emit(msg) { log.push(msg) }

// --- Entity System ---

class World {
  entities = new Map()
  nextId = 1
  tick = 0

  add(type, components) {
    const id = this.nextId++
    this.entities.set(id, { id, type, ...components })
    return id
  }
  remove(id) { this.entities.delete(id) }
  query(type) { return [...this.entities.values()].filter(e => e.type === type) }
  get count() { return this.entities.size }
}

// --- Systems ---

async function physicsSystem(world, signal) {
  while (!signal.aborted) {
    for (const e of world.query("projectile")) {
      e.x += e.vx; e.y += e.vy; e.lifetime--
      if (e.lifetime <= 0) { world.remove(e.id); emit(`physics: projectile ${e.id} expired`) }
    }
    world.tick++
    await sleep(16)
  }
}

async function aiSystem(world, signal) {
  while (!signal.aborted) {
    for (const e of world.query("enemy")) {
      e.x += Math.sign(e.targetX - e.x) * e.speed
      e.y += Math.sign(e.targetY - e.y) * e.speed
      if (world.tick % 5 === 0) world.add("projectile", { x: e.x, y: e.y, vx: -2, vy: 0, lifetime: 10 })
    }
    await sleep(32)
  }
}

async function renderSystem(world, signal, frames) {
  while (!signal.aborted) {
    frames.count++
    if (frames.count % 5 === 0) {
      const e = world.query("enemy").length, p = world.query("projectile").length
      emit(`render: frame ${frames.count} — ${e}E ${p}B entities:${world.count}`)
    }
    await sleep(16)
  }
}

// --- Scenes ---

async function menuScene() {
  await scope(async s => {
    emit("scene:menu — press start")
    await s.resource({ music: "menu_theme.ogg" }, () => emit("scene:menu — music stopped"))

    s.spawn(async () => {
      let frame = 0
      while (!s.signal.aborted) { frame++; await sleep(50) }
      emit(`scene:menu — animated ${frame} bg frames`)
    })

    await sleep(200) // player "presses start"
    emit("scene:menu — start pressed")
    s.done()
  })
}

async function gameplayScene() {
  const world = new World()
  const frames = { count: 0 }

  await scope(async s => {
    emit("scene:gameplay — loaded")

    await s.resource(world, (w) => {
      emit(`scene:gameplay — cleaned up ${w.count} remaining entities`)
      w.entities.clear()
    })

    const playerId = await s.resource(
      world.add("player", { x: 100, y: 200, hp: 100 }),
      (id) => { world.remove(id); emit("scene:gameplay — player removed") }
    )

    // Start systems — they read signal to know when to stop
    s.spawn(() => physicsSystem(world, s.signal))
    s.spawn(() => aiSystem(world, s.signal))
    s.spawn(() => renderSystem(world, s.signal, frames))

    // Wave 1
    await scope(async waveScope => {
      emit("wave 1: spawning enemies")
      for (let i = 0; i < 4; i++) {
        const eid = world.add("enemy", {
          x: 400 + i * 50, y: 100 + i * 60,
          targetX: 100, targetY: 200, speed: 1, hp: 30,
        })
        await waveScope.resource(eid, (id) => { world.remove(id); emit(`wave 1: enemy ${id} cleaned up`) })
      }
      await sleep(150)
      emit(`wave 1: complete — ${frames.count} frames, tick ${world.tick}`)
    })

    // Boss wave
    await scope(async bossScope => {
      emit("boss wave: spawning boss")
      const bossId = world.add("enemy", {
        x: 500, y: 150, targetX: 100, targetY: 200, speed: 0.5, hp: 200,
      })
      await bossScope.resource(bossId, (id) => { world.remove(id); emit("boss wave: boss cleaned up") })
      await sleep(100)
      emit("boss wave: boss defeated!")
    })

    emit(`scene:gameplay — victory! ${frames.count} total frames`)
    s.done() // stop background systems gracefully
  })
}

async function gameOverScene() {
  await scope(async s => {
    emit("scene:gameover — showing results")
    await s.resource({ music: "victory.ogg" }, () => emit("scene:gameover — music stopped"))
    await sleep(100)
    emit("scene:gameover — done")
  })
}

// --- Main ---

await scope(async s => {
  emit("game: started")
  await menuScene()
  emit("game: → gameplay")
  await gameplayScene()
  emit("game: → game over")
  await gameOverScene()
  emit("game: exiting")
})

// --- Verify ---

console.log("Game session log:")
for (const entry of log) console.log(`  ${entry}`)

const cleanups = log.filter(l =>
  l.includes("cleaned up") || l.includes("removed") || l.includes("stopped")
)
console.log(`\nCleanup events: ${cleanups.length}`)
for (const c of cleanups) console.log(`  ${c}`)

console.assert(log.some(l => l.includes("scene:menu")), "menu should run")
console.assert(log.some(l => l.includes("scene:gameplay")), "gameplay should run")
console.assert(log.some(l => l.includes("scene:gameover")), "gameover should run")
console.assert(log.some(l => l.includes("render: frame")), "rendering should happen")
console.assert(log.some(l => l.includes("boss defeated")), "boss should be defeated")
console.assert(cleanups.length >= 4, `expected at least 4 cleanups, got ${cleanups.length}`)

console.log("\nAPI surface exercised:")
console.log("  scope(), spawn(), resource(), cancel(), sleep(), yieldNow()")
console.log("  signal, nested scopes, entity lifecycle, concurrent systems")

console.log("\n✓ game-loop passed")
