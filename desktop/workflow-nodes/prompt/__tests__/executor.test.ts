import { describe, expect, it, vi } from "vitest"
import { promptNodeExecutor } from "../executor.main"

const ctx = { projectId: "p1", runId: "r1", abortSignal: new AbortController().signal }
const deps = (response: string) => ({
  sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response, durationMs: 5 }),
})

describe("promptNodeExecutor", () => {
  it("interpolates {{name}} in prompt before sending", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "ok", durationMs: 5 })
    await promptNodeExecutor.execute({
      config: { agent: "claude-code", variables: [], prompt: "Hello {{name}}" },
      resolvedVariables: { name: "world" },
      context: ctx, agentDeps: { sendToAgent },
    })
    expect((sendToAgent.mock.calls[0][0] as { prompt: string }).prompt).toBe("Hello world")
  })
  it("returns success with agent response as output", async () => {
    const r = await promptNodeExecutor.execute({
      config: { agent: "claude-code", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx, agentDeps: deps("answer"),
    })
    expect(r.status).toBe("success")
    expect(r.output).toBe("answer")
  })
  it("returns failed when agent fails", async () => {
    const r = await promptNodeExecutor.execute({
      config: { agent: "claude-code", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "timeout", durationMs: 100 }) },
    })
    expect(r.status).toBe("failed")
    expect(r.error).toBe("timeout")
  })
})
