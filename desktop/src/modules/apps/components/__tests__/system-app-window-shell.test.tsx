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
      <SystemAppWindowShell
        left={<h2>应用标题</h2>}
        actions={<button type="button">右侧操作</button>}
      >
        <div>内容</div>
      </SystemAppWindowShell>
    ))

    const toolbar = document.querySelector("[data-system-app-window-toolbar]")
    expect(toolbar?.className).toContain("grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)]")
    expect(document.querySelector("[data-system-app-window-left]")?.textContent).toContain("应用标题")
    expect(document.querySelector("[data-system-app-window-tabs]")).toBeNull()
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).toContain("右侧操作")
  })

  it("does not render an empty toolbar for single-view windows", async () => {
    await renderShell(roots, (
      <SystemAppWindowShell>
        <div>内容</div>
      </SystemAppWindowShell>
    ))

    expect(document.querySelector("[data-system-app-window-toolbar]")).toBeNull()
    expect(document.body.textContent).toContain("内容")
  })

  it("registers tabs and actions with the embedded header instead of rendering its own toolbar", async () => {
    const onValueChange = vi.fn()

    await renderShell(roots, (
      <EmbeddedSystemAppShell appName="资源仓库" mode="launcher" onBack={vi.fn()} onOpenWindow={vi.fn()}>
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

  it("keeps the embedded app name and suppresses the standalone left title", async () => {
    await renderShell(roots, (
      <EmbeddedSystemAppShell appName="工作流" mode="launcher" onBack={vi.fn()} onOpenWindow={vi.fn()}>
        <SystemAppWindowShell
          left={<h2>工作流</h2>}
          actions={<button type="button">新建</button>}
        >
          <div>内容</div>
        </SystemAppWindowShell>
      </EmbeddedSystemAppShell>
    ))

    expect(document.querySelectorAll("[data-system-app-top-bar]")).toHaveLength(1)
    expect(document.querySelector("[data-embedded-system-app-left]")?.textContent).toContain("工作流")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("新建")
    expect(document.querySelector("[data-system-app-window-toolbar]")).toBeNull()
    expect(document.body.textContent?.match(/工作流/g)).toHaveLength(1)
  })

  it("clears the embedded header slot when the system app shell unmounts", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <EmbeddedSystemAppShell appName="资源仓库" mode="launcher" onBack={vi.fn()} onOpenWindow={vi.fn()}>
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
        <EmbeddedSystemAppShell appName="资源仓库" mode="launcher" onBack={vi.fn()} onOpenWindow={vi.fn()}>
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
