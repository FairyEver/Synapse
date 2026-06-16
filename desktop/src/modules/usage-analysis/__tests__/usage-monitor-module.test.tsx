/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UsageMonitorModule } from "../index"

vi.mock("../cc/cc-usage-page", () => ({
  CcUsagePage: () => <div>CC 内容</div>,
}))

vi.mock("../codex/codex-usage-page", () => ({
  CodexUsagePage: () => <div>Codex 内容</div>,
}))

describe("UsageMonitorModule", () => {
  const roots: Root[] = []

  beforeEach(() => {
    document.body.innerHTML = ""
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("defaults to CC and switches to Codex", async () => {
    await renderUsageMonitor(roots)

    expect(document.body.textContent).toContain("CC 内容")

    await clickButton("Codex")
    expect(document.body.textContent).toContain("Codex 内容")
  })
})

async function renderUsageMonitor(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<UsageMonitorModule />)
    await Promise.resolve()
  })
}

async function clickButton(label: string): Promise<void> {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent?.trim() === label)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    button.click()
    await Promise.resolve()
  })
}
