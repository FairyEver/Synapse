import { beforeEach, describe, expect, it, vi } from "vitest"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => logger,
}))

import { promptNodeExecutor } from "../executor.main"

const ctx = { projectId: "p1", runId: "r1", abortSignal: new AbortController().signal }
const deps = (response: string) => ({
  sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response, durationMs: 5 }),
})

describe("promptNodeExecutor", () => {
  beforeEach(() => {
    logger.info.mockClear()
    logger.warn.mockClear()
  })

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
  it("returns failed with a summarized Agent error", async () => {
    const error = "SDK failed with token=sk-secret from /Users/liyang/private"
    const r = await promptNodeExecutor.execute({
      config: { agent: "claude-code", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error, durationMs: 100 }) },
    })
    expect(r.status).toBe("failed")
    expect(r.error).toBe(`Agent 调用失败（错误 ${error.length} 字）`)
    expect(r.error).not.toContain("sk-secret")
    expect(r.error).not.toContain("/Users/liyang/private")
  })

  it("logs Agent diagnostics without prompt, output, or raw error text", async () => {
    const prompt = "Summarize sk-secret from /Users/liyang/private"
    const output = "answer includes private repository context"
    const error = "SDK failed for secret prompt at /Users/liyang/private"

    await promptNodeExecutor.execute({
      config: { agent: "claude-code", variables: [], prompt },
      resolvedVariables: {},
      context: ctx,
      agentDeps: deps(output),
    })
    await promptNodeExecutor.execute({
      config: { agent: "claude-code", variables: [], prompt: "test" },
      resolvedVariables: {},
      context: ctx,
      agentDeps: {
        sendToAgent: vi.fn().mockResolvedValue({
          status: "failed" as const,
          response: "",
          error,
          durationMs: 100,
        }),
      },
    })

    expect(logger.info).toHaveBeenCalledWith("prompt node executing", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      agent: "claude-code",
      promptLength: prompt.length,
    }))
    expect(logger.info).toHaveBeenCalledWith("prompt node succeeded", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      agent: "claude-code",
      outputLength: output.length,
    }))
    expect(logger.warn).toHaveBeenCalledWith("prompt node agent call failed", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      agent: "claude-code",
      errorName: "agent",
      errorLength: error.length,
    }))
    const logs = JSON.stringify({
      info: logger.info.mock.calls,
      warn: logger.warn.mock.calls,
    })
    expect(logs).not.toContain("sk-secret")
    expect(logs).not.toContain("/Users/liyang/private")
    expect(logs).not.toContain("private repository context")
    expect(logs).not.toContain("secret prompt")
  })
})
