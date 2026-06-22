/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EmbeddedSystemAppShell } from "../embedded-system-app-shell"
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

  it("keeps actions in the toolbar when a window has no tabs", async () => {
    await renderShell(roots, (
      <SystemAppWindowShell actions={<button type="button">右侧操作</button>}>
        <div>内容</div>
      </SystemAppWindowShell>
    ))

    const toolbar = document.querySelector("[data-system-app-window-toolbar]")
    expect(toolbar?.className).toContain("grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)]")
    expect(document.querySelector("[data-system-app-window-left-spacer]")).toBeTruthy()
    expect(document.querySelector("[data-system-app-window-tabs]")).toBeNull()
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).toContain("右侧操作")
  })

  it("registers tabs and actions with the embedded header instead of rendering its own toolbar", async () => {
    const onValueChange = vi.fn()

    await renderShell(roots, (
      <EmbeddedSystemAppShell appName="资源仓库" onBack={vi.fn()} onOpenWindow={vi.fn()}>
        <SystemAppWindowShell
          tabs={tabs}
          value="one"
          onValueChange={onValueChange}
          actions={<button type="button">右侧操作</button>}
        >
          <div>内容</div>
        </SystemAppWindowShell>
      </EmbeddedSystemAppShell>
    ))

    expect(document.querySelector("[data-system-app-window-toolbar]")).toBeNull()
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("一")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("右侧操作")
    expect(document.body.textContent).toContain("内容")
  })

  it("clears the embedded header slot when the system app shell unmounts", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <EmbeddedSystemAppShell appName="资源仓库" onBack={vi.fn()} onOpenWindow={vi.fn()}>
          <SystemAppWindowShell
            tabs={tabs}
            value="one"
            onValueChange={vi.fn()}
            actions={<button type="button">右侧操作</button>}
          >
            <div>内容</div>
          </SystemAppWindowShell>
        </EmbeddedSystemAppShell>,
      )
      await Promise.resolve()
    })

    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("一")

    await act(async () => {
      root.render(
        <EmbeddedSystemAppShell appName="资源仓库" onBack={vi.fn()} onOpenWindow={vi.fn()}>
          <div>应用列表</div>
        </EmbeddedSystemAppShell>,
      )
      await Promise.resolve()
    })

    expect(document.querySelector("[data-embedded-system-app-tabs]")).toBeNull()
    expect(document.body.textContent).toContain("应用列表")
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
