/**
 * @vitest-environment jsdom
 */
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentPermissionRequestTimelineItem } from "@/types/agent"
import { AgentPermissionCard } from "../agent-permission-card"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const permissionItem: SynapseAgentPermissionRequestTimelineItem = {
  id: "permission-1",
  kind: "permissionRequest",
  timestamp: "2026-05-14T00:00:00.000Z",
  requestId: "request-1",
  toolName: "Bash",
  toolInput: "pnpm test",
}

let roots: Root[] = []

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
})

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`)
  }
  return button
}
