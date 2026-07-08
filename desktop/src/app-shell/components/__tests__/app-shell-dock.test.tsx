/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppShellDock } from "../app-shell-dock"

const apps = [
  { id: "agent", name: "对话", icon: "/agent.png" },
  { id: "drive", name: "云盘", icon: "/drive.png" },
  { id: "launcher", name: "应用", icon: "/launcher.png" },
] as const

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("AppShellDock", () => {
  const roots: Root[] = []

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => {
        root.unmount()
        await Promise.resolve()
      })
    }
    document.body.innerHTML = ""
  })

  it("renders pinned app icon buttons and switches active app", async () => {
    const onValueChange = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AppShellDock apps={apps} value="agent" onValueChange={onValueChange} />)
      await Promise.resolve()
    })

    const activeButton = findButtonByLabel("对话")
    expect(activeButton.getAttribute("aria-current")).toBe("page")
    expect(activeButton.className).toContain("size-12")
    const activeIndicator = activeButton.querySelector("[data-slot='app-shell-dock-active-indicator']")
    expect(activeIndicator?.getAttribute("aria-hidden")).toBe("true")
    expect(activeIndicator?.className).toContain("size-1")
    expect(activeIndicator?.className).toContain("bottom-0")
    expect(findButtonByLabel("应用").querySelector("[data-slot='app-shell-dock-active-indicator']")).toBeNull()

    await act(async () => {
      findButtonByLabel("应用").click()
      await Promise.resolve()
    })

    expect(onValueChange).toHaveBeenCalledWith("launcher")
  })

  it("does not expose drag affordances", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AppShellDock apps={apps} value="agent" onValueChange={vi.fn()} />)
      await Promise.resolve()
    })

    const nav = document.querySelector("[data-track='app-shell-dock']")
    expect(nav?.getAttribute("draggable")).toBeNull()
    expect(findButtonByLabel("对话").getAttribute("draggable")).toBeNull()
  })

  it("handles app actions from the Dock context menu", async () => {
    const onManageDock = vi.fn()
    const onRemoveApp = vi.fn()
    const onValueChange = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AppShellDock
          apps={apps}
          value="agent"
          onValueChange={onValueChange}
          onRemoveApp={onRemoveApp}
          onManageDock={onManageDock}
        />,
      )
      await Promise.resolve()
    })

    await act(async () => {
      openContextMenuByButtonLabel("云盘")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("打开")
    expect(document.body.textContent).toContain("从 Dock 移除")
    expect(document.body.textContent).toContain("管理 Dock")

    await act(async () => {
      findMenuItem("打开").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onValueChange).toHaveBeenCalledWith("drive")

    await act(async () => {
      openContextMenuByButtonLabel("云盘")
      await Promise.resolve()
    })
    await act(async () => {
      findMenuItem("从 Dock 移除").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onRemoveApp).toHaveBeenCalledWith("drive")

    await act(async () => {
      openContextMenuByButtonLabel("云盘")
      await Promise.resolve()
    })
    await act(async () => {
      findMenuItem("管理 Dock").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onManageDock).toHaveBeenCalledTimes(1)
  })

  it("keeps launcher protected in the Dock context menu", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AppShellDock
          apps={apps}
          value="agent"
          onValueChange={vi.fn()}
          onRemoveApp={vi.fn()}
          onManageDock={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    await act(async () => {
      openContextMenuByButtonLabel("应用")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("管理 Dock")
    expect(document.body.textContent).not.toContain("从 Dock 移除")
  })

  it("reports clicks on the currently active app icon", async () => {
    const onValueChange = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AppShellDock apps={apps} value="launcher" onValueChange={onValueChange} />)
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByLabel("应用").click()
      await Promise.resolve()
    })

    expect(onValueChange).toHaveBeenCalledWith("launcher")
  })
})

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label='${label}']`)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}

function findMenuItem(label: string): HTMLElement {
  const item = Array.from(document.querySelectorAll("[role='menuitem']")).find((element) => element.textContent?.includes(label))

  if (!(item instanceof HTMLElement)) {
    throw new Error(`Menu item not found: ${label}`)
  }

  return item
}

function openContextMenuByButtonLabel(label: string): void {
  findButtonByLabel(label).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }))
}
