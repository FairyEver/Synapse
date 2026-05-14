import { describe, expect, it } from "vitest"

import type { SynapseAgentTimelineItem } from "@/types/agent"
import { chatReducer, initialChatState } from "../use-chat-reducer"

describe("chatReducer", () => {
  it("restores the current conversation model from persisted result timeline items", () => {
    const next = chatReducer({
      ...initialChatState,
      currentConversationModel: "claude-haiku-3-5",
    }, {
      type: "SET_TIMELINE",
      timeline: [
        resultItem("result-1", "claude-sonnet-4-5"),
        resultItem("result-2", "claude-opus-4"),
      ],
    })

    expect(next.currentConversationModel).toBe("claude-opus-4")
  })

  it("clears stale conversation model state when the persisted timeline has no model", () => {
    const next = chatReducer({
      ...initialChatState,
      currentConversationModel: "claude-haiku-3-5",
    }, {
      type: "SET_TIMELINE",
      timeline: [],
    })

    expect(next.currentConversationModel).toBeUndefined()
  })
})

function resultItem(id: string, model: string): SynapseAgentTimelineItem {
  return {
    id,
    kind: "result",
    timestamp: "2026-05-14T00:00:00.000Z",
    content: "",
    metadata: { model },
  }
}
