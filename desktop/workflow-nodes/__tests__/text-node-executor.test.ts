import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))
vi.mock("../../electron/services/log-store", () => ({
  createMainLogger: () => logger,
}))

import { textNodeExecutor } from "../text/executor.main"
import { textNodeConfigSchema } from "../text/schema"
import type { TextNodeConfig } from "../text/schema"
import type { NodeExecutionInput } from "../types"

function makeInput(template: string, variables: Record<string, string> = {}): NodeExecutionInput<TextNodeConfig> {
  return {
    config: { template, variables: [] },
    resolvedVariables: variables,
    context: { runId: "run", abortSignal: new AbortController().signal },
    agentDeps: { sendToAgent: vi.fn() },
  }
}

describe("textNode", () => {
  it("accepts empty and whitespace-only templates", () => {
    expect(textNodeConfigSchema.safeParse({ template: "", variables: [] }).success).toBe(true)
    expect(textNodeConfigSchema.safeParse({ template: " \n ", variables: [] }).success).toBe(true)
  })

  it("returns fixed text without calling Agent", async () => {
    const input = makeInput("fixed text")
    const result = await textNodeExecutor.execute(input)

    expect(result).toMatchObject({ status: "success", output: "fixed text" })
    expect(input.agentDeps.sendToAgent).not.toHaveBeenCalled()
  })

  it("interpolates variables and preserves whitespace", async () => {
    const result = await textNodeExecutor.execute(makeInput("  Hello {{name}}\n", { name: "World" }))

    expect(result).toMatchObject({ status: "success", output: "  Hello World\n" })
  })

  it("returns an empty string for an empty template", async () => {
    const result = await textNodeExecutor.execute(makeInput(""))

    expect(result).toMatchObject({ status: "success", output: "" })
  })

  it("fails when a template variable is not bound", async () => {
    await expect(textNodeExecutor.execute(makeInput("{{missing}}"))).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("模板变量「missing」未绑定"),
    })
  })

  it("logs only text lengths and variable counts", async () => {
    const secret = "secret-text-output"
    await textNodeExecutor.execute(makeInput("{{value}}", { value: secret }))

    const payload = JSON.stringify(logger.info.mock.calls)
    expect(payload).not.toContain(secret)
    expect(logger.info).toHaveBeenCalledWith("text node executing", expect.objectContaining({
      templateLength: "{{value}}".length,
      variableCount: 1,
    }))
    expect(logger.info).toHaveBeenCalledWith("text node succeeded", expect.objectContaining({
      outputLength: secret.length,
    }))
  })
})
