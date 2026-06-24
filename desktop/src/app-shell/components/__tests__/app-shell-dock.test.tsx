/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppShellDock } from "../app-shell-dock"

const apps = [
  { id: "agent", name: "对话", icon: "/agent.png" },
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
    const activeIndicator = activeButton.querySelector("[data-slot='app-shell-dock-active-indicator']")
    expect(activeIndicator?.getAttribute("aria-hidden")).toBe("true")
    expect(findButtonByLabel("应用").querySelector("[data-slot='app-shell-dock-active-indicator']")).toBeNull()

    await act(async () => {
      findButtonByLabel("应用").click()
      await Promise.resolve()
    })

    expect(onValueChange).toHaveBeenCalledWith("launcher")
  })

  it("pins an app dropped from the launcher", async () => {
    const onPinApp = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AppShellDock apps={apps} value="agent" onValueChange={vi.fn()} onPinApp={onPinApp} />)
      await Promise.resolve()
    })

    const nav = document.querySelector("[data-track='app-shell-dock']")
    const dataTransfer = createDataTransfer("database")

    await act(async () => {
      nav?.dispatchEvent(createDragEvent("dragover", dataTransfer))
      nav?.dispatchEvent(createDragEvent("drop", dataTransfer))
      await Promise.resolve()
    })

    expect(onPinApp).toHaveBeenCalledWith("database")
  })

  it("marks only removable Dock apps as unpinnable", async () => {
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
          canUnpinApp={(appId) => appId === "launcher"}
          onUnpinApp={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    expect(findButtonByLabel("对话").getAttribute("data-can-unpin")).toBeNull()
    expect(findButtonByLabel("应用").getAttribute("data-can-unpin")).toBe("true")
  })
})

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label='${label}']`)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}

function createDragEvent(type: string, dataTransfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  return event
}

function createDataTransfer(appId: string): DataTransfer {
  return {
    getData: vi.fn((type: string) => type === "application/x-synapse-system-app-id" ? appId : ""),
    setData: vi.fn(),
    clearData: vi.fn(),
    dropEffect: "move",
    effectAllowed: "move",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: ["application/x-synapse-system-app-id"],
    setDragImage: vi.fn(),
  } as unknown as DataTransfer
}
