/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const outputPath = "/tmp/existing.md"
const textFileWriterBridge = vi.hoisted(() => ({
  output: { choose: vi.fn(async () => outputPath) },
  file: {
    write: vi.fn(async () => ({
      ok: true as const,
      result: {
        path: outputPath,
        fileName: "existing.md",
        format: "md" as const,
        encoding: "utf8" as const,
        size: 5,
        overwritten: false,
      },
    })),
  },
}))

const shellBridge = vi.hoisted(() => ({ showItemInFolder: vi.fn(async () => undefined) }))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "textFileWriter") return textFileWriterBridge
    if (domain === "shell") return shellBridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

import { TextFileWriterModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
})

describe("TextFileWriterModule", () => {
  it("submits the complete manual text and path with safe defaults", async () => {
    renderModule()
    const textarea = document.querySelector("textarea")
    expect(textarea?.maxLength).toBe(-1)
    await changeValue(textarea, "hello")
    await changeValue(document.querySelector("input#text-file-writer-path"), outputPath)
    await clickButton("写入文件")

    expect(textFileWriterBridge.file.write).toHaveBeenCalledWith({
      text: "hello",
      path: outputPath,
      encoding: "utf8",
      overwrite: false,
    })
    expect(document.body.textContent).toContain("已写入 5 字节")
  })

  it("does not infer overwrite from the save dialog result", async () => {
    renderModule()
    await changeValue(document.querySelector("textarea"), "hello")
    await clickButton("选择")
    await clickButton("写入文件")

    expect(textFileWriterBridge.output.choose).toHaveBeenCalledWith({ defaultPath: "output.md" })
    expect(textFileWriterBridge.file.write).toHaveBeenCalledWith(expect.objectContaining({
      path: outputPath,
      overwrite: false,
    }))
  })

  it("shows a stable shared error message", async () => {
    textFileWriterBridge.file.write.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "TARGET_EXISTS",
        message: "目标文件已存在，请启用覆盖后重试。",
        retryable: false,
      },
    } as never)
    renderModule()
    await changeValue(document.querySelector("textarea"), "hello")
    await changeValue(document.querySelector("input#text-file-writer-path"), outputPath)
    await clickButton("写入文件")

    expect(document.body.textContent).toContain("目标文件已存在，请启用覆盖后重试。")
  })
})

function renderModule(): void {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  act(() => root.render(<TextFileWriterModule />))
}

async function clickButton(text: string): Promise<void> {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent === text)
  await act(async () => {
    button?.click()
    await Promise.resolve()
  })
}

async function changeValue(element: Element | null, value: string): Promise<void> {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error("Form control not found.")
  }
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
    await Promise.resolve()
  })
}
