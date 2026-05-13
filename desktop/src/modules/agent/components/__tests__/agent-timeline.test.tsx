import type { ComponentProps } from "react"
import { createRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  appendAgentTimelineEvent,
  historyRecordToTimelineItem,
} from "@/lib/agent-timeline"
import type { SynapseAgentDisplayProfile, SynapseAgentTimelineItem } from "@/types/agent"
import { AgentTimeline } from "../agent-timeline"

const profile: SynapseAgentDisplayProfile = {
  agentLabel: "Codex",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "collapsed",
  toolPreviewLines: 6,
  toolPreviewChars: 20,
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
}

function renderTimeline(overrides: Partial<ComponentProps<typeof AgentTimeline>> = {}) {
  return renderToStaticMarkup(
    <AgentTimeline
      items={[]}
      profile={profile}
      sending={false}
      pendingPermissions={[]}
      onOpenReference={vi.fn()}
      onRespondPermission={vi.fn()}
      viewportRef={createRef<HTMLDivElement>()}
      showJumpToBottom={false}
      onJumpToBottom={vi.fn()}
      {...overrides}
    />,
  )
}

describe("AgentTimeline", () => {
  it("uses compact vertical spacing between timeline items", () => {
    const html = renderTimeline()
    expect(html).toContain("gap-2")
    expect(html).not.toContain("gap-5")
  })

  it("enables text selection on the content area", () => {
    const html = renderTimeline()
    expect(html).toContain('data-allow-select="true"')
  })

  it("does not render the jump-to-bottom pill when showJumpToBottom is false", () => {
    const html = renderTimeline({ showJumpToBottom: false })
    expect(html).not.toContain("↓ 新消息")
    expect(html).not.toContain("跳到最新消息")
  })

  it("renders the jump-to-bottom pill when showJumpToBottom is true", () => {
    const html = renderTimeline({ showJumpToBottom: true })
    expect(html).toContain("↓ 新消息")
    expect(html).toContain('aria-label="跳到最新消息"')
  })

  it("renders an AgentPhaseRow for phase items", () => {
    const items: SynapseAgentTimelineItem[] = [
      {
        id: "phase:received",
        kind: "phase",
        timestamp: "2026-05-10T00:00:00.000Z",
        runId: "run-1",
        phase: "received",
        status: "in-progress",
        startedAt: "2026-05-10T00:00:00.000Z",
      },
    ]
    const html = renderTimeline({ items })
    // AgentPhaseRow uses tabular-nums for elapsed time and aria-live for in-progress.
    expect(html).toContain("tabular-nums")
    expect(html).toContain('aria-live="polite"')
    // Legacy AgentRunStatus copy must not surface.
    expect(html).not.toContain("正在处理")
  })

  it("does not render the legacy 正在处理 spinner row even when sending=true", () => {
    const html = renderTimeline({ sending: true })
    expect(html).not.toContain("正在处理")
  })

  it("appends stream text to the current assistant message", () => {
    const first = appendAgentTimelineEvent([], {
      type: "stream",
      text: "hello",
    }, "2026-05-12T00:00:00.000Z", "claude")
    const second = appendAgentTimelineEvent(first, {
      type: "stream",
      text: " world",
    }, "2026-05-12T00:00:01.000Z", "claude")

    expect(second).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        content: "hello world",
      }),
    ])
  })

  it("appends SDK text deltas exactly without suffix dedupe", () => {
    const first = appendAgentTimelineEvent([], {
      type: "stream",
      blockIndex: 0,
      deltaType: "text_delta",
      text: "lo",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
    }, "2026-05-13T00:00:00.000Z", "claude")
    const second = appendAgentTimelineEvent(first, {
      type: "stream",
      blockIndex: 0,
      deltaType: "text_delta",
      text: "o",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "o" } },
    }, "2026-05-13T00:00:01.000Z", "claude")
    const third = appendAgentTimelineEvent(second, {
      type: "stream",
      blockIndex: 0,
      deltaType: "text_delta",
      text: " ",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " " } },
    }, "2026-05-13T00:00:02.000Z", "claude")

    expect(third.filter((item) => item.kind === "message" && item.role === "assistant")).toEqual([
      expect.objectContaining({ content: "loo " }),
    ])
  })

  it("appends thinking stream text to the current thinking block", () => {
    const first = appendAgentTimelineEvent([], {
      type: "stream",
      event: { delta: { thinking: "I" } },
    }, "2026-05-12T00:00:00.000Z", "claude")
    const second = appendAgentTimelineEvent(first, {
      type: "stream",
      event: { delta: { thinking: " respond" } },
    }, "2026-05-12T00:00:01.000Z", "claude")

    expect(second).toEqual([
      expect.objectContaining({
        kind: "thinking",
        content: "I respond",
      }),
    ])
  })

  it("appends SDK thinking deltas exactly into one thinking item", () => {
    const first = appendAgentTimelineEvent([], {
      type: "stream",
      blockIndex: 1,
      deltaType: "thinking_delta",
      thinking: "The user says ",
      event: { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "The user says " } },
    }, "2026-05-13T00:01:00.000Z", "claude")
    const second = appendAgentTimelineEvent(first, {
      type: "stream",
      blockIndex: 1,
      deltaType: "thinking_delta",
      thinking: "hello.",
      event: { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "hello." } },
    }, "2026-05-13T00:01:01.000Z", "claude")

    expect(second.filter((item) => item.kind === "thinking")).toEqual([
      expect.objectContaining({ content: "The user says hello." }),
    ])
  })

  it("renders assistant content blocks as text", () => {
    const items = appendAgentTimelineEvent([], {
      type: "assistant",
      contentBlocks: [
        { type: "text", text: "first" },
        { type: "text", text: " second" },
      ],
    }, "2026-05-12T00:00:00.000Z", "claude")

    const html = renderTimeline({ items })

    expect(html).toContain("first second")
  })

  it("dedupes assistant full text after matching stream chunks", () => {
    const streamed = appendAgentTimelineEvent([], {
      type: "stream",
      text: "hello",
    }, "2026-05-12T00:00:00.000Z", "claude")
    const reconciled = appendAgentTimelineEvent(streamed, {
      type: "assistant",
      contentBlocks: [{ type: "text", text: "hello" }],
    }, "2026-05-12T00:00:01.000Z", "claude")

    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "hello",
    }))
  })

  it("replaces streamed assistant draft with final assistant text across thinking blocks", () => {
    const streamed = appendAgentTimelineEvent([], {
      type: "stream",
      text: "你好有什么可以你的",
    }, "2026-05-12T00:00:00.000Z", "claude")
    const thinking = appendAgentTimelineEvent(streamed, {
      type: "stream",
      event: { delta: { thinking: "briefly" } },
    }, "2026-05-12T00:00:01.000Z", "claude")
    const reconciled = appendAgentTimelineEvent(thinking, {
      type: "assistant",
      contentBlocks: [{ type: "text", text: "你好！有什么可以帮助你的吗？" }],
    }, "2026-05-12T00:00:02.000Z", "claude")

    expect(reconciled.filter((item) => item.kind === "message" && item.role === "assistant")).toEqual([
      expect.objectContaining({
        content: "你好！有什么可以帮助你的吗？",
      }),
    ])
  })

  it("replaces streamed assistant draft with final assistant content across thinking items", () => {
    const streamed = appendAgentTimelineEvent([], {
      type: "stream",
      blockIndex: 0,
      deltaType: "text_delta",
      text: "你好可以你的?",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好可以你的?" } },
    }, "2026-05-13T00:02:00.000Z", "claude")
    const withThinking = appendAgentTimelineEvent(streamed, {
      type: "stream",
      blockIndex: 1,
      deltaType: "thinking_delta",
      thinking: "Respond naturally.",
      event: { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "Respond naturally." } },
    }, "2026-05-13T00:02:01.000Z", "claude")
    const final = appendAgentTimelineEvent(withThinking, {
      type: "assistant",
      contentBlocks: [
        { type: "thinking", thinking: "Respond naturally.", signature: "sig" },
        { type: "text", text: "你好！有什么可以帮助你的吗？" },
      ],
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Respond naturally.", signature: "sig" },
          { type: "text", text: "你好！有什么可以帮助你的吗？" },
        ],
      },
    }, "2026-05-13T00:02:02.000Z", "claude")

    expect(final.filter((item) => item.kind === "message" && item.role === "assistant")).toEqual([
      expect.objectContaining({ content: "你好！有什么可以帮助你的吗？" }),
    ])
  })

  it("replaces partial stream content with assistant full text", () => {
    const streamed = appendAgentTimelineEvent([], {
      type: "stream",
      text: "hello",
    }, "2026-05-12T00:00:00.000Z", "claude")
    const reconciled = appendAgentTimelineEvent(streamed, {
      type: "assistant",
      contentBlocks: [{ type: "text", text: "hello world" }],
    }, "2026-05-12T00:00:01.000Z", "claude")

    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "hello world",
    }))
  })

  it("keeps assistant text when result content is blank and preserves metadata", () => {
    const streamed = appendAgentTimelineEvent([], {
      type: "stream",
      text: "hello world",
    }, "2026-05-12T00:00:00.000Z", "claude")
    const reconciled = appendAgentTimelineEvent(streamed, {
      type: "result",
      content: "",
      done: true,
      metadata: {
        model: "claude-sonnet-4-5",
      },
    }, "2026-05-12T00:00:01.000Z", "claude")

    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "hello world",
      metadata: expect.objectContaining({
        model: "claude-sonnet-4-5",
      }),
    }))
  })

  it("merges matching result content into the latest assistant message across sdk events", () => {
    const withAssistant = appendAgentTimelineEvent([], {
      type: "assistant",
      contentBlocks: [{ type: "text", text: "hello world" }],
    }, "2026-05-12T00:00:00.000Z", "claude")
    const withSdkEvent = appendAgentTimelineEvent(withAssistant, {
      type: "sdkEvent",
      sdkType: "system",
      sdkSubtype: "notification",
      payload: {},
    }, "2026-05-12T00:00:01.000Z", "claude")
    const reconciled = appendAgentTimelineEvent(withSdkEvent, {
      type: "result",
      content: "hello world",
      done: true,
      metadata: {
        model: "claude-sonnet-4-5",
      },
    }, "2026-05-12T00:00:02.000Z", "claude")

    expect(reconciled.filter((item) => item.kind === "message" && item.role === "assistant")).toHaveLength(1)
    expect(reconciled[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "hello world",
      metadata: expect.objectContaining({
        model: "claude-sonnet-4-5",
      }),
    }))
  })

  it("treats result content as metadata when an assistant message already exists", () => {
    const withAssistant = appendAgentTimelineEvent([], {
      type: "assistant",
      contentBlocks: [{ type: "text", text: "final answer" }],
      message: { role: "assistant", content: [{ type: "text", text: "final answer" }] },
    }, "2026-05-13T00:03:00.000Z", "claude")
    const withResult = appendAgentTimelineEvent(withAssistant, {
      type: "result",
      content: "final answer",
      done: true,
      metadata: { model: "claude-sonnet-4-5" },
    }, "2026-05-13T00:03:01.000Z", "claude")

    expect(withResult.filter((item) => item.kind === "message" && item.role === "assistant")).toHaveLength(1)
    expect(withResult[0]).toEqual(expect.objectContaining({
      content: "final answer",
      metadata: expect.objectContaining({ model: "claude-sonnet-4-5" }),
    }))
  })

  it("extracts assistant text from nested message content arrays", () => {
    const items = appendAgentTimelineEvent([], {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "nested" },
          { type: "text", text: " content" },
        ],
      },
    }, "2026-05-12T00:00:00.000Z", "claude")

    expect(items[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "nested content",
    }))
  })

  it("renders sdk events as compact generic rows", () => {
    const items = appendAgentTimelineEvent([], {
      type: "sdkEvent",
      sdkType: "system",
      sdkSubtype: "init",
      payload: { cwd: "/tmp/project" },
    }, "2026-05-12T00:00:00.000Z", "claude")

    const html = renderTimeline({ items })

    expect(html).toContain("SDK event")
    expect(html).toContain("system")
    expect(html).toContain("init")
  })

  it("preserves result model, usage, and cost metadata", () => {
    const items = appendAgentTimelineEvent([], {
      type: "result",
      content: "done",
      done: true,
      metadata: {
        model: "claude-sonnet-4-5",
        usage: { inputTokens: 10, outputTokens: 5 },
        costUsd: 0.05,
      },
    }, "2026-05-12T00:00:00.000Z", "claude")

    expect(items[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "done",
      metadata: expect.objectContaining({
        model: "claude-sonnet-4-5",
        usage: { inputTokens: 10, outputTokens: 5 },
        costUsd: 0.05,
      }),
    }))
  })

  it("preserves top-level result usage and cost metadata", () => {
    const items = appendAgentTimelineEvent([], {
      type: "result",
      content: "done",
      done: true,
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0.05,
    }, "2026-05-12T00:00:00.000Z", "claude")

    expect(items[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      metadata: expect.objectContaining({
        usage: { inputTokens: 10, outputTokens: 5 },
        costUsd: 0.05,
      }),
    }))
  })

  it("does not render sdk event payload values", () => {
    const items = appendAgentTimelineEvent([], {
      type: "sdkEvent",
      sdkType: "system",
      payload: {
        token: "secret-token-value",
        large: "x".repeat(500),
      },
    }, "2026-05-12T00:00:00.000Z", "claude")

    const html = renderTimeline({ items })

    expect(html).toContain("SDK event")
    expect(html).toContain("system")
    expect(html).not.toContain("secret-token-value")
    expect(html).not.toContain("xxxxxxxxxxxxxxxxxxxx")
  })

  it("keeps SDK thinking stream out of assistant answer text", () => {
    const thinking = appendAgentTimelineEvent([], {
      type: "stream",
      event: {
        delta: {
          thinking: "private chain of thought",
        },
      },
    }, "2026-05-12T00:00:00.000Z", "claude")
    const final = appendAgentTimelineEvent(thinking, {
      type: "assistant",
      contentBlocks: [{ type: "text", text: "final answer" }],
    }, "2026-05-12T00:00:01.000Z", "claude")

    expect(final).toHaveLength(2)
    expect(final[0]).toEqual(expect.objectContaining({
      kind: "thinking",
      content: "private chain of thought",
    }))
    expect(final.filter((item) => item.kind === "message" && item.role === "assistant")).toEqual([
      expect.objectContaining({
        content: "final answer",
      }),
    ])
  })

  it("preserves sdkSessionId from history metadata", () => {
    const item = historyRecordToTimelineItem("session-1", {
      role: "assistant",
      content: "done",
      timestamp: "2026-05-12T00:00:00.000Z",
      metadata: {
        sdkSessionId: "sdk-1",
        agentSessionId: "agent-1",
        threadId: "thread-1",
      },
    }, 0, "claude")

    expect(item).toEqual(expect.objectContaining({
      sdkSessionId: "sdk-1",
      agentSessionId: "agent-1",
      threadId: "thread-1",
    }))
  })
})
