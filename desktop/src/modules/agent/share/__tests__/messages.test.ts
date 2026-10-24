import { describe, expect, it, vi } from "vitest"
import type { SynapseAgentMessageTimelineItem, SynapseAgentTimelineItem } from "@/types/agent"
import { loadShareContent, loadShareHistory, selectShareRange, shareMessageRounds, shareMessages } from "../messages"

const target = { projectId: "p", conversationId: "c", sessionKey: "s" }
function message(id: number, role: "user" | "assistant" = id % 2 ? "user" : "assistant"): SynapseAgentMessageTimelineItem {
  return { kind: "message", id: `m${id}`, role, content: `content-${id}`, historyIndex: id - 1, timestamp: "2026-10-24T00:00:00Z" }
}

describe("conversation share snapshots", () => {
  it("includes image-only user messages and freezes their image attachments", () => {
    const input: SynapseAgentMessageTimelineItem = { ...message(1), content: "", attachments: [{ kind: "image", id: "photo", mimeType: "image/png", byteSize: 4, url: "synapse-agent-artifact://local/p/s/photo.png" }] }
    const result = shareMessages([input], false)
    expect(result).toHaveLength(1)
    expect(result[0]?.attachments).toEqual(input.attachments)
    expect(result[0]?.attachments).not.toBe(input.attachments)
    expect(shareMessages([{ ...input, attachments: [{ kind: "path", path: "/private/report.pdf", name: "report.pdf", entryType: "file" }] }], false)).toHaveLength(0)
  })
  it("only selects completed mainline questions and final replies, excluding tools and intermediate reasoning", () => {
    const items: SynapseAgentTimelineItem[] = [message(1), message(2), { kind: "toolCall", id: "tool", toolName: "Read", timestamp: "" }, message(4)]
    expect(shareMessages(items, false).map((item) => item.id)).toEqual(["m1", "m4"])
    expect(shareMessages([message(1), { ...message(2), streaming: true }], true).map((item) => item.id)).toEqual(["m1"])
  })

  it("selects ranges in original order and derives rounds independently of selected roles", () => {
    const items = shareMessages([1, 2, 3, 4].map((id) => message(id)), false)
    const selection = selectShareRange(items, new Set(["m4"]), "m3", "m1", true)
    expect([...selection]).toEqual(["m4", "m1", "m2", "m3"])
    expect([...selectShareRange(items, selection, "m2", "m1", false)]).toEqual(["m4", "m3"])
    expect(shareMessageRounds(items)).toEqual([["m1", "m2"], ["m3", "m4"]])
  })

  it("loads every bounded history page without including subsequently appended messages", async () => {
    const getTimeline = vi.fn().mockResolvedValueOnce({ ...target, entries: [message(3), message(4)], total: 4, startIndex: 2, hasMore: true })
      .mockResolvedValueOnce({ ...target, entries: [message(1), message(2)], total: 6, startIndex: 0, hasMore: false })
    const result = await loadShareHistory({ getTimeline }, target, new AbortController().signal)
    expect(result.map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4"])
    expect(getTimeline).toHaveBeenLastCalledWith({ ...target, limit: 100, beforeIndex: 2 })
  })

  it("rejects nonadvancing history, wrong conversations and aborted requests", async () => {
    const getTimeline = vi.fn().mockResolvedValue({ ...target, entries: [message(3)], total: 4, startIndex: 2, hasMore: true })
    await expect(loadShareHistory({ getTimeline }, target, new AbortController().signal)).rejects.toThrow("游标")
    getTimeline.mockResolvedValue({ ...target, conversationId: "other", entries: [], startIndex: 0, hasMore: false })
    await expect(loadShareHistory({ getTimeline }, target, new AbortController().signal)).rejects.toThrow("对话")
    const controller = new AbortController(); controller.abort()
    await expect(loadShareHistory({ getTimeline }, target, controller.signal)).rejects.toThrow()
  })

  it("loads the complete selected text and preserves source messages", async () => {
    const input = { ...message(2), content: "long", contentTruncated: true }
    const getTimelineContentChunk = vi.fn().mockResolvedValueOnce({ conversationId: "c", historyIndex: 1, content: "long", nextOffset: 4, done: false })
      .mockResolvedValueOnce({ conversationId: "c", historyIndex: 1, content: " reply", nextOffset: 10, done: true })
    const full = await loadShareContent({ getTimelineContentChunk }, target, shareMessages([input], false), new AbortController().signal)
    expect(full[0]).toMatchObject({ content: "long reply", contentTruncated: false })
    expect(input.content).toBe("long")
    expect(getTimelineContentChunk).toHaveBeenLastCalledWith({ projectId: "p", conversationId: "c", historyIndex: 1, offset: 4, maxBytes: 65536 })
  })

  it("refuses truncated content without an index and chunks with invalid cursors", async () => {
    const getTimelineContentChunk = vi.fn().mockResolvedValue({ conversationId: "c", historyIndex: 1, content: "x", nextOffset: 0, done: false })
    await expect(loadShareContent({ getTimelineContentChunk }, target, shareMessages([{ ...message(2), contentTruncated: true }], false), new AbortController().signal)).rejects.toThrow("游标")
    await expect(loadShareContent({ getTimelineContentChunk }, target, shareMessages([{ ...message(2), historyIndex: undefined, contentTruncated: true }], false), new AbortController().signal)).rejects.toThrow("完整")
  })

  it("rejects rewritten history instead of exporting different text at the same index", async () => {
    const getTimelineContentChunk = vi.fn().mockResolvedValue({ conversationId: "c", historyIndex: 1, content: "different body", nextOffset: 14, done: true })
    await expect(loadShareContent({ getTimelineContentChunk }, target, shareMessages([{ ...message(2), contentTruncated: true }], false), new AbortController().signal)).rejects.toThrow("变化")
  })
})
