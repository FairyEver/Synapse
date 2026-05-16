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
  sendToAgent: vi.fn(async (_input: { providerId: string; modelTier: string; prompt: string; projectId: string; abortSignal: AbortSignal }) => ({
    status: "success" as const, response, durationMs: 5,
  })),
})

describe("promptNodeExecutor", () => {
  beforeEach(() => {
    logger.info.mockClear()
    logger.warn.mockClear()
  })

  it("interpolates {{name}} in prompt before sending", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "ok", durationMs: 5 })
    await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "Hello {{name}}" },
      resolvedVariables: { name: "world" },
      context: ctx, agentDeps: { sendToAgent },
    })
    expect((sendToAgent.mock.calls[0][0] as { prompt: string }).prompt).toBe("Hello world")
  })
  it("returns success with agent response as output", async () => {
    const r = await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx, agentDeps: deps("answer"),
    })
    expect(r.status).toBe("success")
    expect(r.output).toBe("answer")
  })
  it("returns the actual Agent error for UI display", async () => {
    const error = "SDK failed with token=sk-secret from /Users/liyang/private"
    const r = await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error, durationMs: 100 }) },
    })
    expect(r.status).toBe("failed")
    expect(r.error).toBe(error)
  })

  it("logs Agent diagnostics without prompt, output, or raw error text", async () => {
    const prompt = "Summarize sk-secret from /Users/liyang/private"
    const output = "answer includes private repository context"
    const error = "SDK failed for secret prompt at /Users/liyang/private"

    await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt },
      resolvedVariables: {},
      context: ctx,
      agentDeps: deps(output),
    })
    await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" },
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
      providerId: "test-provider",
      modelTier: "sonnet",
      promptLength: prompt.length,
    }))
    expect(logger.info).toHaveBeenCalledWith("prompt node succeeded", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      providerId: "test-provider",
      modelTier: "sonnet",
      outputLength: output.length,
    }))
    expect(logger.warn).toHaveBeenCalledWith("prompt node agent call failed", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      providerId: "test-provider",
      modelTier: "sonnet",
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
