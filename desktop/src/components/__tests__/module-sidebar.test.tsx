/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ModuleSidebar,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    readonly children: ReactNode
    readonly className?: string
  }) => (
    <div data-testid="scroll-area" className={className}>
      {children}
    </div>
  ),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

async function renderSidebar() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const label = "ClaudeCode/Synapse"

  await act(async () => {
    root.render(
      <ModuleSidebar variant="bare">
        <ModuleSidebarList data-track="test-sidebar-list">
          <ModuleSidebarItem
            active
            data-track="long-sidebar-item"
            iconElement={<span data-testid="item-icon" />}
            trailing={<span>26</span>}
          >
            {label}
          </ModuleSidebarItem>
        </ModuleSidebarList>
      </ModuleSidebar>,
    )
  })

  return { container, label }
}

describe("ModuleSidebar", () => {
  it("keeps long item labels inside the fixed sidebar width", async () => {
    const { container, label } = await renderSidebar()
    const sidebar = container.querySelector("aside")
    const listContent = container.querySelector('[data-testid="scroll-area"] > div')
    const item = container.querySelector('[data-track="long-sidebar-item"]')
    const button = item?.querySelector("button")
    const labelWrapper = button?.querySelector(".flex-col")
    const labelElement = Array.from(button?.querySelectorAll("span") ?? [])
      .find((element) => element.textContent === label && element.className.includes("truncate"))
    const trailing = item?.lastElementChild

    expect(sidebar?.className).toContain("min-w-0")
    expect(listContent?.className).toContain("min-w-0")
    expect(listContent?.className).toContain("w-full")
    expect(listContent?.className).toContain("max-w-full")
    expect(listContent?.className).toContain("overflow-hidden")
    expect(item?.className).toContain("min-w-0")
    expect(item?.className).toContain("max-w-full")
    expect(item?.className).toContain("box-border")
    expect(item?.className).toContain("overflow-hidden")
    expect(button?.className).toContain("overflow-hidden")
    expect(button?.className).toContain("box-border")
    expect(labelWrapper?.className).toContain("flex-1")
    expect(labelWrapper?.className).toContain("overflow-hidden")
    expect(labelElement?.className).toContain("block")
    expect(labelElement?.className).toContain("truncate")
    expect(trailing?.className).toContain("shrink-0")
  })
})
