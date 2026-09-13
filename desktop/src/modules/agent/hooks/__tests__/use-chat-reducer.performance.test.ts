import { describe, expect, it } from "vitest"
import { chatReducer, initialChatState } from "../use-chat-reducer"

describe("Agent redundant updates", () => {
  it("does not notify consumers for repeated stream running state", () => {
    const running = chatReducer(initialChatState, { type: "ADD_SENDING_CONVERSATION", conversationId: "running" })
    let state = running
    for (let index = 0; index < 100_000; index += 1) {
      state = chatReducer(state, { type: "ADD_SENDING_CONVERSATION", conversationId: "running" })
    }
    expect(state).toBe(running)
    const stopped = chatReducer(state, { type: "REMOVE_SENDING_CONVERSATION", conversationId: "running" })
    expect(stopped).not.toBe(state)
    expect(chatReducer(stopped, { type: "REMOVE_SENDING_CONVERSATION", conversationId: "running" })).toBe(stopped)
  })

  it("keeps active turn, cancel and no-op timeline updates referentially stable", () => {
    const running = chatReducer(initialChatState, { type: "SET_ACTIVE_TURN", conversationId: "c", turnId: "t" })
    expect(chatReducer(running, { type: "SET_ACTIVE_TURN", conversationId: "c", turnId: "t" })).toBe(running)
    expect(chatReducer(running, { type: "CLEAR_ACTIVE_TURN", conversationId: "other" })).toBe(running)
    expect(chatReducer(running, { type: "CANCEL_RESET" })).toBe(running)
    expect(chatReducer(running, { type: "UPDATE_TIMELINE", updater: (items) => items })).toBe(running)
    expect(chatReducer(running, { type: "SET_ACTIVE_TURN", conversationId: "c", turnId: "new" })).not.toBe(running)
  })
})
