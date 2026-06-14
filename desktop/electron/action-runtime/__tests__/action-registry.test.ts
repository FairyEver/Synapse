import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

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

  it("built-in action manifests expose public config fields", () => {
    const registry = createBuiltinMainActionRegistry({
      processRunner: {
        run: async () => ({
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          durationMs: 0,
        }),
      },
    })

    const summaries = registry.list().map((item) => ({
      id: item.manifest.id,
      fields: item.manifest.configFields.map((field) => field.name),
    }))

    expect(summaries).toEqual(expect.arrayContaining([
      { id: "builtin.command", fields: ["command", "shell", "env", "pathStrategy", "posixLogin", "timeoutMins"] },
      { id: "builtin.script", fields: ["script", "shell", "env", "pathStrategy", "posixLogin", "timeoutMins"] },
      {
        id: "builtin.http-request",
        fields: ["method", "url", "headers", "query", "bodyType", "body", "timeoutMins", "auth"],
      },
    ]))
  })

  it("marks built-in timeout configs above 120 minutes as needing updates", () => {
    const registry = createBuiltinMainActionRegistry({
      processRunner: {
        run: async () => ({
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          durationMs: 0,
        }),
      },
    })

    expect(registry.validateStoredConfig("builtin.command", {
      command: "echo ok",
      shell: "posix",
      timeoutMins: 121,
    })).toEqual({
      status: "needs_update",
      issues: [{ field: "action.config", message: "检查执行内容" }],
    })
    expect(registry.validateStoredConfig("builtin.script", {
      script: "echo ok",
      shell: "posix",
      timeoutMins: 121,
    })).toEqual({
      status: "needs_update",
      issues: [{ field: "action.config", message: "检查执行内容" }],
    })
    expect(registry.validateStoredConfig("builtin.http-request", {
      method: "GET",
      url: "https://example.com",
      bodyType: "none",
      timeoutMins: 121,
    })).toEqual({
      status: "needs_update",
      issues: [{ field: "action.config", message: "检查执行内容" }],
    })
  })

  it("registers workflow action when workflow runtime is supplied", () => {
    const registry = createBuiltinMainActionRegistry({
      processRunner: { run: vi.fn() },
      workflowRuntime: {
        getWorkflowDefinition: vi.fn(),
        runWorkflowAndWait: vi.fn(),
      },
    })

    expect(registry.list().map((action) => action.manifest.id)).toContain("builtin.workflow")
  })
})
