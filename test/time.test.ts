import { expect, test } from "vitest"
import { parseDuration } from "../src/time.js"

test("number passes through unchanged", () => {
  expect(parseDuration(0)).toBe(0)
  expect(parseDuration(100)).toBe(100)
  expect(parseDuration(60_000)).toBe(60_000)
})

test("string ms unit", () => {
  expect(parseDuration("0ms")).toBe(0)
  expect(parseDuration("500ms")).toBe(500)
  expect(parseDuration("999ms")).toBe(999)
})

test("string s unit", () => {
  expect(parseDuration("1s")).toBe(1_000)
  expect(parseDuration("30s")).toBe(30_000)
})

test("string m unit", () => {
  expect(parseDuration("1m")).toBe(60_000)
  expect(parseDuration("2m")).toBe(120_000)
})

test("string h unit", () => {
  expect(parseDuration("1h")).toBe(3_600_000)
  expect(parseDuration("24h")).toBe(86_400_000)
})

test("rejects fractional values", () => {
  expect(() => parseDuration("1.5h")).toThrow(TypeError)
  expect(() => parseDuration("0.5s")).toThrow(TypeError)
})

test("rejects compound forms", () => {
  expect(() => parseDuration("1h30m")).toThrow(TypeError)
  expect(() => parseDuration("1m30s")).toThrow(TypeError)
})

test("rejects unknown units", () => {
  expect(() => parseDuration("1d")).toThrow(TypeError)
  expect(() => parseDuration("1y")).toThrow(TypeError)
  expect(() => parseDuration("100ns")).toThrow(TypeError)
})

test("rejects whitespace", () => {
  expect(() => parseDuration(" 30s")).toThrow(TypeError)
  expect(() => parseDuration("30s ")).toThrow(TypeError)
  expect(() => parseDuration("30 s")).toThrow(TypeError)
})

test("rejects negative numbers", () => {
  expect(() => parseDuration(-1)).toThrow(TypeError)
})

test("rejects non-finite numbers", () => {
  expect(() => parseDuration(Infinity)).toThrow(TypeError)
  expect(() => parseDuration(NaN)).toThrow(TypeError)
})

test("rejects non-string non-number inputs", () => {
  // @ts-expect-error — exercising runtime guard
  expect(() => parseDuration({})).toThrow(TypeError)
  // @ts-expect-error
  expect(() => parseDuration(null)).toThrow(TypeError)
  // @ts-expect-error
  expect(() => parseDuration(undefined)).toThrow(TypeError)
})

test("rejects empty string", () => {
  expect(() => parseDuration("")).toThrow(TypeError)
})

test("composes with deadline option naturally", () => {
  const deadline = Date.now() + parseDuration("100ms")
  expect(deadline).toBeGreaterThan(Date.now())
  expect(deadline).toBeLessThanOrEqual(Date.now() + 200)
})
