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
      eventKey: "agent.permission-mode.select",
      metadata: {
        boundary: "renderer.agent.permission-mode-select",
        currentMode: "default",
        targetMode: "bypassPermissions",
        capability: "requiresNewSession",
        changed: true,
      },
    })
  })

  it("explains each permission mode with the original English mode and risk copy", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentPermissionModeMenu
          selectedMode="default"
          trigger={<button type="button">权限模式</button>}
          onSelect={vi.fn()}
        />,
      )
    })

    openMenu(container)
    const item = getModeItem("bypassPermissions")
    const content = document.querySelector('[data-slot="dropdown-menu-content"]')
    const description = findElementByText("跳过所有权限确认；所有到达权限层的工具都会直接执行。")

    expect(item.textContent).toContain("跳过权限确认")
    expect(item.textContent).not.toContain("高风险")
    expect(item.querySelector("svg")).toBeNull()
    expect(content?.className).toContain("w-[340px]")
    expect(description?.className).toContain("text-[11px]")

    await hoverElement(item)

    expect(document.body.textContent).toContain("bypassPermissions")
    expect(document.body.textContent).toContain("Bypass all permission checks")
    expect(document.body.textContent).toContain("高风险")
    expect(document.body.textContent).toContain("所有到达权限层的工具都会直接执行")
    expect(document.body.textContent).toContain("只建议在隔离环境或完全信任任务时使用")
    expect(findElementByText("只建议在隔离环境或完全信任任务时使用。")?.className).toContain("text-xs")
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

function findElementByText(text: string) {
  return Array.from(document.querySelectorAll("*")).find((element) => element.textContent === text)
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function hoverElement(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    element.dispatchEvent(new MouseEvent("pointerenter", { bubbles: false }))
    element.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }))
    element.focus()
    await wait(120)
  })
}
