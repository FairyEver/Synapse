import { describe, expect, it, vi } from "vitest"
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

  it("reports durationMs as 0", async () => {
    const result = await endNodeExecutor.execute(makeInput("test"))
    expect(result.durationMs).toBe(0)
  })
})
