import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AgentMessageHeader, formatTimestamp } from "../agent-message-header"

describe("AgentMessageHeader", () => {
  it("formats valid timestamps as HH:mm", () => {
    expect(formatTimestamp("2026-05-13T03:15:00.000Z")).toMatch(/^\d{2}:\d{2}$/)
  })

  it("omits invalid timestamps instead of rendering NaN", () => {
    expect(formatTimestamp("not-a-date")).toBeUndefined()

    const html = renderToStaticMarkup(<AgentMessageHeader timestamp="not-a-date" />)

    expect(html).not.toContain("NaN")
    expect(html).not.toContain("<time")
  })
})
