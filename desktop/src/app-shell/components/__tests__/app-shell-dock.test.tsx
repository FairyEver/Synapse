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
})

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label='${label}']`)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}
