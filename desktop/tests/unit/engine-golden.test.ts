import { describe, expect, it } from "vitest"
import { AgentEngineService, dequeueBusyMessage, queueBusyMessage, type BusyMessage } from "../../electron/services/agent-engine-service"
import { AgentSessionsRepository } from "../../electron/services/sessions-repository-service"
import { SessionEventLog } from "../../electron/services/session-event-service"

function fixedNow() {
  let tick = 0
  return () => new Date(Date.UTC(2026, 3, 25, 0, tick += 1, 0))
}

describe("agent engine golden state machine", () => {
  it("records user and assistant history and uses accumulated text when result content is empty", () => {
    const now = fixedNow()
    const repository = new AgentSessionsRepository({ now })
    const session = repository.newSession("telegram:user", "main")
    const engine = new AgentEngineService({ now })

    const result = engine.processTurn({
      sessionId: session.id,
      prompt: "hello",
      repository,
      events: [
        { type: "text", content: "hello " },
        { type: "text", content: "world", sessionId: "thread-1" },
        { type: "result", done: true },
      ],
    })

    expect(result).toMatchObject({
      status: "completed",
      response: "hello world",
      textSegments: ["hello ", "world"],
      agentSessionId: "thread-1",
      toolCount: 0,
      error: null,
    })
    expect(repository.findById(session.id)?.history.map((entry) => [entry.role, entry.content])).toEqual([
      ["user", "hello"],
      ["assistant", "hello world"],
    ])
  })

  it("keeps tool progress events ordered before the final result", () => {
    const log = new SessionEventLog({ now: () => new Date("2026-04-25T00:00:00.000Z") })
    const engine = new AgentEngineService({ eventLog: log })

    const result = engine.processTurn({
      sessionId: "s1",
      prompt: "run pwd",
      events: [
        { type: "thinking", content: "Plan first" },
        { type: "tool_use", toolName: "Bash", toolInput: "pwd" },
        { type: "tool_result", toolName: "Bash", toolResult: "/repo", toolStatus: "completed", toolExitCode: 0, toolSuccess: true },
        { type: "text", content: "done" },
        { type: "result", content: "done", done: true },
      ],
    })

    expect(result.status).toBe("completed")
    expect(result.toolCount).toBe(1)
    expect(result.records.map((event) => [event.seq, event.type])).toEqual([
      [1, "thinking"],
      [2, "tool_use"],
      [3, "tool_result"],
      [4, "text"],
      [5, "result"],
    ])
  })

  it("pauses on permission requests unless auto-approve is enabled", () => {
    const engine = new AgentEngineService()
    const permissionEvent = {
      type: "permission_request",
      requestId: "req-1",
      toolName: "Edit",
      toolInput: "src/app.ts",
      toolInputRaw: { path: "src/app.ts" },
    }

    const waiting = engine.processTurn({
      sessionId: "s1",
      prompt: "edit",
      events: [
        { type: "text", content: "checking" },
        permissionEvent,
        { type: "result", content: "done", done: true },
      ],
    })

    expect(waiting.status).toBe("waiting_permission")
    expect(waiting.pendingPermission).toMatchObject({ requestId: "req-1", toolName: "Edit" })
    expect(waiting.response).toBe("")

    const approved = engine.processTurn({
      sessionId: "s2",
      prompt: "edit",
      autoApprovePermissions: true,
      events: [
        permissionEvent,
        { type: "result", content: "done", done: true },
      ],
    })

    expect(approved.status).toBe("completed")
    expect(approved.response).toBe("done")
  })

  it("returns error, stopped, and timed_out terminal states", () => {
    const engine = new AgentEngineService()

    expect(engine.processTurn({
      sessionId: "s1",
      prompt: "fail",
      events: [{ type: "error", error: "agent failed" }],
    })).toMatchObject({ status: "error", error: "agent failed" })

    expect(engine.processTurn({
      sessionId: "s2",
      prompt: "stop",
      stopAfterEvents: 1,
      events: [
        { type: "text", content: "partial" },
        { type: "result", content: "done", done: true },
      ],
    })).toMatchObject({ status: "stopped", response: "" })

    expect(engine.processTurn({
      sessionId: "s3",
      prompt: "slow",
      idleTimeoutMs: 100,
      eventGapsMs: [150],
      events: [{ type: "text", content: "late" }],
    })).toMatchObject({
      status: "timed_out",
      error: "agent session timed out (no response)",
    })
  })

  it("queues busy messages FIFO and rejects overflow", () => {
    let queue: BusyMessage[] = []
    for (let index = 0; index < 5; index += 1) {
      const next = queueBusyMessage(queue, { content: `msg-${index}` })
      expect(next).not.toBeNull()
      queue = next ?? queue
    }

    expect(queueBusyMessage(queue, { content: "overflow" })).toBeNull()

    const first = dequeueBusyMessage(queue)
    expect(first.message).toEqual({ content: "msg-0" })
    expect(first.remaining.map((message) => message.content)).toEqual(["msg-1", "msg-2", "msg-3", "msg-4"])
  })
})
