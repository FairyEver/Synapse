import { describe, expect, it } from "vitest"
import { z } from "zod"

import { AutomationTriggerRegistry } from "../trigger-registry"

const testTrigger = {
  manifest: {
    id: "builtin.test",
    title: "Test",
    defaultConfig: { value: "ok" },
    configSchema: z.object({ value: z.string().min(1) }),
  },
  summarize: (config: { value: string }) => config.value,
}

describe("AutomationTriggerRegistry", () => {
  it("registers and parses trigger config", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register(testTrigger)

    expect(registry.parseConfig("builtin.test", { value: "hello" })).toEqual({ value: "hello" })
    expect(registry.summarize("builtin.test", { value: "hello" })).toBe("hello")
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
