// Discovers and runs all example .mjs files under examples/
import { readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(import.meta.url), "..")

function collect(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) files.push(...collect(full))
    else if (e.name.endsWith(".mjs") && e.name !== "run.mjs") files.push(full)
  }
  return files.sort()
}

const filter = process.argv[2]
const all = collect(root)
const examples = filter ? all.filter(f => f.replace(/\\/g, "/").includes(filter)) : all

if (filter && examples.length === 0) {
  console.error(`No examples matching "${filter}"`)
  process.exit(1)
}

let passed = 0

for (const file of examples) {
  const label = file.slice(root.length + 1).replace(/\\/g, "/")
  process.stdout.write(`  ${label} ... `)
  try {
    const out = execFileSync("node", [file], { stdio: ["ignore", "pipe", "pipe"] })
    if (examples.length === 1) {
      process.stdout.write("\n" + out.toString())
    } else {
      process.stdout.write("ok\n")
    }
    passed++
  } catch (err) {
    process.stdout.write("FAILED\n")
    process.stderr.write(err.stderr?.toString() || err.stdout?.toString() || err.message)
    process.exit(1)
  }
}

console.log(`\n${passed}/${examples.length} examples passed`)
