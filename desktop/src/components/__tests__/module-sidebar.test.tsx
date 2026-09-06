/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ModuleSidebar,
  ModuleSidebarGroup,
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
  const label = "CC/Synapse"

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
  it("does not reserve content spacing for an empty open group", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ModuleSidebarGroup
          open
          onOpenChange={vi.fn()}
          title="Empty project"
        >
          {[]}
        </ModuleSidebarGroup>,
      )
    })

    const group = container.querySelector('[data-slot="collapsible"]')
    const content = group?.querySelector('[data-slot="collapsible-content"]')
    const contentList = content?.firstElementChild

    expect(group?.className).not.toContain("gap-0.5")
    expect(contentList?.childElementCount).toBe(0)
    expect(contentList?.className).toContain("empty:hidden")
    expect(contentList?.className).toContain("pt-0.5")
  })

  it("keeps group actions visible when project and row labels are long", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ModuleSidebarGroup
          open
          onOpenChange={vi.fn()}
          data-track="long-sidebar-group"
          title="SmarterLayer_Upgrade_Flutter_With_An_Extremely_Long_Project_Name"
          actions={<button type="button">新建会话</button>}
        >
          <ModuleSidebarItem active trailing={<span>11 分钟前</span>}>
            Add project path to work log with an extremely long conversation title
          </ModuleSidebarItem>
        </ModuleSidebarGroup>,
      )
    })

    const group = container.querySelector('[data-slot="collapsible"]')
    const header = group?.firstElementChild
    const trigger = header?.querySelector('[data-slot="collapsible-trigger"]')
    const title = trigger?.querySelector("span")
    const actions = Array.from(header?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent === "新建会话")
      ?.parentElement
    const content = group?.querySelector('[data-slot="collapsible-content"]')

    expect(group?.className).toContain("w-full")
    expect(group?.className).toContain("min-w-0")
    expect(group?.className).toContain("max-w-full")
    expect(header?.className).toContain("min-w-0")
    expect(header?.className).toContain("max-w-full")
    expect(trigger?.className).toContain("min-w-0")
    expect(trigger?.className).toContain("flex-1")
    expect(title?.className).toContain("truncate")
    expect(actions?.className).toContain("shrink-0")
    expect(content?.className).toContain("min-w-0")
    expect(content?.className).toContain("max-w-full")
  })

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
