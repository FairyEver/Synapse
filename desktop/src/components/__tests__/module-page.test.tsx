/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ModulePage } from "../module-page"
import { EmbeddedSystemAppShell } from "@/modules/apps/components/embedded-system-app-shell"

describe("ModulePage", () => {
  const roots: Root[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount()
      })
    }
    document.body.innerHTML = ""
  })

  it("moves its actions into the embedded app header without rendering a second top bar", async () => {
    await renderPage(roots, (
      <EmbeddedSystemAppShell appName="工作流" mode="launcher" onBack={vi.fn()} onOpenWindow={vi.fn()}>
        <ModulePage
          title="工作流"
          titleAddon={<span>10 GB</span>}
          actions={<button type="button">新建</button>}
        >
          <div>列表</div>
        </ModulePage>
      </EmbeddedSystemAppShell>
    ))

    expect(document.querySelectorAll("[data-system-app-top-bar]")).toHaveLength(1)
    expect(document.querySelector("[data-embedded-system-app-left]")?.textContent).toContain("10 GB")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("新建")
    expect(document.body.textContent?.match(/工作流/g)).toHaveLength(1)
    expect(document.body.textContent).toContain("列表")
  })

  it("keeps its title and actions in standalone mode", async () => {
    await renderPage(roots, (
      <ModulePage title="工作流" actions={<button type="button">新建</button>}>
        <div>列表</div>
      </ModulePage>
    ))

    expect(document.querySelector("[data-system-app-window-left]")?.textContent).toContain("工作流")
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).toContain("新建")
    expect(document.body.textContent).toContain("列表")
  })
})

async function renderPage(roots: Root[], element: React.ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(element)
    await Promise.resolve()
  })
}
