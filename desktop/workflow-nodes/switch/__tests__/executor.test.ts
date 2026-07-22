import { beforeEach, describe, expect, it, vi } from "vitest"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => logger,
}))

import { switchNodeExecutor } from "../executor.main"

const ctx = {
  projectId: "p1",
  workflowId: "wf1",
  workflowName: "WF",
  runId: "r1",
  nodeId: "switch1",
  nodeName: "Switch",
  abortSignal: new AbortController().signal,
}
const config = {
  providerId: "test-provider", modelTier: "sonnet" as const, variables: [], prompt: "Which?",
  branches: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
}

describe("switchNodeExecutor", () => {
  beforeEach(() => {
    logger.info.mockClear()
    logger.warn.mockClear()
  })

  it("sets activeBranch when response matches branch id (trims + lowercases)", async () => {
    const r = await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "  YES  ", durationMs: 5 }) },
    })
    expect(r.activeBranch).toBe("yes")
  })
  it("returns Agent usage and cost with matched branch output", async () => {
    const r = await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: {
        sendToAgent: vi.fn().mockResolvedValue({
          status: "success" as const,
          response: "yes",
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
      activeBranch: "yes",
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
        response: "yes",
        durationMs: 5,
        agentConversation: target,
      }
    })

    const r = await switchNodeExecutor.execute({
      config,
      resolvedVariables: {},
      context: ctx,
      agentDeps: { sendToAgent },
      onAgentConversation,
      onProgress,
    })

    expect(r).toMatchObject({
      status: "success",
      activeBranch: "yes",
      agentConversation: target,
    })
    expect(onAgentConversation).toHaveBeenCalledWith(target)
    expect(onProgress).toHaveBeenCalledWith("processing_response", "处理中…")
  })
  it("uses defaultBranch on mismatch if configured", async () => {
    const r = await switchNodeExecutor.execute({
      config: { ...config, defaultBranch: "no" }, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "maybe", durationMs: 5 }) },
    })
    expect(r.status).toBe("success"); expect(r.activeBranch).toBe("no")
  })
  it("does not match branch ID from substring (e.g. 'no' in 'not enough information')", async () => {
    const r = await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "not enough information", durationMs: 5 }) },
    })
    expect(r.status).toBe("failed")
    expect(r.activeBranch).toBeUndefined()
    expect(r.error).toBe("Agent 响应不匹配任何分支 [yes, no]")
  })
  it("matches Chinese branch IDs inside explanatory responses", async () => {
    const r = await switchNodeExecutor.execute({
      config: {
        ...config,
        branches: [{ id: "正面", label: "正面" }, { id: "负面", label: "负面" }],
      },
      resolvedVariables: {},
      context: ctx,
      agentDeps: {
        sendToAgent: vi.fn().mockResolvedValue({
          status: "success" as const,
          response: "这个观点是正面的。",
          durationMs: 5,
        }),
      },
    })
    expect(r.status).toBe("success")
    expect(r.activeBranch).toBe("正面")
  })
  it("fails provider API error text instead of falling back to defaultBranch", async () => {
    const r = await switchNodeExecutor.execute({
      config: { ...config, defaultBranch: "no" }, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "API Error: 402 Insufficient Balance", durationMs: 5 }) },
    })
    expect(r.status).toBe("failed")
    expect(r.activeBranch).toBeUndefined()
    expect(r.output).toBe("")
    expect(r.error).toContain("402 Insufficient Balance")
  })
  it("returns failed on mismatch with no defaultBranch", async () => {
    const r = await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "maybe", durationMs: 5 }) },
    })
    expect(r.status).toBe("failed"); expect(r.error).toBe("Agent 响应不匹配任何分支 [yes, no]")
  })
  it("appends branch list constraint to prompt", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "yes", durationMs: 5 })
    await switchNodeExecutor.execute({ config, resolvedVariables: {}, context: ctx, agentDeps: { sendToAgent } })
    const sent = (sendToAgent.mock.calls[0][0] as { prompt: string }).prompt
    expect(sent).toContain("- yes"); expect(sent).toContain("- no")
  })
  it("uses a 60 minute Agent timeout by default", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "yes", durationMs: 5 })
    await switchNodeExecutor.execute({ config, resolvedVariables: {}, context: ctx, agentDeps: { sendToAgent } })
    expect(sendToAgent).toHaveBeenCalledWith(expect.objectContaining({ timeoutMins: 60 }))
  })
  it("passes a custom Agent timeout in minutes", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "yes", durationMs: 5 })
    await switchNodeExecutor.execute({
      config: { ...config, timeoutMins: 45 },
      resolvedVariables: {},
      context: ctx,
      agentDeps: { sendToAgent },
    })
    expect(sendToAgent).toHaveBeenCalledWith(expect.objectContaining({ timeoutMins: 45 }))
  })

  it("passes workflow metadata to Agent calls", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "yes", durationMs: 5 })
    await switchNodeExecutor.execute({ config, resolvedVariables: {}, context: ctx, agentDeps: { sendToAgent } })
    expect(sendToAgent).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: "wf1",
      workflowName: "WF",
      workflowRunId: "r1",
      workflowNodeId: "switch1",
      workflowNodeName: "Switch",
    }))
  })

  it("logs switch branch label shape without raw labels", async () => {
    const sensitiveLabel = "Customer sk-secret at /Users/liyang/private"
    await switchNodeExecutor.execute({
      config: {
        ...config,
        branches: [
          { id: "yes", label: sensitiveLabel },
          { id: "no", label: "No" },
        ],
      },
      resolvedVariables: {},
      context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "yes", durationMs: 5 }) },
    })

    expect(logger.info).toHaveBeenCalledWith("switch node executing", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      workflowId: "wf1",
      nodeId: "switch1",
      providerId: "test-provider",
      modelTier: "sonnet",
      branchIds: ["yes", "no"],
      branchCount: 2,
      branchLabelLengths: [sensitiveLabel.length, "No".length],
    }))
    const logs = JSON.stringify(logger.info.mock.calls)
    expect(logs).not.toContain(sensitiveLabel)
    expect(logs).not.toContain("sk-secret")
    expect(logs).not.toContain("/Users/liyang/private")
  })

  it("logs switch Agent diagnostics without raw response or error text", async () => {
    const matchedResponse = "yes\nsk-secret from /Users/liyang/private"
    const mismatchResponse = "sk-secret from /Users/liyang/private"
    const agentError = "SDK failed for token=sk-secret at /Users/liyang/private prompt"

    await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: matchedResponse, durationMs: 5 }) },
    })
    await switchNodeExecutor.execute({
      config: { ...config, defaultBranch: "no" }, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: mismatchResponse, durationMs: 5 }) },
    })
    const failed = await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: mismatchResponse, durationMs: 5 }) },
    })
    const agentFailed = await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: agentError, durationMs: 5 }) },
    })

    expect(failed.error ?? "").not.toContain("sk-secret")
    expect(failed.error ?? "").not.toContain("/Users/liyang/private")
    expect(agentFailed.error ?? "").not.toContain("sk-secret")
    expect(agentFailed.error ?? "").not.toContain("/Users/liyang/private")
    // After fix: error shows sanitized content, not just length
    expect(agentFailed.error ?? "").toContain("Agent 调用失败：")
    expect((agentFailed.error ?? "").length).toBeGreaterThan(20)
    expect(logger.info).toHaveBeenCalledWith("switch node branch matched", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      workflowId: "wf1",
      nodeId: "switch1",
      activeBranch: "yes",
      responseLength: matchedResponse.trim().length,
      normalizedResponseLength: "yes".length,
    }))
    expect(logger.info).toHaveBeenCalledWith("switch node using default branch (no match)", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      workflowId: "wf1",
      nodeId: "switch1",
      activeBranch: "no",
      responseLength: mismatchResponse.length,
    }))
    expect(logger.warn).toHaveBeenCalledWith("switch node branch match failed — no match and no default", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      workflowId: "wf1",
      nodeId: "switch1",
      responseLength: mismatchResponse.length,
      normalizedResponseLength: mismatchResponse.length,
    }))
    expect(logger.warn).toHaveBeenCalledWith("switch node agent call failed", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      workflowId: "wf1",
      nodeId: "switch1",
      errorName: "agent",
      errorLength: agentError.length,
      sanitizedError: expect.stringContaining("[redacted]"),
    }))
    const logs = JSON.stringify({
      info: logger.info.mock.calls,
      warn: logger.warn.mock.calls,
    })
    expect(logs).not.toContain("sk-secret")
    expect(logs).not.toContain("/Users/liyang/private")
    expect(logs).not.toContain("secret prompt")
  })
})
