// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AutomationEditorApp } from "../editor-app"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const createItem = vi.fn()
const updateItem = vi.fn()
const getItem = vi.fn()

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: () => ({
    getItem,
    createItem,
    updateItem,
  }),
}))

describe("AutomationEditorApp", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
    window.history.replaceState(null, "", "/")
  })

  it("shows trigger and executor lists in create mode", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    expect(document.body.textContent).toContain("当以下情况发生时")
    expect(document.body.textContent).toContain("Cron")
    expect(document.body.textContent).toContain("固定间隔")
    expect(document.body.textContent).toContain("就执行以下操作")
    expect(document.body.textContent).toContain("命令")
    expect(document.body.textContent).toContain("Agent")
  })

  it("switches selected trigger back to list with reselect", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Cron"))?.click()
    })

    expect(document.body.textContent).toContain("Cron 表达式")

    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "重新选择")?.click()
    })

    expect(document.body.textContent).toContain("固定间隔")
  })
})
