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
})
