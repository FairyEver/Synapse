import type { ConversationEntryV1 } from "../../../../runtime/data-repo"

const USER_MESSAGE_INDICES = new Set([0, 1, 2, 3, 109, 121, 133, 145, 157, 169, 181])
const ASSISTANT_MESSAGE_INDICES = new Set([4, 60, 70, 80, 110, 122, 134, 146, 158, 170, 182])

export function createConversationHistory183(): ConversationEntryV1["history"] {
  return Array.from({ length: 183 }, (_, index) => createEntry(index))
}

function createEntry(index: number): ConversationEntryV1["history"][number] {
  const timestamp = new Date(Date.UTC(2026, 7, 3, 0, 0, 0, index)).toISOString()
  if (USER_MESSAGE_INDICES.has(index)) {
    return { role: "user", content: `user message ${String(index)}`, timestamp }
  }
  if (ASSISTANT_MESSAGE_INDICES.has(index)) {
    return { role: "assistant", content: `assistant message ${String(index)}`, timestamp }
  }
  if (index === 82) {
    return {
      role: "tool",
      content: "Read\n{\"file_path\":\"example.md\"}",
      timestamp,
      metadata: { agentEventType: "toolUse", toolUseId: "tool-82", toolName: "Read" },
    }
  }
  if (index === 83) {
    return {
      role: "tool",
      content: "example content",
      timestamp,
      metadata: {
        agentEventType: "toolResult",
        toolUseId: "tool-82",
        toolName: "Read",
        status: "success",
        success: true,
      },
    }
  }
  return {
    role: "assistant",
    content: `thinking ${String(index)}`,
    timestamp,
    metadata: { agentEventType: "thinking" },
  }
}
