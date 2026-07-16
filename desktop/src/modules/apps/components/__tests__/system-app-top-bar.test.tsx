/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  SystemAppTopBar,
  SystemAppTopBarActionButton,
  SystemAppTopBarActions,
} from "../system-app-top-bar"

describe("SystemAppTopBar", () => {
  const roots: Root[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount()
      })
    }
    document.body.innerHTML = ""
  })

  it("keeps center content in a stable three-column header", async () => {
    await renderTopBar(roots, (
      <SystemAppTopBar
        left={<h2>工作流</h2>}
        center={<div data-testid="tabs">任务</div>}
        actions={<SystemAppTopBarActionButton onClick={vi.fn()}>刷新</SystemAppTopBarActionButton>}
      />
    ))

    const toolbar = document.querySelector("[data-system-app-top-bar]")
    expect(toolbar?.className).toContain("grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)]")
    expect(document.querySelector("[data-system-app-top-bar-left]")?.textContent).toContain("工作流")
    expect(document.querySelector("[data-system-app-top-bar-center]")?.textContent).toContain("任务")
    expect(document.querySelector("[data-system-app-top-bar-actions]")?.textContent).toContain("刷新")
  })

  it("renders top bar action buttons as borderless compact ghost controls", async () => {
    await renderTopBar(roots, (
      <SystemAppTopBarActions>
        <SystemAppTopBarActionButton onClick={vi.fn()}>新建任务</SystemAppTopBarActionButton>
        <SystemAppTopBarActionButton iconOnly aria-label="新窗口打开" onClick={vi.fn()} />
      </SystemAppTopBarActions>
    ))

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    const actionGroup = document.querySelector("[data-system-app-top-bar-action-group]")
    expect(actionGroup?.className).toContain("gap-0")
    expect(actionGroup?.className).not.toContain("gap-3")
    expect(buttons[0]?.getAttribute("data-variant")).toBe("ghost")
    expect(buttons[0]?.getAttribute("data-size")).toBe("sm")
    expect(buttons[0]?.className).toContain("after:absolute")
    expect(buttons[0]?.className).toContain("after:-inset-y-1.5")
    expect(buttons[0]?.className).toContain("after:inset-x-0")
    expect(buttons[1]?.getAttribute("data-variant")).toBe("ghost")
    expect(buttons[1]?.getAttribute("data-size")).toBe("icon-sm")
  })

  it("keeps destructive top bar actions borderless", async () => {
    await renderTopBar(roots, (
      <SystemAppTopBarActionButton tone="destructive" onClick={vi.fn()}>
        删除任务
      </SystemAppTopBarActionButton>
    ))

    const button = document.querySelector<HTMLButtonElement>("button")
    expect(button?.getAttribute("data-variant")).toBe("ghost")
    expect(button?.className).toContain("text-destructive")
    expect(button?.className).not.toContain("bg-destructive/10")
  })
})

async function renderTopBar(roots: Root[], element: React.ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(element)
    await Promise.resolve()
  })
}
