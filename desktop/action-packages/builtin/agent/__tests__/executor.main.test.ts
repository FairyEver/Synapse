import { describe, expect, it, vi } from "vitest"

import type { AgentRuntimeService } from "../../../../electron/services/agent-runtime/agent-runtime-service"
import { createAgentAction } from "../executor.main"

describe("builtin agent action executor", () => {
  it("preserves scheduled agent timeout status", async () => {
    const runtime = {
      sendScheduled: vi.fn(async () => ({
        conversationId: "conversation-1",
        status: "timeout" as const,
        error: "Execution exceeded 60000ms timeout",
        durationMs: 60_000,
      })),
    } as unknown as AgentRuntimeService
    const action = createAgentAction({
      getAgentRuntime: async () => runtime,
    })

    const result = await action.execute({
      config: {
        projectId: "project-1",
        agentType: "claude-code",
        mode: "default",
        prompt: "Run scheduled work",
        sessionPolicy: "fresh",
        timeoutMins: 1,
      },
      context: {
        taskId: "task-1",
        runId: "run-1",
        triggeredBy: "schedule",
        cwd: "/repo",
        actor: { kind: "user", id: "task-scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(result).toMatchObject({
      status: "timeout",
      error: "Execution exceeded 60000ms timeout",
      outputs: { conversationId: "conversation-1" },
      metrics: { durationMs: 60_000 },
    })
  })

  it("maps scheduler-aborted agent errors to cancelled", async () => {
    const runtime = {
      sendScheduled: vi.fn(async () => ({
        conversationId: "",
        status: "error" as const,
        error: "Aborted before execution",
        durationMs: 12,
      })),
    } as unknown as AgentRuntimeService
    const action = createAgentAction({
      getAgentRuntime: async () => runtime,
    })
    const controller = new AbortController()
    controller.abort()

    const result = await action.execute({
      config: {
        projectId: "project-1",
        agentType: "claude-code",
        mode: "default",
        prompt: "Run scheduled work",
        sessionPolicy: "fresh",
        timeoutMins: 1,
      },
      context: {
        taskId: "task-1",
        runId: "run-1",
        triggeredBy: "manual",
        cwd: "/repo",
        actor: { kind: "user", id: "task-scheduler" },
        abortSignal: controller.signal,
      },
    })

    expect(result).toMatchObject({
      status: "cancelled",
      error: "Aborted before execution",
      metrics: { durationMs: 12 },
    })
  })

  it("does not persist raw Agent runtime failure text in scheduler results", async () => {
    const rawError = "SDK failed for prompt token=sk-test at /Users/liyang/private/repo"
    const runtime = {
      sendScheduled: vi.fn(async () => ({
        conversationId: "conversation-1",
        status: "error" as const,
        error: rawError,
        durationMs: 120,
      })),
    } as unknown as AgentRuntimeService
    const action = createAgentAction({
      getAgentRuntime: async () => runtime,
    })

    const result = await action.execute({
      config: {
        projectId: "project-1",
        agentType: "claude-code",
        mode: "default",
        prompt: "Run scheduled work",
        sessionPolicy: "fresh",
        timeoutMins: 1,
      },
      context: {
        taskId: "task-1",
        runId: "run-1",
        triggeredBy: "schedule",
        cwd: "/repo",
        actor: { kind: "user", id: "task-scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(result).toMatchObject({
      status: "failed",
      error: `Agent runtime error (${rawError.length} chars)`,
      outputs: { conversationId: "conversation-1" },
      metrics: { durationMs: 120 },
    })
    expect(JSON.stringify(result)).not.toContain("sk-test")
    expect(JSON.stringify(result)).not.toContain("/Users/liyang/private")
    expect(JSON.stringify(result)).not.toContain("prompt token")
  })
})
