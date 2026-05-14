/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AgentPermissionPanel } from "../agent-permission-panel"

const { track } = vi.hoisted(() => ({
  track: vi.fn(),
}))

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: vi.fn(() => "button"),
  track,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  track.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("AgentPermissionPanel", () => {
  it("wraps long SDK permission tool input without horizontal overflow", () => {
    const html = renderToStaticMarkup(
      <AgentPermissionPanel
        pendingPermissions={[{
          requestId: "permission-1",
          projectId: "project-1",
          sessionKey: "session-1",
          conversationId: "conversation-1",
          toolName: "Bash",
          toolInput: "Authorization=Bearer_".concat("x".repeat(180)),
          createdAt: "2026-05-14T00:00:00.000Z",
        }]}
        onRespond={vi.fn()}
      />,
    )

    expect(html).toContain("whitespace-pre-wrap")
    expect(html).toContain("break-words")
  })

  it("tracks allow and deny responses with sanitized request context", async () => {
    const onRespond = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentPermissionPanel
          pendingPermissions={[{
            requestId: "permission-2",
            projectId: "project-2",
            sessionKey: "session-2",
            conversationId: "conversation-2",
            toolName: "Bash",
            toolInput: "token=sk-secret",
            createdAt: "2026-05-14T00:00:00.000Z",
          }]}
          onRespond={onRespond}
        />,
      )
    })

    const buttons = Array.from(container.querySelectorAll("button"))
    await act(async () => {
      buttons.find((button) => button.textContent === "拒绝")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      buttons.find((button) => button.textContent === "允许")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(track).toHaveBeenCalledWith({
      component: "agent",
      name: "agent-permission-response",
      action: "submit",
      value: "deny",
      metadata: {
        boundary: "renderer.agent.permission-response",
        requestId: "permission-2",
        projectId: "project-2",
        sessionKey: "session-2",
        conversationId: "conversation-2",
        toolName: "Bash",
        behavior: "deny",
        inputLength: "token=sk-secret".length,
      },
    })
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      component: "agent",
      name: "agent-permission-response",
      value: "allow",
    }))
    expect(JSON.stringify(track.mock.calls)).not.toContain("token=sk-secret")
    expect(onRespond).toHaveBeenCalledWith("permission-2", "deny")
    expect(onRespond).toHaveBeenCalledWith("permission-2", "allow")
  })
})
