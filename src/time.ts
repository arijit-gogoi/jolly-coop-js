/**
 * Parse a duration into milliseconds. Accepts:
 *
 * - A finite non-negative number — interpreted as milliseconds, returned as-is.
 * - A string in the form `<digits><unit>`, where `unit` is one of:
 *   - `ms` — milliseconds
 *   - `s`  — seconds
 *   - `m`  — minutes
 *   - `h`  — hours
 *
 * Examples: `"500ms"`, `"30s"`, `"2m"`, `"1h"`.
 *
 * Whitespace, fractional values, compound forms (`"1h30m"`), and units
 * larger than `h` are rejected. Throws `TypeError` with a descriptive
 * message on any malformed input.
 *
 * Useful when wiring CLI flags or config values into `scope({ timeout })`
 * or `scope({ deadline: Date.now() + parseDuration(opt) })`.
 */
export function parseDuration(input: number | string): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      throw new TypeError(`parseDuration: number must be a non-negative finite ms count, got ${input}`)
    }
    return input
  }
  if (typeof input !== "string") {
    throw new TypeError(`parseDuration: expected number or string, got ${typeof input}`)
  }
  const match = /^(\d+)(ms|s|m|h)$/.exec(input)
  if (!match) {
    throw new TypeError(`parseDuration: cannot parse ${JSON.stringify(input)} (expected forms: "500ms", "30s", "2m", "1h")`)
  }
  const n = Number(match[1])
  switch (match[2]) {
    case "ms": return n
    case "s":  return n * 1_000
    case "m":  return n * 60_000
    case "h":  return n * 3_600_000
  }
  throw new TypeError(`parseDuration: unreachable unit ${match[2]}`)
}
