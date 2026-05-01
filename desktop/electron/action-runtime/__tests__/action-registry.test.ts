import { z } from "zod"
import { describe, expect, it } from "vitest"

import {
  MainActionRegistry,
  type MainActionDefinition,
} from "../action-registry"

const testSchema = z.object({ message: z.string().min(1) })
type TestConfig = z.infer<typeof testSchema>

const action: MainActionDefinition<TestConfig> = {
  manifest: {
    id: "builtin.test",
    title: "Test",
    permissions: ["shell.exec"],
    defaultConfig: { message: "ok" },
    configSchema: testSchema,
  },
  buildPermissionRequest: ({ config, context }) => ({
    action: "shell.exec",
    actor: context.actor,
    resource: config.message,
    context: { source: "test" },
  }),
  execute: async ({ config }) => ({
    status: "success",
    summary: config.message,
  }),
}

describe("MainActionRegistry", () => {
  it("registers and resolves actions", () => {
    const registry = new MainActionRegistry()
    registry.register(action)

    expect(registry.get("builtin.test")).toBe(action)
    expect(registry.list().map((item) => item.manifest.id)).toEqual(["builtin.test"])
  })

  it("rejects duplicate action ids", () => {
    const registry = new MainActionRegistry()
    registry.register(action)

    expect(() => registry.register(action)).toThrow(/already registered/)
  })

  it("throws for unknown action ids", () => {
    const registry = new MainActionRegistry()

    expect(() => registry.get("missing.action")).toThrow(/not registered/)
  })

  it("validates config through the action schema", () => {
    const registry = new MainActionRegistry()
    registry.register(action)

    expect(registry.parseConfig("builtin.test", { message: "hello" })).toEqual({ message: "hello" })
    expect(() => registry.parseConfig("builtin.test", { message: "" })).toThrow()
  })
})
