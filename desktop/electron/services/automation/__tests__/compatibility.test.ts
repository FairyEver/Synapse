import { describe, expect, it } from "vitest"
import { z } from "zod"

import { AutomationCompatibilityError, automationFormatIssue, automationConfigIssue, parseAutomationConfig } from "../../../../automation-trigger-packages/compatibility"

const base = { schemaVersion: 2, scope: { type: "global" }, policy: { missedRunPolicy: "skip", overlapPolicy: "skip" } }

describe("Automation V2 compatibility contract", () => {
  it("recognizes undeclared nested fields even when a known value is invalid", () => {
    const schema = z.object({ count: z.number().positive(), nested: z.object({ value: z.string() }).optional() })
    const config = { count: 0, nested: { value: "ok", future: true } }
    expect(automationConfigIssue(schema, config)).toBe(true)
  })
  it("recognizes strict unknown-field errors inside a union", () => {
    const schema = z.union([
      z.object({ type: z.literal("a"), nested: z.object({ value: z.string() }).strict() }).strict(),
      z.object({ type: z.literal("b") }).strict(),
    ])
    expect(automationConfigIssue(schema, { type: "a", nested: { value: "ok", future: true } })).toBe(true)
  })
  it("does not lock a known project scope with a missing project id", () => {
    expect(automationFormatIssue({ ...base, scope: { type: "project", projectId: "" } })).toBeUndefined()
  })
  it("accepts historical V2 without a revision and the explicit current revision", () => {
    expect(automationFormatIssue(base)).toBeUndefined()
    expect(automationFormatIssue({ ...base, formatRevision: 1 })).toBeUndefined()
  })
  it.each([null, 0, -1, 1.5, "1", Number.NaN, 2])("does not treat revision %s as the default", formatRevision => {
    expect(automationFormatIssue({ ...base, formatRevision })).toMatchObject({ field: "formatRevision" })
  })
  it.each([
    z.object({ nested: z.object({ value: z.string() }) }),
    z.object({ nested: z.object({ value: z.string() }).strict() }).strict(),
  ])("rejects unknown nested fields without altering the original config", schema => {
    const config = { nested: { value: "current", future: { enabled: true } } }
    const original = structuredClone(config)
    expect(automationConfigIssue(schema, config)).toBe(true)
    expect(() => parseAutomationConfig(schema, config)).toThrow(AutomationCompatibilityError)
    expect(config).toEqual(original)
  })
  it("allows declared defaults and open record payloads", () => {
    const schema = z.object({ retry: z.number().default(0), values: z.record(z.string(), z.unknown()) })
    const input = { values: { arbitrary: { future: true } } }
    expect(parseAutomationConfig(schema, input)).toEqual({ retry: 0, ...input })
  })
  it("keeps known invalid configuration repairable", () => {
    expect(automationConfigIssue(z.object({ count: z.number().positive() }), { count: -1 })).toBe(false)
    expect(automationFormatIssue({ ...base, conditions: { operator: "and", items: [{ type: "weekdays", days: [] }] } })).toBeUndefined()
  })
})
