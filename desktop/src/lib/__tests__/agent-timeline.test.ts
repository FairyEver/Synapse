import { describe, expect, it } from "vitest"

import {
  agentEventToTimelineItem,
  appendAgentTimelineEvent,
  historyRecordToTimelineItem,
} from "../agent-timeline"

describe("agent timeline conversion", () => {
  it("converts live tool events into canonical items", () => {
    expect(agentEventToTimelineItem({
      type: "toolUse",
      toolName: "Bash",
      toolInput: "pnpm test",
      toolInputRaw: { cmd: "pnpm test" },
      agentSessionId: "thread-1",
      threadId: "thread-1",
    }, {
      id: "live:1",
      timestamp: "2026-04-28T00:00:00.000Z",
      agentType: "codex",
    })).toEqual({
      id: "live:1",
      kind: "toolCall",
      timestamp: "2026-04-28T00:00:00.000Z",
      agentType: "codex",
      agentSessionId: "thread-1",
      threadId: "thread-1",
      toolName: "Bash",
      toolInput: "pnpm test",
      toolInputRaw: { cmd: "pnpm test" },
    })
  })

  it("adapts stored tool result metadata into canonical items", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "tool",
      content: "ok",
      timestamp: "2026-04-28T00:01:00.000Z",
      metadata: {
        agentEventType: "toolResult",
        toolName: "Bash",
        status: "completed",
        exitCode: 0,
        success: true,
        agentSessionId: "thread-1",
        threadId: "thread-1",
      },
    }, 2, "codex")).toEqual({
      id: "session-1:history:2",
      kind: "toolResult",
      timestamp: "2026-04-28T00:01:00.000Z",
      agentType: "codex",
      agentSessionId: "thread-1",
      threadId: "thread-1",
      toolName: "Bash",
      content: "ok",
      status: "completed",
      exitCode: 0,
      success: true,
    })
  })

  it("falls back to legacy message items when metadata is missing", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "tool",
      content: "Bash\npwd",
      timestamp: "2026-04-28T00:02:00.000Z",
    }, 3, "codex")).toEqual({
      id: "session-1:history:3",
      kind: "message",
      role: "tool",
      content: "Bash\npwd",
      timestamp: "2026-04-28T00:02:00.000Z",
      agentType: "codex",
      legacy: true,
    })
  })

  it("merges assistant text deltas but keeps tool events separate", () => {
    const first = appendAgentTimelineEvent([], {
      type: "text",
      content: "hello",
    }, "2026-04-28T00:03:00.000Z", "codex")
    const second = appendAgentTimelineEvent(first, {
      type: "text",
      content: " world",
    }, "2026-04-28T00:03:01.000Z", "codex")
    const third = appendAgentTimelineEvent(second, {
      type: "toolUse",
      toolName: "Bash",
      toolInput: "pwd",
    }, "2026-04-28T00:03:02.000Z", "codex")

    expect(second).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        content: "hello world",
      }),
    ])
    expect(third).toHaveLength(2)
    expect(third[1]).toEqual(expect.objectContaining({ kind: "toolCall", toolName: "Bash" }))
  })
})
