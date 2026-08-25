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

  it("restores the current conversation model from assistant message metadata", () => {
    const next = chatReducer({
      ...initialChatState,
      currentConversationModel: "claude-haiku-3-5",
    }, {
      type: "SET_TIMELINE",
      timeline: [
        assistantMessageItem("assistant-1", "claude-sonnet-4-5"),
        assistantMessageItem("assistant-2", "claude-opus-4"),
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

  it("updates the current conversation model when the timeline updater restores result items", () => {
    const next = chatReducer({
      ...initialChatState,
      currentConversationModel: "claude-haiku-3-5",
    }, {
      type: "UPDATE_TIMELINE",
      updater: () => [
        resultItem("result-1", "claude-sonnet-4-5"),
        resultItem("result-2", "claude-opus-4"),
      ],
    })

    expect(next.currentConversationModel).toBe("claude-opus-4")
  })

  it("restores the latest persisted context snapshot", () => {
    const next = chatReducer(initialChatState, {
      type: "SET_TIMELINE",
      timeline: [
        resultItem("result-1", "claude-sonnet-4-5", 40_000),
        assistantMessageItem("assistant-2", "claude-opus-4", 58_000),
      ],
    })

    expect(next.contextUsage).toEqual({
      usedTokens: 58_000,
      contextWindowTokens: 200_000,
      model: "claude-opus-4",
    })
  })

  it("clears context on conversation timeline reset", () => {
    const next = chatReducer({
      ...initialChatState,
      contextUsage: { usedTokens: 58_000, contextWindowTokens: 200_000 },
    }, {
      type: "SET_TIMELINE",
      timeline: [],
    })

    expect(next.contextUsage).toBeUndefined()
  })

  it("applies live context decreases without timeline batching overwriting them", () => {
    const compacted = chatReducer(initialChatState, {
      type: "SET_CONTEXT_USAGE",
      contextUsage: { usedTokens: 12_000, contextWindowTokens: 200_000 },
    })
    const afterTimelineUpdate = chatReducer(compacted, {
      type: "UPDATE_TIMELINE",
      updater: (current) => current,
    })

    expect(afterTimelineUpdate.contextUsage?.usedTokens).toBe(12_000)
  })
})

function resultItem(id: string, model: string, usedTokens?: number): SynapseAgentTimelineItem {
  return {
    id,
    kind: "result",
    timestamp: "2026-05-14T00:00:00.000Z",
    content: "",
    metadata: {
      model,
      ...(usedTokens === undefined ? {} : {
        contextUsage: { usedTokens, contextWindowTokens: 200_000, model },
      }),
    },
  }
}

function assistantMessageItem(id: string, model: string, usedTokens?: number): SynapseAgentTimelineItem {
  return {
    id,
    kind: "message",
    role: "assistant",
    timestamp: "2026-05-14T00:00:00.000Z",
    content: "Done",
    metadata: {
      model,
      ...(usedTokens === undefined ? {} : {
        contextUsage: { usedTokens, contextWindowTokens: 200_000, model },
      }),
    },
  }
}
