import { describe, expect, it } from "vitest"
import {
  buildCcConversationWindowSearchParams,
  parseCcConversationWindowRequest,
} from "@/lib/cc-conversation-window"

describe("cc conversation window helpers", () => {
  it("round-trips a session window request with focus", () => {
    const params = buildCcConversationWindowSearchParams({
      sessionId: "session-1",
      title: "对话",
      focus: { timestampMs: 1779860000000, usageEventId: "usage-1" },
    })

    expect(parseCcConversationWindowRequest(`?${params.toString()}`)).toEqual({
      sessionId: "session-1",
      title: "对话",
      focus: { timestampMs: 1779860000000, usageEventId: "usage-1" },
    })
  })

  it("rejects unrelated windows", () => {
    expect(parseCcConversationWindowRequest("?synapseWindow=content&id=x")).toBeNull()
  })

  it("rejects an empty session id", () => {
    expect(parseCcConversationWindowRequest("?synapseWindow=cc-conversation&sessionId=")).toBeNull()
  })
})
