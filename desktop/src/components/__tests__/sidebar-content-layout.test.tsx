/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: () => <div data-testid="resize-handle" />,
  ResizablePanel: ({
    children,
    defaultSize,
    minSize,
    maxSize,
  }: {
    readonly children: ReactNode
    readonly defaultSize?: number
    readonly minSize?: number
    readonly maxSize?: number
  }) => (
    <div
      data-default-size={defaultSize}
      data-min-size={minSize}
      data-max-size={maxSize}
    >
      {children}
    </div>
  ),
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

  it("allows callers to set sidebar pixel constraints", async () => {
    const container = await renderLayout({
      sidebarResizable: true,
      sidebarDefaultSize: 250,
      sidebarMinSize: 250,
      sidebarMaxSize: 360,
    })
    const sidebarPanel = container.querySelector("[data-default-size]")

    expect(sidebarPanel?.getAttribute("data-default-size")).toBe("250")
    expect(sidebarPanel?.getAttribute("data-min-size")).toBe("250")
    expect(sidebarPanel?.getAttribute("data-max-size")).toBe("360")
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

  it("centers content on the inner content layer when requested", async () => {
    const container = await renderLayout({ contentLayout: "center" })
    const scroll = container.querySelector('[data-testid="content-scroll"]')
    const content = container.querySelector("main")

    expect(scroll?.className).not.toContain("justify-center")
    expect(content?.parentElement?.className).toContain("items-center")
    expect(content?.parentElement?.className).toContain("justify-center")
  })
})
