/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SystemAppWindowShell } from "../system-app-window-shell"

const tabs = [
  { id: "one", label: "一" },
  { id: "two", label: "二" },
] as const

describe("SystemAppWindowShell", () => {
  const roots: Root[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount()
      })
    }
    document.body.innerHTML = ""
  })

  it("centers window tabs with a stable three-column toolbar", async () => {
    const onValueChange = vi.fn()

    await renderShell(roots, (
      <SystemAppWindowShell
        tabs={tabs}
        value="one"
        onValueChange={onValueChange}
        actions={<button type="button">右侧操作</button>}
      >
        <div>内容</div>
      </SystemAppWindowShell>
    ))

    const toolbar = document.querySelector("[data-system-app-window-toolbar]")
    expect(toolbar?.className).toContain("grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)]")
    expect(document.querySelector("[data-system-app-window-left-spacer]")).toBeTruthy()
    expect(document.querySelector("[data-system-app-window-tabs]")?.textContent).toContain("一")
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).toContain("右侧操作")
    expect(document.querySelector("[data-system-app-window-tabs]")?.parentElement).toBe(toolbar)
  })
})

async function renderShell(roots: Root[], element: React.ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(element)
    await Promise.resolve()
  })
}
