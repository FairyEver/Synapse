/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: () => <div data-testid="resize-handle" />,
  ResizablePanel: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({
    children,
    className,
  }: {
    readonly children: ReactNode
    readonly className?: string
  }) => <div className={className}>{children}</div>,
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    readonly children: ReactNode
    readonly className?: string
  }) => <div data-testid="content-scroll" className={className}>{children}</div>,
}))

import { SidebarContentLayout } from "@/components/sidebar-content-layout"

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

async function renderLayout(props: Partial<React.ComponentProps<typeof SidebarContentLayout>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <SidebarContentLayout sidebar={<nav>Sidebar</nav>} {...props}>
        <main>Content</main>
      </SidebarContentLayout>,
    )
  })

  return container
}

describe("SidebarContentLayout", () => {
  it("keeps the sidebar fixed by default", async () => {
    const container = await renderLayout()

    expect(container.querySelector('[data-testid="resize-handle"]')).toBeNull()
  })

  it("renders the drag handle when sidebar resizing is enabled", async () => {
    const container = await renderLayout({ sidebarResizable: true })

    expect(container.querySelector('[data-testid="resize-handle"]')).not.toBeNull()
  })

  it("does not put content padding on the scroll clipping layer", async () => {
    const container = await renderLayout()
    const scroll = container.querySelector('[data-testid="content-scroll"]')

    expect(scroll?.className).not.toContain("px-")
    expect(scroll?.className).not.toContain("py-")
    expect(scroll?.className).not.toContain("p-")
  })

  it("does not put sidebar padding on the clipping layer", async () => {
    const container = await renderLayout()
    const sidebar = Array.from(container.querySelectorAll("div"))
      .find((element) => element.textContent === "Sidebar")

    expect(sidebar?.className).not.toContain("px-")
    expect(sidebar?.className).not.toContain("py-")
    expect(sidebar?.className).not.toContain("p-")
  })
})
