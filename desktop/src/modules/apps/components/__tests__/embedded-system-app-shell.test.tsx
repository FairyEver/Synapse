/**
 * @vitest-environment jsdom
 */
import React, { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EmbeddedSystemAppShell } from "../embedded-system-app-shell"
import { useSystemAppHeaderSlot } from "../system-app-header-slot"

const DEFAULT_SLOT_ACTIONS = <button type="button">右侧操作</button>

function SlotWriter({
  actions = DEFAULT_SLOT_ACTIONS,
}: {
  readonly actions?: React.ReactNode
}) {
  const { setSlot } = useSystemAppHeaderSlot()

  useEffect(() => {
    setSlot({
      tabs: [
        { id: "one", label: "一" },
        { id: "two", label: "二" },
      ],
      value: "one",
      onValueChange: vi.fn(),
      actions,
    })
    return () => setSlot(null)
  }, [actions, setSlot])

  return <div>内容</div>
}

describe("EmbeddedSystemAppShell", () => {
  const roots: Root[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount()
      })
    }
    document.body.innerHTML = ""
  })

  it("renders registered app tabs in the centered embedded header", async () => {
    await renderEmbeddedShell(roots, <SlotWriter />)

    const header = document.querySelector("[data-embedded-system-app-header]")
    const tabs = document.querySelector("[data-embedded-system-app-tabs]")
    expect(header?.className).toContain("grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)]")
    expect(tabs?.textContent).toContain("一")
    expect(tabs?.textContent).toContain("二")
    expect(tabs?.parentElement).toBe(header)
  })

  it("renders registered app actions before the open window action", async () => {
    await renderEmbeddedShell(roots, <SlotWriter />)

    const actions = document.querySelector("[data-embedded-system-app-actions]")
    expect(actions?.textContent).toContain("右侧操作")
    expect(actions?.querySelector("button[aria-label='新窗口打开']")).toBeTruthy()
    const buttons = Array.from(actions?.querySelectorAll("button") ?? [])
    expect(buttons[0]?.textContent).toContain("右侧操作")
    expect(buttons.at(-1)?.getAttribute("aria-label")).toBe("新窗口打开")
    expect(buttons.at(-1)?.getAttribute("data-size")).toBe("icon")
  })

  it("keeps only the open window action when no slot is registered", async () => {
    await renderEmbeddedShell(roots, <div>内容</div>)

    expect(document.querySelector("[data-embedded-system-app-tabs]")).toBeNull()
    expect(document.querySelector("[data-embedded-system-app-actions] button[aria-label='新窗口打开']")).toBeTruthy()
  })

  it("hides the dock header when no app slot is registered", async () => {
    await renderEmbeddedShell(roots, <div>内容</div>, { mode: "dock" })

    expect(document.querySelector("[data-embedded-system-app-header]")).toBeNull()
    expect(document.body.textContent).toContain("内容")
  })

  it("renders app slot in dock mode without launcher actions", async () => {
    await renderEmbeddedShell(roots, <SlotWriter />, { mode: "dock" })

    const header = document.querySelector("[data-embedded-system-app-header]")
    expect(header).toBeTruthy()
    expect(document.querySelector("[data-embedded-system-app-left] button[aria-label='返回应用列表']")).toBeNull()
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("一")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("右侧操作")
    expect(document.querySelector("[data-embedded-system-app-actions] button[aria-label='新窗口打开']")).toBeNull()
  })
})

async function renderEmbeddedShell(
  roots: Root[],
  children: React.ReactNode,
  options: { readonly mode?: "launcher" | "dock" } = {},
): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <EmbeddedSystemAppShell
        appName="资源仓库"
        mode={options.mode}
        onBack={vi.fn()}
        onOpenWindow={vi.fn()}
      >
        {children}
      </EmbeddedSystemAppShell>,
    )
    await Promise.resolve()
  })
}
