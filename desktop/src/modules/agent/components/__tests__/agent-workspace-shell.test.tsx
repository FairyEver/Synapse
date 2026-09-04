/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, type Ref } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AgentWorkspaceShell,
  resolveAgentFileTreeOverlayWidth,
  useAgentWorkspacePanel,
} from "../agent-workspace-shell"

vi.mock("@/components/workspace-auxiliary-panel-layout", () => ({
  WorkspaceAuxiliaryPanelLayout: ({ main, leadingAuxiliary, auxiliary }: {
    readonly main: ReactNode
    readonly leadingAuxiliary?: ReactNode
    readonly auxiliary?: ReactNode
  }) => (
    <div data-workspace-layout data-has-leading-auxiliary={leadingAuxiliary ? "true" : "false"}>
      {main}{leadingAuxiliary}{auxiliary}
    </div>
  ),
}))

vi.mock("@/components/workspace-file-tree", () => ({
  WorkspaceFileTree: ({ closeButtonRef, onClose }: {
    readonly closeButtonRef?: Ref<HTMLButtonElement>
    readonly onClose: () => void
  }) => (
    <section aria-label="文件树">
      <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭文件树">关闭</button>
    </section>
  ),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(0), 0)
window.cancelAnimationFrame = (frame) => window.clearTimeout(frame)

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
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

function FileTreeTrigger() {
  const { fileTreeOpen, fileTreeTriggerRef, toggleFileTree } = useAgentWorkspacePanel()
  return (
    <button ref={fileTreeTriggerRef} id="file-tree-trigger" type="button" onClick={toggleFileTree}>
      {fileTreeOpen ? "关闭树" : "打开树"}
    </button>
  )
}

describe("AgentWorkspaceShell", () => {
  it("caps the file tree overlay width so the conversation remains visible", () => {
    expect(resolveAgentFileTreeOverlayWidth(null, 280)).toBe(280)
    expect(resolveAgentFileTreeOverlayWidth(1200, 280)).toBe(280)
    expect(resolveAgentFileTreeOverlayWidth(360, 280)).toBe(200)
  })

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

  it("overlays the file tree and closes it after a pointer down outside", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 360,
      height: 720,
      top: 0,
      right: 360,
      bottom: 720,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentWorkspaceShell
          conversationKey="conversation-1"
          mode="embedded"
          fileTreeDataSource={{
            open: vi.fn(async () => ({ scopeId: "scope-1", rootName: "project", revision: 0 })),
            list: vi.fn(async ({ scopeId, relativePath }) => ({
              scopeId,
              relativePath,
              revision: 0,
              entries: [],
            })),
            close: vi.fn(async () => undefined),
            onChanged: vi.fn(() => () => undefined),
          }}
          panels={[{
            id: "agent.file-diff",
            title: () => "审查文件",
            render: () => <div>文件差异</div>,
            isSameTarget: (left, right) => left.checkpointId === right.checkpointId,
          }]}
        >
          <FileTreeTrigger />
          <PanelTrigger />
        </AgentWorkspaceShell>,
      )
    })

    await act(async () => document.getElementById("file-tree-trigger")?.click())

    expect(document.querySelector('[aria-label="文件树"]')).not.toBeNull()
    expect(document.querySelector<HTMLElement>("[data-agent-file-tree-overlay]")?.style.width).toBe("200px")
    await act(async () => {
      document.querySelector("[data-agent-file-tree-overlay]")
        ?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
    })
    expect(document.querySelector('[aria-label="文件树"]')).not.toBeNull()

    await act(async () => {
      document.getElementById("checkpoint-review-trigger")
        ?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
    })
    expect(document.querySelector('[aria-label="文件树"]')).toBeNull()

    await act(async () => document.getElementById("checkpoint-review-trigger")?.click())
    expect(document.querySelector("[data-workspace-layout]")?.getAttribute("data-has-leading-auxiliary"))
      .toBe("false")
    expect(document.body.textContent).toContain("文件差异")
  })
})
