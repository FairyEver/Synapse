import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AgentMessageBubble } from "../agent-message-bubble"

describe("AgentMessageBubble", () => {
  it("allows long unbroken message text to shrink inside the timeline", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble role="user">
        {"x".repeat(240)}
      </AgentMessageBubble>,
    )

    expect(html).toContain("min-w-0")
    expect(html).toContain("break-words")
  })

  it("uses equal padding on every side of user messages", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble role="user">消息</AgentMessageBubble>,
    )

    expect(html).toContain("p-4")
    expect(html).not.toContain("px-5")
    expect(html).not.toContain("py-3")
  })
})
