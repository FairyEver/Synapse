import type { SynapseAgentMessageTimelineItem, SynapseAgentTimelineItem, SynapseAgentTimelineResult } from "../../../types/agent"
import type { AgentConversationTarget } from "../../../types/agent-conversation-window"
import { groupTimelineDisplayEntries, timelineDisplayEntries } from "../components/agent-timeline-display"

export type ShareMessage = SynapseAgentMessageTimelineItem & { readonly role: "user" | "assistant" }
type HistoryPort = { getTimeline(input: AgentConversationTarget & { limit: number; beforeIndex?: number }): Promise<SynapseAgentTimelineResult> }
type ContentPort = { getTimelineContentChunk(input: { projectId: string; conversationId: string; historyIndex: number; offset: number; maxBytes: number }): Promise<{ conversationId: string; historyIndex: number; content: string; nextOffset: number; done: boolean }> }
const MAX_HISTORY_ENTRIES = 10_000
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024
const encoder = new TextEncoder()

export function shareFooterMetadata(items: readonly ShareMessage[]): { models: string; timestamp: string | undefined } {
  const models = new Set<string>()
  for (const item of items) {
    if (item.role !== "assistant") continue
    const model = item.metadata?.model?.trim()
    const names = model ? [model] : Object.keys(item.metadata?.modelUsage ?? {})
    for (const name of names) {
      if (name.trim()) models.add(name.trim())
    }
  }
  const timestamp = items.at(-1)?.timestamp
  return { models: [...models].join(" / "), timestamp: timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined }
}

export function shareMessages(items: readonly SynapseAgentTimelineItem[], sending: boolean): ShareMessage[] {
  return groupTimelineDisplayEntries(timelineDisplayEntries(items), { pendingPermissionRequestIds: new Set(), sending })
    .flatMap((node) => {
      if (node.kind !== "item") return []
      const item = node.entry.item
      return item.kind === "message" && (item.role === "user" || item.role === "assistant") && !item.streaming && (item.content.trim() || (item.role === "user" && item.attachments?.some((attachment) => attachment.kind === "image")))
        ? [structuredClone(item) as ShareMessage] : []
    })
}

export function shareMessageRounds(items: readonly ShareMessage[]): string[][] {
  const rounds: string[][] = []
  for (const item of items) {
    if (item.role === "user" || !rounds.length) rounds.push([])
    rounds[rounds.length - 1]!.push(item.id)
  }
  return rounds
}

export function shareHistoryIndex(item: SynapseAgentTimelineItem): number | undefined {
  if (item.historyIndex !== undefined) return item.historyIndex
  const match = /:history:(\d+)$/.exec(item.id)
  const index = match ? Number(match[1]) : undefined
  return index !== undefined && Number.isSafeInteger(index) ? index : undefined
}

/** Keep live IDs and frozen text intact; persisted history only supplies the older prefix. */
export function shareHistoryPrefix(history: readonly SynapseAgentTimelineItem[], initial: readonly SynapseAgentTimelineItem[]): SynapseAgentTimelineItem[] {
  const firstIndex = initial.map(shareHistoryIndex).find((index) => index !== undefined)
  if (firstIndex !== undefined) return history.filter((item) => { const index = shareHistoryIndex(item); return index !== undefined && index < firstIndex })
  const firstTime = Date.parse(initial[0]?.timestamp ?? "")
  if (!Number.isFinite(firstTime)) throw new Error("无法确定分享起点，请重新加载对话。")
  return history.filter((item) => Date.parse(item.timestamp) < firstTime)
}

export function selectShareRange(items: readonly ShareMessage[], selected: ReadonlySet<string>, id: string, anchor: string | null, checked: boolean): Set<string> {
  const end = items.findIndex((item) => item.id === id)
  if (end < 0) return new Set(selected)
  const start = anchor ? items.findIndex((item) => item.id === anchor) : end
  const next = new Set(selected)
  for (const item of items.slice(Math.min(start < 0 ? end : start, end), Math.max(start, end) + 1)) {
    if (checked) next.add(item.id)
    else next.delete(item.id)
  }
  return next
}

export async function loadShareHistory(bridge: HistoryPort, target: AgentConversationTarget, signal: AbortSignal): Promise<SynapseAgentTimelineItem[]> {
  let beforeIndex: number | undefined
  let bytes = 0
  let entries: SynapseAgentTimelineItem[] = []
  const ids = new Set<string>()
  while (true) {
    signal.throwIfAborted()
    const page = await bridge.getTimeline({ ...target, limit: 100, ...(beforeIndex !== undefined ? { beforeIndex } : {}) })
    signal.throwIfAborted()
    if (page.projectId !== target.projectId || page.conversationId !== target.conversationId) throw new Error("对话已变化，请重新分享。")
    if (!Number.isInteger(page.startIndex) || page.startIndex < 0 || (beforeIndex !== undefined && page.startIndex >= beforeIndex) || (page.hasMore && !page.entries.length)) {
      throw new Error("历史消息游标无效，请重试。")
    }
    for (const item of page.entries) {
      if (ids.has(item.id)) throw new Error("历史消息游标重复，请重试。")
      ids.add(item.id)
      bytes += encoder.encode(JSON.stringify(item)).byteLength
    }
    if (ids.size > MAX_HISTORY_ENTRIES || bytes > MAX_SNAPSHOT_BYTES) throw new Error("对话过长，请选择已加载的消息分享。")
    entries = [...page.entries, ...entries]
    if (!page.hasMore) return entries
    beforeIndex = page.startIndex
  }
}

export async function loadShareContent(bridge: ContentPort, target: AgentConversationTarget, items: readonly ShareMessage[], signal: AbortSignal): Promise<ShareMessage[]> {
  const full: ShareMessage[] = []
  let totalBytes = 0
  for (const item of items) {
    signal.throwIfAborted()
    let content = item.content
    if (item.contentTruncated) {
      if (item.historyIndex === undefined) throw new Error("无法读取完整消息，请重新加载对话。")
      let offset = 0
      let messageBytes = 0
      content = ""
      while (true) {
        signal.throwIfAborted()
        const chunk = await bridge.getTimelineContentChunk({ projectId: target.projectId, conversationId: target.conversationId, historyIndex: item.historyIndex, offset, maxBytes: 64 * 1024 })
        signal.throwIfAborted()
        if (chunk.conversationId !== target.conversationId || chunk.historyIndex !== item.historyIndex) throw new Error("对话已变化，请重新分享。")
        if (chunk.nextOffset !== offset + chunk.content.length || (!chunk.done && chunk.nextOffset <= offset)) throw new Error("消息正文游标无效，请重试。")
        messageBytes += encoder.encode(chunk.content).byteLength
        if (messageBytes > MAX_MESSAGE_BYTES) throw new Error("单条消息过长，请缩小分享范围。")
        content += chunk.content
        if (chunk.done) break
        offset = chunk.nextOffset
      }
      if (!content.startsWith(item.content)) throw new Error("对话已变化，请重新分享。")
    }
    const size = encoder.encode(content).byteLength
    totalBytes += size
    if (size > MAX_MESSAGE_BYTES || totalBytes > MAX_SNAPSHOT_BYTES) throw new Error("所选内容过长，请缩小分享范围。")
    const snapshot = structuredClone(item)
    full.push({ ...snapshot, content, contentTruncated: false, attachments: snapshot.attachments?.filter(attachment => attachment.kind === "image"), streaming: false })
  }
  return full
}
