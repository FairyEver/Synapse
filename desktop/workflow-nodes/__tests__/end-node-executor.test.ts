import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
const logger = vi.hoisted(() => ({
  info: vi.fn(),
}))
vi.mock("../../electron/services/log-store", () => ({
  createMainLogger: () => logger,
}))

import { endNodeExecutor } from "../end/executor.main"
import type { NodeExecutionInput } from "../types"
import type { EndNodeConfig } from "../end/schema"

function makeInput(template: string, vars: Record<string, string> = {}): NodeExecutionInput<EndNodeConfig> {
  return {
    config: { outputType: "text", template, variables: [] },
    resolvedVariables: vars,
    context: { projectId: "p", runId: "r", abortSignal: new AbortController().signal },
    agentDeps: { sendToAgent: vi.fn() },
  }
}

describe("endNodeExecutor", () => {
  it("renders template with resolved variables", async () => {
    const result = await endNodeExecutor.execute(makeInput("Hello {{name}}!", { name: "World" }))
    expect(result.status).toBe("success")
    expect(result.output).toBe("Hello World!")
  })

  it("returns empty string for empty template", async () => {
    const result = await endNodeExecutor.execute(makeInput(""))
    expect(result.status).toBe("success")
    expect(result.output).toBe("")
  })

  it("preserves unresolved placeholders", async () => {
    const result = await endNodeExecutor.execute(makeInput("{{missing}} value"))
    expect(result.output).toBe("{{missing}} value")
  })

  it("does not call Agent", async () => {
    const sendToAgent = vi.fn()
    await endNodeExecutor.execute({ ...makeInput("hi"), agentDeps: { sendToAgent } })
    expect(sendToAgent).not.toHaveBeenCalled()
  })

  it("reports non-negative durationMs", async () => {
    const result = await endNodeExecutor.execute(makeInput("test"))
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("logs template and output diagnostics without raw content", async () => {
    const secret = "sk-secret-end-node-output"
    await endNodeExecutor.execute(makeInput("Hello {{secret}}", { secret }))

    const payload = JSON.stringify(logger.info.mock.calls)
    expect(payload).not.toContain(secret)
    expect(payload).not.toContain("Hello")
    expect(logger.info).toHaveBeenCalledWith("end node executing", expect.objectContaining({
      templateLength: "Hello {{secret}}".length,
      variableCount: 1,
    }))
    expect(logger.info).toHaveBeenCalledWith("end node succeeded", expect.objectContaining({
      outputLength: `Hello ${secret}`.length,
    }))
  })
})
