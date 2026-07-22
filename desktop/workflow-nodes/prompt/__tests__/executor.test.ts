import { beforeEach, describe, expect, it, vi } from "vitest"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => logger,
}))

import { promptNodeExecutor } from "../executor.main"

const ctx = {
  projectId: "p1",
  workflowId: "wf1",
  workflowName: "WF",
  runId: "r1",
  nodeId: "node1",
  nodeName: "Prompt",
  abortSignal: new AbortController().signal,
}
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
  it("uses a 60 minute Agent timeout by default", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "ok", durationMs: 5 })
    await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" },
      resolvedVariables: {},
      context: ctx, agentDeps: { sendToAgent },
    })
    expect(sendToAgent).toHaveBeenCalledWith(expect.objectContaining({ timeoutMins: 60 }))
  })
  it("passes a custom Agent timeout in minutes", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "ok", durationMs: 5 })
    await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test", timeoutMins: 45 },
      resolvedVariables: {},
      context: ctx, agentDeps: { sendToAgent },
    })
    expect(sendToAgent).toHaveBeenCalledWith(expect.objectContaining({ timeoutMins: 45 }))
  })
  it("passes workflow metadata to Agent calls", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "ok", durationMs: 5 })
    await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" },
      resolvedVariables: {},
      context: ctx, agentDeps: { sendToAgent },
    })
    expect(sendToAgent).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: "wf1",
      workflowName: "WF",
      workflowRunId: "r1",
      workflowNodeId: "node1",
      workflowNodeName: "Prompt",
    }))
  })
  it("returns success with agent response as output", async () => {
    const r = await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx, agentDeps: deps("answer"),
    })
    expect(r.status).toBe("success")
    expect(r.output).toBe("answer")
  })

  it("returns Agent usage and cost with successful output", async () => {
    const r = await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" },
      resolvedVariables: {},
      context: ctx,
      agentDeps: {
        sendToAgent: vi.fn().mockResolvedValue({
          status: "success" as const,
          response: "answer",
          durationMs: 5,
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 4,
          },
          costUsd: 0.01,
        }),
      },
    })

    expect(r).toMatchObject({
      status: "success",
      output: "answer",
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 4,
      },
      costUsd: 0.01,
    })
  })

  it("returns and reports the Agent conversation target", async () => {
    const target = {
      projectId: "p1",
      conversationId: "conversation-1",
      sessionKey: "workflow:p1:123",
      platform: "workflow" as const,
    }
    const onAgentConversation = vi.fn()
    const onProgress = vi.fn()
    const sendToAgent = vi.fn(async (
      input: {
        onConversationCreated?: (conversationTarget: typeof target) => void
        onResponseStarted?: () => void
      },
    ) => {
      input.onConversationCreated?.(target)
      input.onResponseStarted?.()
      return {
        status: "success" as const,
        response: "answer",
        durationMs: 5,
        agentConversation: target,
      }
    })

    const r = await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" },
      resolvedVariables: {},
      context: ctx,
      agentDeps: { sendToAgent },
      onAgentConversation,
      onProgress,
    })

    expect(r).toMatchObject({
      status: "success",
      output: "answer",
      agentConversation: target,
    })
    expect(onAgentConversation).toHaveBeenCalledWith(target)
    expect(onProgress).toHaveBeenCalledWith("processing_response", "处理中…")
  })

  it("returns sanitized Agent error for UI display — redacts secrets and paths", async () => {
    const error = "SDK failed with token=sk-secret from /Users/liyang/private"
    const r = await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error, durationMs: 100 }) },
    })
    expect(r.status).toBe("failed")
    expect(r.error).not.toContain("sk-secret")
    expect(r.error).not.toContain("/Users/liyang/private")
    expect(r.error).toContain("Agent 调用失败")
    expect(r.error).toContain("token=[redacted]")
    expect(r.error).toContain("[path]")
  })

  it("returns recoverable Agent interruption guidance without SDK diagnostics", async () => {
    const error = "Agent 执行失败。诊断信息：[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"
    const r = await promptNodeExecutor.execute({
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error, durationMs: 100 }) },
    })

    expect(r.status).toBe("failed")
    expect(r.error).toBe("Agent 在工具调用后中断，发送“继续”可接着执行。")
    expect(r.error).not.toContain("ede_diagnostic")
    expect(r.error).not.toContain("stop_reason")
  })

  it("treats provider API error text as failure even when Agent reports success", async () => {
    const r = await promptNodeExecutor.execute({
      config: { providerId: "deepseek", modelTier: "default", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx,
      agentDeps: deps("API Error: 402 Insufficient Balance"),
    })
    expect(r.status).toBe("failed")
    expect(r.output).toBe("")
    expect(r.error).toContain("Agent 调用失败")
    expect(r.error).toContain("402 Insufficient Balance")
  })

  it("logs Agent diagnostics without prompt, output, or raw error text", async () => {
    const prompt = "Summarize sk-secret from /Users/liyang/private"
    const output = "answer includes private repository context"
    const error = "SDK failed for secret=\"sk-abc123\" at /Users/liyang/private"

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
      workflowId: "wf1",
      nodeId: "node1",
      providerId: "test-provider",
      modelTier: "sonnet",
      promptLength: prompt.length,
    }))
    expect(logger.info).toHaveBeenCalledWith("prompt node succeeded", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      workflowId: "wf1",
      nodeId: "node1",
      providerId: "test-provider",
      modelTier: "sonnet",
      outputLength: output.length,
    }))
    expect(logger.warn).toHaveBeenCalledWith("prompt node agent call failed", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      workflowId: "wf1",
      nodeId: "node1",
      providerId: "test-provider",
      modelTier: "sonnet",
      errorName: "agent",
      errorLength: error.length,
      sanitizedError: "SDK failed for secret=[redacted] at [path]",
    }))
    const logs = JSON.stringify({
      info: logger.info.mock.calls,
      warn: logger.warn.mock.calls,
    })
    expect(logs).not.toContain("sk-secret")
    expect(logs).not.toContain("sk-abc123")
    expect(logs).not.toContain("/Users/liyang/private")
    expect(logs).not.toContain("private repository context")
  })
})
