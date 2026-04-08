// Moderate: Ability system with cooldowns, cancellation, and combo chains
// Shows: scope, spawn, sleep, yieldNow, cancel, signal
//
// Pattern: A player has abilities on cooldowns. Casting an ability starts
// a scoped coroutine. Getting stunned cancels all active abilities.
// Combo abilities chain into follow-ups using nested scopes.

import { scope, sleep, yieldNow } from "../../dist/index.js"

const log = []
function emit(msg) { log.push(msg) }

const player = {
  mana: 100,
  buffs: new Set(),
  casting: null,
}

async function castFireball(s) {
  emit("fireball: casting (1.5s)")
  player.mana -= 20
  await sleep(150) // 1.5s cast time scaled to 150ms for test

  emit("fireball: hit! 50 damage")

  // Fireball leaves a DOT — ticks 3 times
  s.spawn(async () => {
    for (let i = 1; i <= 3; i++) {
      if (s.signal.aborted) break
      await sleep(50)
      emit(`fireball: DOT tick ${i} — 10 damage`)
    }
  })
}

async function castShield(s) {
  emit("shield: activated (5s duration)")
  player.buffs.add("shield")
  await sleep(500) // 5s duration scaled
  player.buffs.delete("shield")
  emit("shield: expired")
}

async function castCombo(s) {
  // Phase 1: slash
  emit("combo: slash — 20 damage")
  await sleep(60)
  await yieldNow()

  // Phase 2: kick (nested scope — has its own timing)
  await scope(async kickScope => {
    emit("combo: kick — 15 damage + stun")
    await sleep(40)

    // Kick applies a brief stun effect
    kickScope.spawn(async () => {
      emit("combo: stun applied (0.5s)")
      await sleep(50)
      emit("combo: stun wore off")
    })
  })

  // Phase 3: finisher (only if combo wasn't interrupted)
  emit("combo: finisher — 40 damage!")
  await sleep(30)
}

// --- Scenario 1: Cast abilities, all complete naturally ---

emit("=== Scenario 1: Normal combat ===")
await scope(async s => {
  s.spawn(() => castFireball(s))
  s.spawn(() => castShield(s))
  await sleep(50)
  s.spawn(() => castCombo(s))
})

console.assert(player.buffs.size === 0, "shield should have expired")

// --- Scenario 2: Get stunned mid-cast — everything cancels ---

emit("\n=== Scenario 2: Stunned mid-combat ===")
player.mana = 100
let stunCancelled = false

try {
  await scope(async s => {
    s.spawn(() => castFireball(s))
    s.spawn(() => castShield(s))
    s.spawn(() => castCombo(s))

    // Stun hits after 100ms — cancels all active abilities
    await sleep(100)
    emit("STUNNED! All abilities cancelled")
    s.cancel()
  })
} catch {
  stunCancelled = true
  player.buffs.clear()
}

console.assert(stunCancelled, "stun should cancel the scope")

// --- Output ---

console.log("Combat log:")
for (const entry of log) console.log(`  ${entry}`)

const scenario1 = log.indexOf("=== Scenario 1: Normal combat ===")
const scenario2 = log.indexOf("\n=== Scenario 2: Stunned mid-combat ===")
const s1Entries = log.slice(scenario1 + 1, scenario2)
const s2Entries = log.slice(scenario2 + 1)

console.assert(s1Entries.some(l => l.includes("finisher")), "combo should complete in scenario 1")
console.assert(s1Entries.some(l => l.includes("DOT tick")), "DOT should tick in scenario 1")
console.assert(s2Entries.some(l => l.includes("STUNNED")), "stun should fire in scenario 2")

console.log("\n✓ ability-cooldowns passed")
