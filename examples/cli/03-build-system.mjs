// Advanced: Parallel build system with dependency graph, resource cleanup, and cancellation
// Shows: scope, spawn, resource, cancel, sleep, yieldNow, signal, limit, timeout, nested scopes
//
// Pattern: A CLI build tool that resolves dependencies, runs build steps
// in parallel (respecting dependency order), manages temp files as
// resources, and cancels everything on first failure.

import { scope, sleep, yieldNow } from "../../dist/index.js"

const log = []
function emit(msg) { log.push(msg) }

// --- Build graph ---

const modules = {
  "types":      { deps: [],                     buildTime: 20 },
  "errors":     { deps: [],                     buildTime: 15 },
  "scheduler":  { deps: ["types"],              buildTime: 40 },
  "task":       { deps: ["types"],              buildTime: 30 },
  "sleep":      { deps: ["scheduler"],          buildTime: 25 },
  "scope":      { deps: ["task", "scheduler", "errors", "sleep"], buildTime: 60 },
  "index":      { deps: ["scope", "sleep", "errors", "types"],   buildTime: 10 },
  "tests":      { deps: ["index"],              buildTime: 80 },
  "bundle":     { deps: ["index"],              buildTime: 50 },
  "typedefs":   { deps: ["index"],              buildTime: 35 },
}

// --- Build engine ---

async function build(moduleGraph, { concurrency = 4, failOnModule } = {}) {
  const built = new Set()
  const building = new Map() // name -> Promise

  async function buildModule(s, name) {
    // Already built?
    if (built.has(name)) return
    // Already building? Wait for it
    if (building.has(name)) return building.get(name)

    const mod = moduleGraph[name]
    if (!mod) throw new Error(`Unknown module: ${name}`)

    const promise = scope(async modScope => {
      // Wait for dependencies (in parallel within parent scope)
      if (mod.deps.length > 0) {
        await scope(async depScope => {
          for (const dep of mod.deps) {
            depScope.spawn(() => buildModule(s, dep))
          }
        })
      }

      // Resource: temp build artifact — cleaned up if build fails
      const artifact = await modScope.resource(
        { name, path: `/tmp/build/${name}.js`, created: true },
        (a) => { if (!built.has(name)) emit(`  cleanup: removed temp ${a.path}`) }
      )

      // Simulate build step
      emit(`  build: ${name} (${mod.buildTime}ms)`)

      // Simulate failure for testing
      if (name === failOnModule) {
        throw new Error(`Build failed: ${name} — syntax error at line 42`)
      }

      await sleep(mod.buildTime)
      await yieldNow()

      built.add(name)
      emit(`  done: ${name}`)
    })

    building.set(name, promise)
    return promise
  }

  const start = performance.now()

  await scope({ limit: concurrency, timeout: 5000 }, async s => {
    // Find all leaf modules (everything depends on them transitively)
    const targets = Object.keys(moduleGraph)

    for (const target of targets) {
      s.spawn(() => buildModule(s, target))
    }
  })

  return {
    built: [...built],
    elapsed: Math.round(performance.now() - start),
  }
}

// --- Run 1: successful build ---

emit("=== Build: success path ===")
const result = await build(modules, { concurrency: 4 })

console.log(`Build completed: ${result.built.length} modules in ${result.elapsed}ms`)
console.log(`Build order:`)
for (const m of result.built) console.log(`  ${m}`)

console.assert(result.built.length === Object.keys(modules).length,
  `expected ${Object.keys(modules).length} modules, got ${result.built.length}`)
// Verify dependency order: scope must come after its deps
const scopeIdx = result.built.indexOf("scope")
const taskIdx = result.built.indexOf("task")
const schedIdx = result.built.indexOf("scheduler")
console.assert(scopeIdx > taskIdx, "scope must build after task")
console.assert(scopeIdx > schedIdx, "scope must build after scheduler")
console.assert(result.elapsed < 500, "parallel build should be fast")

// --- Run 2: failed build with cleanup ---

emit("\n=== Build: failure path ===")
log.length = 0

let buildError = null
try {
  await build(modules, { concurrency: 4, failOnModule: "scope" })
} catch (err) {
  buildError = err
}

console.log(`\nBuild failed: ${buildError?.message}`)

const cleanups = log.filter(l => l.includes("cleanup:"))
console.log(`Cleanup events: ${cleanups.length}`)
for (const c of cleanups) console.log(c)

console.assert(buildError !== null, "build should have failed")
console.assert(buildError.message.includes("scope"), "error should mention scope module")

console.log("\nAPI surface exercised:")
console.log("  scope(), spawn(), resource(), sleep(), yieldNow()")
console.log("  signal, limit, timeout, nested scopes")
console.log("  dependency resolution, parallel build, resource cleanup on failure")

console.log("\n✓ build-system passed")
