/**
 * @vitest-environment jsdom
 */
import { act, type Ref } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentPermissionModeMenu } from "../permission-mode-menu"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: () => "tracked-menu-item",
  mergeRefs: (...refs: Array<Ref<HTMLElement> | undefined>) => (node: HTMLElement | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    }
  },
  track,
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("AgentPermissionModeMenu", () => {
  it("tracks permission mode selections with sanitized transition metadata", async () => {
    const onSelect = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentPermissionModeMenu
          selectedMode="default"
          trigger={<button type="button">权限模式</button>}
          onSelect={onSelect}
        />,
      )
    })

    openMenu(container)
    const item = getModeItem("bypassPermissions")
    await act(async () => {
      item.click()
    })

    expect(onSelect).toHaveBeenCalledWith("bypassPermissions")
    expect(track).toHaveBeenCalledWith({
      component: "agent",
      name: "agent-permission-mode-select",
      action: "select",
      metadata: {
        boundary: "renderer.agent.permission-mode-select",
        currentMode: "default",
        targetMode: "bypassPermissions",
        capability: "requiresNewSession",
        changed: true,
      },
    })
  })
})

function openMenu(container: HTMLElement) {
  const trigger = container.querySelector("button")
  expect(trigger).toBeTruthy()
  act(() => {
    trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function getModeItem(mode: string) {
  const item = document.querySelector(`[data-mode="${mode}"]`)
  expect(item).toBeTruthy()
  return item as HTMLElement
}
