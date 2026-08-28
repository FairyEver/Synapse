/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AgentWorkspaceShell,
  useAgentWorkspacePanel,
} from "../agent-workspace-shell"

vi.mock("@/components/workspace-auxiliary-panel-layout", () => ({
  WorkspaceAuxiliaryPanelLayout: ({ main, auxiliary }: {
    readonly main: ReactNode
    readonly auxiliary?: ReactNode
  }) => <div>{auxiliary ?? main}</div>,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(0), 0)
window.cancelAnimationFrame = (frame) => window.clearTimeout(frame)

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
})

function PanelTrigger() {
  const { openPanel } = useAgentWorkspacePanel()
  return (
    <button
      id="checkpoint-review-trigger"
      type="button"
      onClick={() => openPanel({
        panelId: "agent.file-diff",
        payload: { checkpointId: "checkpoint-1" },
      })}
    >
      审查
    </button>
  )
}

describe("AgentWorkspaceShell", () => {
  it("focuses the panel, closes it with Escape, and restores the trigger focus", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentWorkspaceShell
          conversationKey="conversation-1"
          mode="embedded"
          panels={[{
            id: "agent.file-diff",
            title: () => "审查文件",
            render: () => <div>文件差异</div>,
            isSameTarget: (left, right) => left.checkpointId === right.checkpointId,
          }]}
        >
          <PanelTrigger />
        </AgentWorkspaceShell>,
      )
    })

    const trigger = document.getElementById("checkpoint-review-trigger")
    await act(async () => {
      trigger?.focus()
      trigger?.click()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.activeElement?.getAttribute("aria-label")).toBe("返回对话")

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.body.textContent).not.toContain("文件差异")
    expect(document.activeElement).toBe(document.getElementById("checkpoint-review-trigger"))
  })
})
