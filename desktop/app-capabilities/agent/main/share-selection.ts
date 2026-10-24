import { createHash } from "node:crypto"
import type { ConversationEntryV1 } from "../../../electron/runtime/data-repo"
import { historyRecordToTimelineItem } from "../../../src/lib/agent-timeline"
import { shareMessages, shareMessageRounds } from "../../../src/modules/agent/share/messages"
import type { ShareMessageSnapshot, ShareSelection } from "../shared/share"

export function buildShareSnapshot(conversation: ConversationEntryV1, beforeIndex: number): ShareMessageSnapshot[] {
  if (!Number.isInteger(beforeIndex) || beforeIndex < 0 || beforeIndex > conversation.history.length) throw new Error("分享历史边界无效。")
  if (beforeIndex > 10_000) throw new Error("对话过长，请缩小分享范围。")
  const history = conversation.history.slice(0, beforeIndex)
  if (Buffer.byteLength(JSON.stringify(history)) > 8 * 1024 * 1024) throw new Error("对话过长，请缩小分享范围。")
  const visible = shareMessages(history.map((record, index) => historyRecordToTimelineItem(conversation.id, record, index, conversation.agentType)), false)
  let turnRef = ""
  return visible.map((message, ordinal) => {
    if (Buffer.byteLength(message.content) > 2 * 1024 * 1024) throw new Error("单条消息过长，请缩小分享范围。")
    const hash = createHash("sha256").update(JSON.stringify([conversation.projectId, conversation.id, message.historyIndex, message])).digest("hex").slice(0, 32)
    const messageRef = `asm_${hash}`
    if (message.role === "user" || !turnRef) turnRef = `ast_${hash}`
    return { ...message, messageRef, turnRef, ordinal }
  })
}

export function selectShareMessages(messages: readonly ShareMessageSnapshot[], selection: ShareSelection, refs?: readonly string[]): ShareMessageSnapshot[] {
  let selected: ShareMessageSnapshot[]
  if (selection === "latest_turn") {
    const round = shareMessageRounds(messages).filter(ids => ids.some(id => messages.find(m => m.id === id)?.role === "assistant") && ids.some(id => messages.find(m => m.id === id)?.role === "user")).at(-1)
    selected = messages.filter(m => round?.includes(m.id))
  } else if (selection === "assistant") selected = messages.filter(m => m.role === "assistant").slice(-1)
  else if (selection === "all") selected = [...messages]
  else {
    if (!refs?.length || new Set(refs).size !== refs.length) throw new Error("消息引用无效。")
    selected = messages.filter(m => refs.includes(m.messageRef))
    if (selected.length !== refs.length) throw new Error("消息引用已失效，请重新选择。")
  }
  if (!selected.length) throw new Error("没有可分享的已完成消息。")
  return structuredClone(selected)
}
