/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const resizableMocks = vi.hoisted(() => ({
  onLayoutChanged: undefined as (() => void) | undefined,
  onSidebarResize: undefined as ((size: { inPixels: number }) => void) | undefined,
}))

vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: () => <div data-testid="resize-handle" />,
  ResizablePanel: ({
    children,
    defaultSize,
    minSize,
    maxSize,
    onResize,
  }: {
    readonly children: ReactNode
    readonly defaultSize?: number
    readonly minSize?: number
    readonly maxSize?: number
    readonly onResize?: (size: { inPixels: number }) => void
  }) => {
    if (onResize) resizableMocks.onSidebarResize = onResize
    return (
      <div
        data-default-size={defaultSize}
        data-min-size={minSize}
        data-max-size={maxSize}
      >
        {children}
      </div>
    )
  },
  ResizablePanelGroup: ({
    children,
    className,
    onLayoutChanged,
  }: {
    readonly children: ReactNode
    readonly className?: string
    readonly onLayoutChanged?: () => void
  }) => {
    resizableMocks.onLayoutChanged = onLayoutChanged
    return <div className={className}>{children}</div>
  },
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

beforeEach(() => {
  window.localStorage.clear()
  resizableMocks.onLayoutChanged = undefined
  resizableMocks.onSidebarResize = undefined
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
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

  it("hides the sidebar and resize handle when collapsed", async () => {
    const container = await renderLayout({
      sidebarCollapsed: true,
      sidebarResizable: true,
    })

    expect(container.textContent).not.toContain("Sidebar")
    expect(container.querySelector('[data-testid="resize-handle"]')).toBeNull()
    expect(container.textContent).toContain("Content")
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

  it("restores a persisted sidebar width", async () => {
    window.localStorage.setItem("synapse:app:ui:sidebar_width:v1:agent", "312")

    const container = await renderLayout({
      sidebarResizable: true,
      sidebarPersistenceId: "agent",
    })

    expect(container.querySelector("[data-default-size]")?.getAttribute("data-default-size"))
      .toBe("312")
  })

  it("persists the final sidebar width after the layout change completes", async () => {
    await renderLayout({
      sidebarResizable: true,
      sidebarPersistenceId: "agent",
    })

    resizableMocks.onSidebarResize?.({ inPixels: 318.4 })
    expect(window.localStorage.getItem("synapse:app:ui:sidebar_width:v1:agent")).toBeNull()

    resizableMocks.onLayoutChanged?.()
    expect(window.localStorage.getItem("synapse:app:ui:sidebar_width:v1:agent")).toBe("318")
  })

  it("keeps persistence records isolated by page", async () => {
    window.localStorage.setItem("synapse:app:ui:sidebar_width:v1:agent", "300")
    window.localStorage.setItem("synapse:app:ui:sidebar_width:v1:terminal", "340")

    const agent = await renderLayout({
      sidebarResizable: true,
      sidebarPersistenceId: "agent",
    })
    const terminal = await renderLayout({
      sidebarResizable: true,
      sidebarPersistenceId: "terminal",
    })

    expect(agent.querySelector("[data-default-size]")?.getAttribute("data-default-size"))
      .toBe("300")
    expect(terminal.querySelector("[data-default-size]")?.getAttribute("data-default-size"))
      .toBe("340")
  })

  it("clamps stored widths to the current sidebar constraints", async () => {
    window.localStorage.setItem("synapse:app:ui:sidebar_width:v1:editor_scan", "999")

    const container = await renderLayout({
      sidebarResizable: true,
      sidebarPersistenceId: "editor-scan",
      sidebarDefaultSize: 250,
      sidebarMinSize: 250,
      sidebarMaxSize: 360,
    })

    expect(container.querySelector("[data-default-size]")?.getAttribute("data-default-size"))
      .toBe("360")
  })

  it("falls back safely when persisted data is invalid or storage is unavailable", async () => {
    window.localStorage.setItem("synapse:app:ui:sidebar_width:v1:agent", "invalid")
    const invalid = await renderLayout({
      sidebarResizable: true,
      sidebarPersistenceId: "agent",
      sidebarDefaultSize: 240,
    })

    expect(invalid.querySelector("[data-default-size]")?.getAttribute("data-default-size"))
      .toBe("240")

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable")
    })
    const unavailable = await renderLayout({
      sidebarResizable: true,
      sidebarPersistenceId: "database",
      sidebarDefaultSize: 260,
    })

    expect(unavailable.querySelector("[data-default-size]")?.getAttribute("data-default-size"))
      .toBe("260")
  })

  it("keeps resizing usable when persisted data cannot be written", async () => {
    await renderLayout({
      sidebarResizable: true,
      sidebarPersistenceId: "agent",
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable")
    })

    resizableMocks.onSidebarResize?.({ inPixels: 320 })

    expect(() => resizableMocks.onLayoutChanged?.()).not.toThrow()
  })

  it("does not access persistence without a page identity", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem")
    const setItem = vi.spyOn(Storage.prototype, "setItem")

    await renderLayout({ sidebarResizable: true })

    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(resizableMocks.onSidebarResize).toBeUndefined()
    expect(resizableMocks.onLayoutChanged).toBeUndefined()
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
