import { describe, expect, it } from "vitest"
import {
  mapAgentEventPayload,
  SessionEventLog,
} from "../../electron/services/session-event-service"

describe("session event mapping", () => {
  it("appends stream events with per-session seq and publishes records", () => {
    const published: unknown[] = []
    const log = new SessionEventLog({
      now: () => new Date("2026-04-25T00:00:00.000Z"),
      publisher: (record) => published.push(record),
    })

    const text = log.append("s1", { type: "text", content: "hello", sessionId: "agent-1" })
    const tool = log.append("s1", { type: "tool_use", toolName: "Bash", toolInput: "pwd" })
    const other = log.append("s2", { type: "thinking", content: "plan" })

    expect(text).toMatchObject({
      sessionId: "s1",
      seq: 1,
      type: "text",
      timestamp: "2026-04-25T00:00:00.000Z",
      payload: { content: "hello", agentSessionId: "agent-1" },
    })
    expect(tool).toMatchObject({
      sessionId: "s1",
      seq: 2,
      type: "tool_use",
      payload: { toolName: "Bash", toolInput: "pwd" },
    })
    expect(other.seq).toBe(1)
    expect(log.list("s1").map((event) => event.seq)).toEqual([1, 2])
    expect(published).toHaveLength(3)
  })

  it("maps tool result, permission, result, and unknown events into stable payloads", () => {
    expect(mapAgentEventPayload({
      type: "tool_result",
      toolName: "Bash",
      toolResult: "ok",
      toolStatus: "completed",
      toolExitCode: 0,
      toolSuccess: true,
    })).toEqual({
      toolName: "Bash",
      toolResult: "ok",
      toolStatus: "completed",
      toolExitCode: 0,
      toolSuccess: true,
    })

    expect(mapAgentEventPayload({
      type: "permission_request",
      requestId: "req-1",
      toolName: "Edit",
      toolInput: "src/a.ts",
      toolInputRaw: { path: "src/a.ts" },
    })).toEqual({
      requestId: "req-1",
      toolName: "Edit",
      toolInput: "src/a.ts",
      toolInputRaw: { path: "src/a.ts" },
      questions: [],
    })

    expect(mapAgentEventPayload({
      type: "permission_response",
      requestId: "req-1",
      permissionDecision: "deny",
      permissionMessage: "no",
    })).toEqual({
      requestId: "req-1",
      decision: "deny",
      message: "no",
    })

    expect(mapAgentEventPayload({
      type: "result",
      content: "done",
      sessionId: "thread-1",
      inputTokens: 120,
      outputTokens: 42,
    })).toEqual({
      content: "done",
      done: true,
      agentSessionId: "thread-1",
      inputTokens: 120,
      outputTokens: 42,
    })

    expect(mapAgentEventPayload({ type: "unknown-event", content: "raw" })).toEqual({
      error: "raw",
      originalType: "unknown-event",
    })
  })
})
