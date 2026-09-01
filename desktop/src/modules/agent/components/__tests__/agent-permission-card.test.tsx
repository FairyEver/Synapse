/**
 * @vitest-environment jsdom
 */
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentPermissionRequestTimelineItem } from "@/types/agent"
import { AgentPermissionCard } from "../agent-permission-card"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const trackMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: vi.fn(() => "button"),
  track: trackMock,
}))

const permissionItem: SynapseAgentPermissionRequestTimelineItem = {
  id: "permission-1",
  kind: "permissionRequest",
  timestamp: "2026-05-14T00:00:00.000Z",
  requestId: "request-1",
  toolName: "Bash",
  toolInput: "pnpm test",
  sdkSessionId: "sdk-session-1",
  agentSessionId: "agent-session-1",
  threadId: "thread-1",
}

let roots: Root[] = []

beforeEach(() => {
  trackMock.mockClear()
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

describe("AgentPermissionCard", () => {
  it("keeps permission actions visible until the pending request is cleared", () => {
    const onRespond = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(
        <AgentPermissionCard
          item={permissionItem}
          pending
          isLatestPending
          onRespond={onRespond}
        />,
      )
    })

    const allowButton = buttonByText(container, "允许")
    act(() => {
      allowButton.click()
    })

    expect(onRespond).toHaveBeenCalledWith("request-1", "allow")
    expect(buttonByText(container, "允许")).toBeTruthy()
    expect(buttonByText(container, "拒绝")).toBeTruthy()
    expect(container.textContent).not.toContain("已允许")
  })

  it("tracks permission responses without recording tool input", () => {
    const onRespond = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(
        <AgentPermissionCard
          item={permissionItem}
          pending
          isLatestPending
          onRespond={onRespond}
        />,
      )
    })

    const denyButton = buttonByText(container, "拒绝")
    act(() => {
      denyButton.click()
    })

    expect(trackMock).toHaveBeenCalledWith({
      component: "agent",
      name: "agent-permission-card-response",
      action: "submit",
      eventKey: "agent.permission.respond",
      value: "deny",
      metadata: {
        boundary: "renderer.agent.permission-card-response",
        itemId: "permission-1",
        requestId: "request-1",
        toolName: "Bash",
        behavior: "deny",
        inputLength: "pnpm test".length,
        hasRawInput: false,
        sdkSessionId: "sdk-session-1",
        agentSessionId: "agent-session-1",
        threadId: "thread-1",
      },
    })
    expect(JSON.stringify(trackMock.mock.calls)).not.toContain("pnpm test")
  })

  it("shows session directory authorization only when the SDK supports it", () => {
    const onRespond = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(
        <AgentPermissionCard
          item={{ ...permissionItem, sessionDirectoryGrantAvailable: true }}
          pending
          isLatestPending
          onRespond={onRespond}
        />,
      )
    })

    expect(buttonByText(container, "允许一次")).toBeTruthy()
    expect(buttonByText(container, "本会话允许")).toBeTruthy()

    act(() => {
      buttonByText(container, "本会话允许").click()
    })
    expect(onRespond).toHaveBeenCalledWith(
      "request-1",
      "allow",
      undefined,
      undefined,
      "session",
    )
  })

  it("redacts raw SDK tool input fallback before rendering", () => {
    const onRespond = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(
        <AgentPermissionCard
          item={{
            ...permissionItem,
            toolInput: undefined,
            toolInputRaw: {
              authorization: "Bearer sk-secret",
              headers: { cookie: "sid=secret-cookie" },
              nested: { password: "pass-1", value: "safe" },
            },
          }}
          pending
          isLatestPending
          onRespond={onRespond}
        />,
      )
    })

    expect(container.textContent).toContain("[redacted]")
    expect(container.textContent).toContain('"value": "safe"')
    expect(container.textContent).not.toContain("sk-secret")
    expect(container.textContent).not.toContain("secret-cookie")
    expect(container.textContent).not.toContain("pass-1")
  })

  it("preserves path-like raw SDK tool input fallback before rendering", () => {
    const onRespond = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(
        <AgentPermissionCard
          item={{
            ...permissionItem,
            toolInput: undefined,
            toolInputRaw: {
              cwd: "/Users/liyang/Documents/code/github/Synapse",
              command: "cat /Users/liyang/Documents/code/github/Synapse/secret.txt",
              windowsPath: "C:\\Users\\liyang\\Synapse\\secret.txt",
            },
          }}
          pending
          isLatestPending
          onRespond={onRespond}
        />,
      )
    })

    expect(container.textContent).toContain("/Users/liyang/Documents/code/github/Synapse")
    expect(container.textContent).toContain("C:\\\\Users\\\\liyang\\\\Synapse\\\\secret.txt")
  })
})

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`)
  }
  return button
}
