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

  it("keeps thinking deltas separated across tool boundaries", () => {
    const beforeTool = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "thinking_delta",
      thinking: "Inspect first.",
    }, "2026-05-14T00:00:00.000Z", "claude")
    const withTool = appendAgentTimelineEvent(beforeTool, {
      type: "toolUse",
      toolName: "Read",
      toolInput: "package.json",
    }, "2026-05-14T00:00:01.000Z", "claude")
    const afterTool = appendAgentTimelineEvent(withTool, {
      type: "stream",
      deltaType: "thinking_delta",
      thinking: "Summarize result.",
    }, "2026-05-14T00:00:02.000Z", "claude")

    expect(afterTool.map((item) => item.kind)).toEqual(["thinking", "toolCall", "thinking"])
    expect(afterTool[0]).toEqual(expect.objectContaining({ content: "Inspect first." }))
    expect(afterTool[2]).toEqual(expect.objectContaining({ content: "Summarize result." }))
  })

  it("promotes a standalone result event to a visible message item", () => {
    const userMessage = [{
      id: "user:1",
      kind: "message" as const,
      role: "user" as const,
      content: "hello",
      timestamp: "2026-05-10T00:00:00.000Z",
    }]
    const after = appendAgentTimelineEvent(userMessage, {
      type: "result",
      content: "hermes reply",
      done: true,
    }, "2026-05-10T00:00:01.000Z", "hermes")

    expect(after).toHaveLength(2)
    expect(after[1]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "hermes reply",
      agentType: "hermes",
    }))
  })

  it("keeps result text visible after tool boundaries", () => {
    const assistant = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "text_delta",
      text: "I will inspect it.",
    }, "2026-05-14T01:00:00.000Z", "claude")
    const withTool = appendAgentTimelineEvent(assistant, {
      type: "toolResult",
      toolName: "Read",
      content: "package contents",
      success: true,
    }, "2026-05-14T01:00:01.000Z", "claude")
    const after = appendAgentTimelineEvent(withTool, {
      type: "result",
      content: "Final answer.",
      done: true,
      usage: { input_tokens: 1 },
    }, "2026-05-14T01:00:02.000Z", "claude")

    expect(after.map((item) => item.kind)).toEqual(["message", "toolResult", "message"])
    expect(after[0]).toEqual(expect.objectContaining({ content: "I will inspect it." }))
    expect(after[2]).toEqual(expect.objectContaining({
      role: "assistant",
      content: "Final answer.",
      metadata: { usage: { input_tokens: 1 } },
    }))
  })

  it("uses final result content to complete an existing streamed assistant message", () => {
    const partial = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "text_delta",
      text: "Partial",
    }, "2026-05-14T02:00:00.000Z", "claude")
    const after = appendAgentTimelineEvent(partial, {
      type: "result",
      content: "Partial final answer.",
      done: true,
      usage: { output_tokens: 3 },
    }, "2026-05-14T02:00:01.000Z", "claude")

    expect(after).toHaveLength(1)
    expect(after[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "Partial final answer.",
      metadata: { usage: { output_tokens: 3 } },
    }))
  })
})
