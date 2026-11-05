import { z } from "zod"
import { describe, expect, it } from "vitest"

import {
  MainActionRegistry,
  type MainActionDefinition,
} from "../action-registry"
import { createBuiltinMainActionRegistry } from "../builtin-actions"

const testSchema = z.object({ message: z.string().min(1) })
type TestConfig = z.infer<typeof testSchema>

const action: MainActionDefinition<TestConfig> = {
  manifest: {
    id: "builtin.test",
    title: "Test",
    permissions: ["shell.exec"],
    defaultConfig: { message: "ok" },
    configFields: [
      { name: "message", kind: "string", required: true, defaultValue: "ok" },
    ],
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

  it("registers Agent and Claude Code and rejects every retired executor type", () => {
    const registry = createBuiltinMainActionRegistry({
      getAgentRuntime: async () => undefined,
      launchClaudeCode: async () => { throw new Error("No terminal in registry discovery test") },
    })
    expect(registry.list().map(action => action.manifest.id)).toEqual(["builtin.agent", "builtin.claude-code"])
    expect(registry.parseConfig("builtin.claude-code", { projectId: "p1", prompt: "review" })).toEqual({ projectId: "p1", prompt: "review" })
    expect(() => registry.parseConfig("builtin.claude-code", { projectId: "p1", prompt: "review", providerId: "override" })).toThrow()
    for (const type of ["command", "script", "http-request", "workflow", "javascript-run", "nodejs-run"]) {
      expect(() => registry.parseConfig(`builtin.${type}`, {})).toThrow(/not registered/)
    }
  })
})
