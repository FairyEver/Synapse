import { describe, expect, it } from "vitest"
import { z } from "zod"

import { AutomationTriggerRegistry } from "../trigger-registry"

const testTrigger = {
  manifest: {
    id: "builtin.test",
    title: "Test",
    kind: "schedule" as const,
    defaultConfig: { value: "ok" },
    configSchema: z.object({ value: z.string().min(1) }),
  },
  summarize: (config: { value: string }) => config.value,
  runtime: {
    computeNextRunAt: () => new Date("2026-06-03T00:10:00.000Z"),
  },
}

describe("AutomationTriggerRegistry", () => {
  it("registers and parses trigger config", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register(testTrigger)

    expect(registry.parseConfig("builtin.test", { value: "hello" })).toEqual({ value: "hello" })
    expect(registry.summarize("builtin.test", { value: "hello" })).toBe("hello")
  })

  it("exposes schedule runtime through the trigger definition", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register(testTrigger)

    const trigger = registry.get("builtin.test")

    expect(trigger.manifest.kind).toBe("schedule")
    expect(trigger.runtime.computeNextRunAt?.({
      config: { value: "ok" },
      from: new Date("2026-06-03T00:00:00.000Z"),
      createdAt: "2026-06-03T00:00:00.000Z",
    })).toEqual(new Date("2026-06-03T00:10:00.000Z"))
  })

  it("uses custom stored config validation when provided", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register({
      ...testTrigger,
      validateStoredConfig: () => ({
        status: "needs_update" as const,
        issues: [{ field: "trigger.config.value", message: "值已失效" }],
      }),
    })

    expect(registry.validateStoredConfig("builtin.test", { value: "ok" })).toEqual({
      status: "needs_update",
      issues: [{ field: "trigger.config.value", message: "值已失效" }],
    })
  })

  it("rejects duplicate trigger ids", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register(testTrigger)

    expect(() => registry.register(testTrigger)).toThrow(/already registered/)
  })

  it("reports needs_update for unknown triggers", () => {
    const registry = new AutomationTriggerRegistry()

    expect(registry.validateStoredConfig("missing", {})).toEqual({
      status: "needs_update",
      issues: [{ field: "trigger.type", message: "选择触发器" }],
    })
  })
})
