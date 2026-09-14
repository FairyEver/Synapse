/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ModuleSidebarGroup } from "@/components/module-sidebar"
import {
  ModuleSidebarSortableGroup,
  ModuleSidebarSortableList,
} from "@/components/module-sidebar-sortable"

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

async function renderSidebar(content: ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<div className="grid gap-1">{content}</div>)
  })

  return container
}

function triggerFor(container: HTMLElement, title: string): HTMLElement | null {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-slot="collapsible-trigger"]'))
    .find((element) => element.textContent === title) ?? null
}

describe("ModuleSidebarSortableGroup", () => {
  it("marks only sortable groups and keeps the trigger clickable", async () => {
    const onOpenChange = vi.fn()
    const onReorder = vi.fn()
    const container = await renderSidebar(
      <ModuleSidebarSortableList items={["group-1"]} onReorder={onReorder}>
        <ModuleSidebarSortableGroup
          open
          onOpenChange={onOpenChange}
          sortableId="group-1"
          title="构建"
        >
          {null}
        </ModuleSidebarSortableGroup>
      </ModuleSidebarSortableList>,
    )

    const sortable = container.querySelector<HTMLElement>("[data-sortable-id]")
    const trigger = triggerFor(container, "构建")

    expect(sortable?.dataset.sortableId).toBe("group-1")
    expect(trigger?.getAttribute("aria-roledescription")).toBe("sortable")
    expect(trigger?.hasAttribute("aria-describedby")).toBe(true)

    await act(async () => {
      trigger?.click()
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("leaves plain groups without sortable markers", async () => {
    const container = await renderSidebar(
      <ModuleSidebarGroup open onOpenChange={vi.fn()} title="会话">
        {null}
      </ModuleSidebarGroup>,
    )

    expect(container.querySelector("[data-sortable-id]")).toBeNull()
    expect(triggerFor(container, "会话")?.hasAttribute("aria-roledescription")).toBe(false)
  })
})
