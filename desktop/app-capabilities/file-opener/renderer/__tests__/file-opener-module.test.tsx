/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const bridge = vi.hoisted(() => ({
  file: { open: vi.fn(async (input: { path: string }) => input) },
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "fileOpener") return bridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

import { FileOpenerModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

beforeEach(() => vi.clearAllMocks())

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ""
})

describe("FileOpenerModule", () => {
  it("opens the entered absolute path and keeps it after success", async () => {
    root = createRoot(document.body.appendChild(document.createElement("div")))
    act(() => root?.render(<FileOpenerModule />))
    const input = document.querySelector<HTMLInputElement>("#file-opener-path")!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "/tmp/report.docx")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>("button[type='submit']")?.click()
      await Promise.resolve()
    })

    expect(bridge.file.open).toHaveBeenCalledWith({ path: "/tmp/report.docx" })
    expect(input.value).toBe("/tmp/report.docx")
    expect(document.body.textContent).toContain("已提交打开请求")
  })
})

