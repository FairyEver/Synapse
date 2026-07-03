/**
 * @vitest-environment jsdom
 */
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
import {
  defaultProcessGroupOpen,
  groupTimelineDisplayEntries,
  timelineDisplayEntries,
} from "../agent-timeline-display"

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  debounce: <Args extends unknown[]>(fn: (...args: Args) => void) => fn,
  extractLabel: () => "button",
  track,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
      {...overrides}
    />,
  )
}

function textFromMarkup(html: string): string {
  const container = document.createElement("div")
  container.innerHTML = html
  return container.textContent ?? ""
}

describe("AgentTimeline", () => {
  it("uses compact vertical spacing between timeline items", () => {
    const html = renderTimeline({
      items: [{
        id: "message-1",
        kind: "message",
        role: "assistant",
        content: "hello",
        timestamp: "2026-05-10T00:00:00.000Z",
      }],
    })
    expect(html).toContain("gap-2")
    expect(html).not.toContain("gap-5")
  })

  it("enables text selection on the content area", () => {
    const html = renderTimeline()
    expect(html).toContain('data-allow-select="true"')
  })

  it("uses a native scrolling viewport for the timeline", () => {
    const html = renderTimeline()
    expect(html).toContain("overflow-y-auto")
    expect(html).not.toContain('data-slot="scroll-area"')
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

  it("renders tool input progress without exposing partial JSON", () => {
    const items: SynapseAgentTimelineItem[] = [
      {
        id: "progress:write",
        kind: "toolProgress",
        timestamp: "2026-05-10T00:00:00.000Z",
        toolName: "Write",
        toolUseId: "toolu-write",
        blockIndex: 1,
        inputCharCount: 40 * 1024,
        status: "preparing",
      },
    ]
    const text = textFromMarkup(renderTimeline({ items }))

    expect(text).toContain("正在准备 Write")
    expect(text).toContain("40 KB")
    expect(text).not.toContain("partial_json")
    expect(text).not.toContain("content")
  })

  it("does not render the legacy 正在处理 spinner row even when sending=true", () => {
    const html = renderTimeline({ sending: true })
    expect(html).not.toContain("正在处理")
  })

  it("shows a pending status while sending before the first timeline event", () => {
    const html = renderTimeline({ sending: true })
    expect(html).toContain("Agent 正在启动")
    expect(html).not.toContain("暂无消息")
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

  it("keeps streamed text after tool use in timeline order", () => {
    const beforeTool = appendAgentTimelineEvent([], {
      type: "stream",
      text: "I'll inspect it.",
    }, "2026-05-13T00:00:00.000Z", "claude")
    const withTool = appendAgentTimelineEvent(beforeTool, {
      type: "toolUse",
      toolName: "Read",
      toolInput: "package.json",
    }, "2026-05-13T00:00:01.000Z", "claude")
    const afterTool = appendAgentTimelineEvent(withTool, {
      type: "stream",
      text: "The package uses pnpm.",
    }, "2026-05-13T00:00:02.000Z", "claude")

    expect(afterTool.map((item) => item.kind)).toEqual(["message", "toolCall", "message"])
    expect(afterTool[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "I'll inspect it.",
    }))
    expect(afterTool[2]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "The package uses pnpm.",
    }))
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

  it("renders native slash passthrough events as compact annotations", () => {
    const items = appendAgentTimelineEvent([], {
      type: "sdkEvent",
      sdkType: "nativeSlashPassthrough",
      sdkSubtype: "/wiki-ingest",
      payload: { command: "/wiki-ingest" },
    }, "2026-05-31T00:00:00.000Z", "claude")

    const html = renderTimeline({ items })

    expect(html).toContain("Native slash")
    expect(html).toContain("/wiki-ingest")
    expect(html).not.toContain("ingest all")
  })

  it("renders a completed tool call as one row with the matching result", () => {
    const items: SynapseAgentTimelineItem[] = [
      {
        id: "tool-call-1",
        kind: "toolCall",
        toolUseId: "toolu-glob-1",
        toolName: "Glob",
        toolInputRaw: { path: "/Users/liyang/project", pattern: "wiki/**/*frontend*" },
        timestamp: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "tool-result-1",
        kind: "toolResult",
        toolUseId: "toolu-glob-1",
        toolName: "Glob",
        content: "No files found",
        status: "success",
        success: true,
        timestamp: "2026-06-04T00:00:01.000Z",
      },
    ]

    const html = renderTimeline({
      items,
      profile: { ...profile, toolDefaultCollapsed: "expanded", toolPreviewChars: 1200 },
    })
    const text = textFromMarkup(html)

    expect(html.match(/Glob/g)).toHaveLength(1)
    expect(html).toContain("Done")
    expect(html).not.toContain("Running")
    expect(text).toContain("已处理1s")
    expect(text).not.toContain("过程详情")
    expect(text).toContain("GlobDone")
    expect(html).toContain("data-state=\"closed\"")
  })

  it("prepares completed tool calls as one display entry", () => {
    const items: SynapseAgentTimelineItem[] = [
      {
        id: "tool-call",
        kind: "toolCall",
        toolUseId: "toolu-1",
        toolName: "Read",
        toolInputRaw: { file_path: "/tmp/package.json" },
        timestamp: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "tool-result",
        kind: "toolResult",
        toolUseId: "toolu-1",
        toolName: "Read",
        content: "package contents",
        success: true,
        timestamp: "2026-06-27T00:00:01.000Z",
      },
    ]

    expect(timelineDisplayEntries(items)).toEqual([
      {
        item: expect.objectContaining({ id: "tool-call" }),
        result: expect.objectContaining({ id: "tool-result" }),
      },
    ])
  })

  it("groups process entries before an assistant message", () => {
    const entries = timelineDisplayEntries([
      {
        id: "thinking-1",
        kind: "thinking",
        content: "inspect",
        timestamp: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "tool-call-1",
        kind: "toolCall",
        toolName: "Read",
        toolInput: "package.json",
        timestamp: "2026-06-27T00:00:01.000Z",
      },
      {
        id: "answer-1",
        kind: "message",
        role: "assistant",
        content: "Answer",
        timestamp: "2026-06-27T00:00:02.000Z",
      },
    ])

    const nodes = groupTimelineDisplayEntries(entries, {
      pendingPermissionRequestIds: new Set(),
      nowMs: Date.parse("2026-06-27T00:00:01.000Z"),
    })

    expect(nodes.map((node) => node.kind)).toEqual(["processGroup", "item"])
    expect(nodes[0]).toEqual(expect.objectContaining({
      kind: "processGroup",
      itemCount: 2,
      summary: "处理中 1s",
      label: "处理中",
      durationLabel: "1s",
    }))
    expect(nodes[1]).toEqual(expect.objectContaining({
      kind: "item",
      entry: expect.objectContaining({
        item: expect.objectContaining({ id: "answer-1" }),
      }),
    }))
  })

  it("creates separate process groups between multiple assistant messages", () => {
    const entries = timelineDisplayEntries([
      {
        id: "answer-a",
        kind: "message",
        role: "assistant",
        content: "A",
        timestamp: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "thinking-b",
        kind: "thinking",
        content: "B process",
        timestamp: "2026-06-27T00:00:01.000Z",
      },
      {
        id: "answer-b",
        kind: "message",
        role: "assistant",
        content: "B",
        timestamp: "2026-06-27T00:00:02.000Z",
      },
      {
        id: "tool-c",
        kind: "toolCall",
        toolName: "Bash",
        toolInput: "pnpm test",
        timestamp: "2026-06-27T00:00:03.000Z",
      },
      {
        id: "answer-c",
        kind: "message",
        role: "assistant",
        content: "C",
        timestamp: "2026-06-27T00:00:04.000Z",
      },
    ])

    const nodes = groupTimelineDisplayEntries(entries, {
      pendingPermissionRequestIds: new Set(),
    })

    expect(nodes.map((node) => node.kind)).toEqual([
      "item",
      "processGroup",
      "item",
      "processGroup",
      "item",
    ])
    expect(nodes.filter((node) => node.kind === "item").map((node) => node.entry.item.id)).toEqual([
      "answer-a",
      "answer-b",
      "answer-c",
    ])
  })

  it("keeps pending permissions outside process groups", () => {
    const entries = timelineDisplayEntries([
      {
        id: "permission-live",
        kind: "permissionRequest",
        requestId: "request-1",
        toolName: "Bash",
        toolInput: "rm file",
        timestamp: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "answer",
        kind: "message",
        role: "assistant",
        content: "Waiting",
        timestamp: "2026-06-27T00:00:01.000Z",
      },
    ])

    const nodes = groupTimelineDisplayEntries(entries, {
      pendingPermissionRequestIds: new Set(["request-1"]),
    })

    expect(nodes.map((node) => node.kind)).toEqual(["item", "item"])
    expect(nodes[0]).toEqual(expect.objectContaining({
      kind: "item",
      entry: expect.objectContaining({
        item: expect.objectContaining({ id: "permission-live" }),
      }),
    }))
  })

  it("collapses successful completed process groups by default", () => {
    const nodes = groupTimelineDisplayEntries(timelineDisplayEntries([
      {
        id: "tool-call",
        kind: "toolCall",
        toolUseId: "toolu-ok",
        toolName: "Read",
        toolInput: "package.json",
        timestamp: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "tool-result",
        kind: "toolResult",
        toolUseId: "toolu-ok",
        toolName: "Read",
        content: "ok",
        success: true,
        timestamp: "2026-06-27T00:00:01.000Z",
      },
    ]), { pendingPermissionRequestIds: new Set() })

    const group = nodes.find((node) => node.kind === "processGroup")
    expect(group?.kind).toBe("processGroup")
    expect(group?.kind === "processGroup" ? defaultProcessGroupOpen(group, { sending: false }) : true).toBe(false)
  })

  it("keeps completed image artifact tool results outside collapsed process groups", () => {
    const nodes = groupTimelineDisplayEntries(timelineDisplayEntries([
      {
        id: "tool-call",
        kind: "toolCall",
        toolUseId: "toolu-image",
        toolName: "Read",
        toolInput: "diagram.png",
        timestamp: "2026-07-03T00:00:00.000Z",
      },
      {
        id: "tool-result",
        kind: "toolResult",
        toolUseId: "toolu-image",
        toolName: "Read",
        imageArtifacts: [{
          id: "artifact-image",
          kind: "image",
          mimeType: "image/png",
          byteSize: 4,
          url: "/tmp/artifact-image.png",
        }],
        success: true,
        timestamp: "2026-07-03T00:00:01.000Z",
      },
    ]), { pendingPermissionRequestIds: new Set() })

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toEqual(expect.objectContaining({
      kind: "item",
      entry: expect.objectContaining({
        item: expect.objectContaining({ id: "tool-call" }),
        result: expect.objectContaining({
          id: "tool-result",
          imageArtifacts: [expect.objectContaining({ id: "artifact-image" })],
        }),
      }),
    }))
  })

  it("opens active process groups and collapses failed completed process groups by default", () => {
    const nodes = groupTimelineDisplayEntries(timelineDisplayEntries([
      {
        id: "tool-call",
        kind: "toolCall",
        toolUseId: "toolu-failed",
        toolName: "Bash",
        toolInput: "pnpm test",
        timestamp: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "tool-result",
        kind: "toolResult",
        toolUseId: "toolu-failed",
        toolName: "Bash",
        content: "failed",
        success: false,
        timestamp: "2026-06-27T00:00:01.000Z",
      },
    ]), { pendingPermissionRequestIds: new Set() })
    const failedGroup = nodes.find((node) => node.kind === "processGroup")

    const activeNodes = groupTimelineDisplayEntries(timelineDisplayEntries([
      {
        id: "tool-running",
        kind: "toolCall",
        toolName: "Bash",
        toolInput: "pnpm test",
        timestamp: "2026-06-27T00:00:02.000Z",
      },
    ]), { pendingPermissionRequestIds: new Set() })
    const activeGroup = activeNodes.find((node) => node.kind === "processGroup")

    expect(failedGroup?.kind === "processGroup" ? defaultProcessGroupOpen(failedGroup, { sending: false }) : true).toBe(false)
    expect(activeGroup?.kind === "processGroup" ? defaultProcessGroupOpen(activeGroup, { sending: false }) : false).toBe(true)
    expect(activeGroup?.kind === "processGroup" ? defaultProcessGroupOpen(activeGroup, { sending: true }) : false).toBe(true)
  })

  it("summarizes active and pending process groups with Codex-style labels", () => {
    const activeNodes = groupTimelineDisplayEntries(timelineDisplayEntries([
      {
        id: "tool-running",
        kind: "toolCall",
        toolName: "Bash",
        toolInput: "pnpm test",
        timestamp: "2026-06-27T00:00:02.000Z",
      },
    ]), {
      pendingPermissionRequestIds: new Set(),
      nowMs: Date.parse("2026-06-27T00:00:14.000Z"),
    })
    const pendingNodes = groupTimelineDisplayEntries(timelineDisplayEntries([
      {
        id: "permission-old",
        kind: "permissionRequest",
        requestId: "request-old",
        toolName: "Bash",
        toolInput: "rm file",
        timestamp: "2026-06-27T00:00:03.000Z",
      },
    ]), {
      pendingPermissionRequestIds: new Set(),
      nowMs: Date.parse("2026-06-27T00:00:15.000Z"),
    })

    const activeGroup = activeNodes.find((node) => node.kind === "processGroup")
    const pendingGroup = pendingNodes.find((node) => node.kind === "processGroup")

    expect(activeGroup).toEqual(expect.objectContaining({
      kind: "processGroup",
      label: "处理中",
      durationLabel: "12s",
      summary: "处理中 12s",
    }))
    expect(pendingGroup).toEqual(expect.objectContaining({
      kind: "processGroup",
      label: "等待处理",
      durationLabel: "12s",
      summary: "等待处理 12s",
    }))
  })

  it("uses the thinking start time for completed thinking-only process duration", () => {
    const nodes = groupTimelineDisplayEntries(timelineDisplayEntries([
      {
        id: "thinking-stream",
        kind: "thinking",
        content: "Inspect carefully.",
        startedAt: "2026-06-29T00:00:00.000Z",
        timestamp: "2026-06-29T00:00:08.000Z",
      } as SynapseAgentTimelineItem,
    ]), {
      pendingPermissionRequestIds: new Set(),
      nowMs: Date.parse("2026-06-29T00:00:30.000Z"),
    })

    const group = nodes.find((node) => node.kind === "processGroup")

    expect(group).toEqual(expect.objectContaining({
      kind: "processGroup",
      label: "已处理",
      durationLabel: "8s",
      summary: "已处理 8s",
      state: expect.objectContaining({ active: false }),
    }))
  })

  it("keeps the progress start time after a tool call completes", () => {
    const progress = appendAgentTimelineEvent([], {
      type: "stream",
      blockIndex: 1,
      toolUseId: "toolu-read",
      toolName: "Read",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu-read", name: "Read" },
      },
    }, "2026-06-27T00:00:00.000Z", "claude")
    const withTool = appendAgentTimelineEvent(progress, {
      type: "toolUse",
      toolUseId: "toolu-read",
      toolName: "Read",
      toolInput: "package.json",
    }, "2026-06-27T00:00:05.000Z", "claude")
    const withResult = appendAgentTimelineEvent(withTool, {
      type: "toolResult",
      toolUseId: "toolu-read",
      toolName: "Read",
      content: "ok",
      success: true,
    }, "2026-06-27T00:00:05.200Z", "claude")
    const items = appendAgentTimelineEvent(withResult, {
      type: "assistant",
      content: "Done.",
    }, "2026-06-27T00:00:05.300Z", "claude")

    const nodes = groupTimelineDisplayEntries(timelineDisplayEntries(items), {
      pendingPermissionRequestIds: new Set(),
      nowMs: Date.parse("2026-06-27T00:00:30.000Z"),
    })
    const group = nodes.find((node) => node.kind === "processGroup")

    expect(group).toEqual(expect.objectContaining({
      kind: "processGroup",
      label: "已处理",
      durationLabel: "5s",
      summary: "已处理 5s",
      state: expect.objectContaining({ active: false }),
    }))
  })

  it("freezes stopped tool progress duration instead of continuing to count", () => {
    const progress = appendAgentTimelineEvent([], {
      type: "stream",
      blockIndex: 1,
      toolUseId: "toolu-read",
      toolName: "Read",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu-read", name: "Read" },
      },
    }, "2026-06-27T00:00:00.000Z", "claude")
    const stopped = appendAgentTimelineEvent(progress, {
      type: "stream",
      blockIndex: 1,
      toolUseId: "toolu-read",
      event: {
        type: "content_block_stop",
        index: 1,
      },
    }, "2026-06-27T00:00:05.000Z", "claude")

    const nodes = groupTimelineDisplayEntries(timelineDisplayEntries(stopped), {
      pendingPermissionRequestIds: new Set(),
      nowMs: Date.parse("2026-06-27T00:00:30.000Z"),
    })
    const group = nodes.find((node) => node.kind === "processGroup")

    expect(group).toEqual(expect.objectContaining({
      kind: "processGroup",
      label: "已处理",
      durationLabel: "5s",
      summary: "已处理 5s",
      state: expect.objectContaining({ active: false }),
    }))
  })

  it("omits malformed process group durations instead of rendering NaN", () => {
    const nodes = groupTimelineDisplayEntries(timelineDisplayEntries([
      {
        id: "thinking-bad-time",
        kind: "thinking",
        content: "inspect",
        timestamp: "not-a-date",
      },
    ]), {
      pendingPermissionRequestIds: new Set(),
      nowMs: Date.parse("2026-06-27T00:00:15.000Z"),
    })
    const group = nodes.find((node) => node.kind === "processGroup")

    expect(group).toEqual(expect.objectContaining({
      kind: "processGroup",
      label: "已处理",
      summary: "已处理",
    }))
    expect(group?.kind === "processGroup" ? group.durationLabel : undefined).toBeUndefined()
    expect(group?.kind === "processGroup" ? group.summary : "").not.toContain("NaN")
  })

  it("renders successful process groups collapsed with a compact title", () => {
    const html = renderTimeline({
      items: [
        {
          id: "tool-call",
          kind: "toolCall",
          toolUseId: "toolu-ok",
          toolName: "Read",
          toolInput: "package.json",
          timestamp: "2026-06-27T00:00:00.000Z",
        },
        {
          id: "tool-result",
          kind: "toolResult",
          toolUseId: "toolu-ok",
          toolName: "Read",
          content: "package contents",
          success: true,
          timestamp: "2026-06-27T00:00:01.000Z",
        },
        {
          id: "answer",
          kind: "message",
          role: "assistant",
          content: "Done",
          timestamp: "2026-06-27T00:00:02.000Z",
        },
      ],
    })
    const text = textFromMarkup(html)

    expect(html).toContain("已处理")
    expect(html).toContain("1s")
    expect(html).toContain("lucide-chevron-down")
    expect(html).not.toContain("过程详情")
    expect(html).toContain('data-state="closed"')
    expect(text).toContain("Done")
    expect(text).not.toContain("package contents")
  })

  it("collapses failed completed process groups by default while keeping the handled summary visible", () => {
    const html = renderTimeline({
      items: [
        {
          id: "tool-call",
          kind: "toolCall",
          toolUseId: "toolu-fail",
          toolName: "Bash",
          toolInput: "pnpm test",
          timestamp: "2026-06-27T00:00:00.000Z",
        },
        {
          id: "tool-result",
          kind: "toolResult",
          toolUseId: "toolu-fail",
          toolName: "Bash",
          content: "failed",
          success: false,
          timestamp: "2026-06-27T00:00:01.000Z",
        },
        {
          id: "answer",
          kind: "message",
          role: "assistant",
          content: "I found a failure.",
          timestamp: "2026-06-27T00:00:02.000Z",
        },
      ],
    })
    const text = textFromMarkup(html)

    expect(html).toContain('data-state="closed"')
    expect(text).toContain("已处理1s")
    expect(text).not.toContain("过程详情")
    expect(text).not.toContain("1 个工具失败")
    expect(text).toContain("I found a failure.")
    expect(text).not.toContain("pnpm test")
  })

  it("keeps pending permission requests visible outside process groups", () => {
    const html = renderTimeline({
      items: [
        {
          id: "permission",
          kind: "permissionRequest",
          requestId: "request-1",
          toolName: "Bash",
          toolInput: "rm file",
          timestamp: "2026-06-27T00:00:00.000Z",
        },
        {
          id: "answer",
          kind: "message",
          role: "assistant",
          content: "Waiting for permission.",
          timestamp: "2026-06-27T00:00:01.000Z",
        },
      ],
      pendingPermissions: [{
        requestId: "request-1",
        projectId: "project-1",
        sessionKey: "local:renderer",
        conversationId: "conversation-1",
        toolName: "Bash",
        toolInput: "rm file",
        createdAt: "2026-06-27T00:00:00.000Z",
      }],
    })
    const text = textFromMarkup(html)

    expect(text).toContain("rm file")
    expect(text).toContain("Waiting for permission.")
    expect(text).not.toContain("过程详情")
  })

  it("keeps multiple assistant answers visible between process groups", () => {
    const html = renderTimeline({
      items: [
        {
          id: "answer-a",
          kind: "message",
          role: "assistant",
          content: "First answer.",
          timestamp: "2026-06-27T00:00:00.000Z",
        },
        {
          id: "thinking-b",
          kind: "thinking",
          content: "Inspecting.",
          timestamp: "2026-06-27T00:00:01.000Z",
        },
        {
          id: "tool-b",
          kind: "toolCall",
          toolUseId: "toolu-b",
          toolName: "Read",
          toolInput: "package.json",
          timestamp: "2026-06-27T00:00:02.000Z",
        },
        {
          id: "tool-b-result",
          kind: "toolResult",
          toolUseId: "toolu-b",
          toolName: "Read",
          content: "package contents",
          success: true,
          timestamp: "2026-06-27T00:00:03.000Z",
        },
        {
          id: "answer-b",
          kind: "message",
          role: "assistant",
          content: "Second answer.",
          timestamp: "2026-06-27T00:00:04.000Z",
        },
        {
          id: "thinking-c",
          kind: "thinking",
          content: "Checking tests.",
          timestamp: "2026-06-27T00:00:05.000Z",
        },
        {
          id: "answer-c",
          kind: "message",
          role: "assistant",
          content: "Third answer.",
          timestamp: "2026-06-27T00:00:06.000Z",
        },
      ],
    })
    const text = textFromMarkup(html)

    expect(text).toContain("First answer.")
    expect(text).toContain("Second answer.")
    expect(text).toContain("Third answer.")
    expect(text.indexOf("First answer.")).toBeLessThan(text.indexOf("已处理"))
    expect(text.indexOf("已处理")).toBeLessThan(text.indexOf("Second answer."))
    expect(html.match(/已处理/g)).toHaveLength(2)
    expect(html).not.toContain("过程详情")
    expect(text).not.toContain("package contents")
  })

  it("keeps result text visible after a tool boundary while grouping the tool", () => {
    const streamed = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "text_delta",
      text: "I will inspect it.",
    }, "2026-06-27T00:00:00.000Z", "claude")
    const withTool = appendAgentTimelineEvent(streamed, {
      type: "toolResult",
      toolName: "Read",
      content: "package contents",
      success: true,
    }, "2026-06-27T00:00:01.000Z", "claude")
    const items = appendAgentTimelineEvent(withTool, {
      type: "result",
      content: "Final answer.",
      done: true,
    }, "2026-06-27T00:00:02.000Z", "claude")

    const html = renderTimeline({ items })
    const text = textFromMarkup(html)

    expect(text).toContain("I will inspect it.")
    expect(text).toContain("Final answer.")
    expect(text.indexOf("I will inspect it.")).toBeLessThan(text.indexOf("已处理"))
    expect(text.indexOf("已处理")).toBeLessThan(text.indexOf("Final answer."))
    expect(html).not.toContain("过程详情")
    expect(text).not.toContain("package contents")
  })

  it("matches concurrent same-name tool results by tool use id", () => {
    const items: SynapseAgentTimelineItem[] = [
      {
        id: "tool-call-a",
        kind: "toolCall",
        toolUseId: "toolu-glob-a",
        toolName: "Glob",
        toolInputRaw: { path: "/Users/liyang/project/a.md" },
        timestamp: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "tool-call-b",
        kind: "toolCall",
        toolUseId: "toolu-glob-b",
        toolName: "Glob",
        toolInputRaw: { path: "/Users/liyang/project/b.md" },
        timestamp: "2026-06-04T00:00:01.000Z",
      },
      {
        id: "tool-result-b",
        kind: "toolResult",
        toolUseId: "toolu-glob-b",
        toolName: "Glob",
        content: "content b",
        status: "error",
        success: false,
        timestamp: "2026-06-04T00:00:02.000Z",
      },
      {
        id: "tool-result-a",
        kind: "toolResult",
        toolUseId: "toolu-glob-a",
        toolName: "Glob",
        content: "content a",
        status: "error",
        success: false,
        timestamp: "2026-06-04T00:00:03.000Z",
      },
    ]

    const entries = timelineDisplayEntries(items)

    expect(entries.map((entry) => [entry.item.id, entry.result?.id])).toEqual([
      ["tool-call-a", "tool-result-a"],
      ["tool-call-b", "tool-result-b"],
    ])
  })

  it("shows failed and denied statuses on matched tool calls", () => {
    const items: SynapseAgentTimelineItem[] = [
      {
        id: "tool-call-failed",
        kind: "toolCall",
        toolUseId: "toolu-failed",
        toolName: "Bash",
        toolInput: "pnpm test",
        timestamp: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "tool-result-failed",
        kind: "toolResult",
        toolUseId: "toolu-failed",
        toolName: "Bash",
        content: "failed",
        status: "error",
        success: false,
        timestamp: "2026-06-04T00:00:01.000Z",
      },
      {
        id: "tool-call-denied",
        kind: "toolCall",
        toolUseId: "toolu-denied",
        toolName: "Write",
        toolInputRaw: { file_path: "/Users/liyang/project/file.ts" },
        timestamp: "2026-06-04T00:00:02.000Z",
      },
      {
        id: "tool-result-denied",
        kind: "toolResult",
        toolUseId: "toolu-denied",
        toolName: "Write",
        content: "permission denied",
        status: "denied",
        timestamp: "2026-06-04T00:00:03.000Z",
      },
    ]

    const html = renderTimeline({
      items,
      profile: { ...profile, toolDefaultCollapsed: "expanded", toolPreviewChars: 1200 },
    })

    expect(html).toContain("Failed")
    expect(html).toContain("Denied")
    expect(html).not.toContain("Running")
  })

  it("keeps legacy same-name result fallback only for unidentified tools", () => {
    const items: SynapseAgentTimelineItem[] = [
      {
        id: "legacy-tool",
        kind: "toolCall",
        toolName: "Read",
        toolInputRaw: { file_path: "/Users/liyang/project/legacy.md" },
        timestamp: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "legacy-result",
        kind: "toolResult",
        toolName: "Read",
        content: "legacy content",
        status: "error",
        success: false,
        timestamp: "2026-06-04T00:00:01.000Z",
      },
      {
        id: "identified-tool",
        kind: "toolCall",
        toolName: "Read",
        toolInputRaw: { file_path: "/Users/liyang/project/identified.md" },
        timestamp: "2026-06-04T00:00:02.000Z",
      },
      {
        id: "identified-result",
        kind: "toolResult",
        toolUseId: "toolu-identified",
        toolName: "Read",
        content: "identified content",
        status: "error",
        success: false,
        timestamp: "2026-06-04T00:00:03.000Z",
      },
    ]

    const entries = timelineDisplayEntries(items)

    expect(entries.map((entry) => [entry.item.id, entry.result?.id])).toEqual([
      ["legacy-tool", "legacy-result"],
      ["identified-tool", undefined],
      ["identified-result", undefined],
    ])
  })

  it("hides generic SDK status events from the conversation timeline", () => {
    const items = appendAgentTimelineEvent([], {
      type: "status",
      status: "requesting",
    }, "2026-06-04T00:00:00.000Z", "claude")

    const html = renderTimeline({ items })

    expect(html).not.toContain("SDK event")
    expect(html).not.toContain("status")
    expect(html).not.toContain("requesting")
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
