import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LiveConnectionPanel } from "../live-connection-panel"

describe("LiveConnectionPanel", () => {
  it("renders the connected live status", () => {
    const html = renderToStaticMarkup(createElement(LiveConnectionPanel, {
      initialState: {
        status: "connected",
        clientInstanceId: "client-a",
        connectedAt: "2026-06-06T10:00:00.000Z",
        lastSeenAt: "2026-06-06T10:00:01.000Z",
        lastError: null,
      },
    }))

    expect(html).toContain("服务器连接")
    expect(html).toContain("已连接")
  })

  it("renders reconnecting errors when present", () => {
    const html = renderToStaticMarkup(createElement(LiveConnectionPanel, {
      initialState: {
        status: "reconnecting",
        clientInstanceId: "client-a",
        connectedAt: null,
        lastSeenAt: null,
        lastError: "连接已断开",
      },
    }))

    expect(html).toContain("重连中")
    expect(html).toContain("连接已断开")
  })
})
