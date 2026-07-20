/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

const documentTemplateBridge = vi.hoisted(() => ({
  template: { choose: vi.fn(async () => "/tmp/template.docx") },
  json: { choose: vi.fn(async () => "/tmp/data.json") },
  output: { choose: vi.fn(async () => "/tmp/output.docx") },
  docx: {
    generate: vi.fn(async () => ({
      outputPath: "/tmp/output.docx",
      fileName: "output.docx",
      size: 123,
      generatedAt: "2026-06-23T00:00:00.000Z",
    })),
  },
}))

const shellBridge = vi.hoisted(() => ({
  showItemInFolder: vi.fn(async () => undefined),
}))

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "documentTemplate") return documentTemplateBridge
    if (domain === "shell") return shellBridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("sonner", () => ({ toast }))

import { DocumentTemplateModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => {
  documentTemplateBridge.template.choose.mockClear()
  documentTemplateBridge.json.choose.mockClear()
  documentTemplateBridge.output.choose.mockClear()
  documentTemplateBridge.docx.generate.mockClear()
  shellBridge.showItemInFolder.mockClear()
  toast.error.mockClear()
  toast.success.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("DocumentTemplateModule", () => {
  it("generates from a JSON file", async () => {
    renderModule()

    await clickButton("选择", 0)
    await clickButton("选择", 1)
    await clickButton("选择", 2)
    await clickButton("生成文档")

    expect(documentTemplateBridge.docx.generate).toHaveBeenCalledWith({
      templatePath: "/tmp/template.docx",
      dataPath: "/tmp/data.json",
      outputPath: "/tmp/output.docx",
      overwrite: false,
    })
    expect(toast.success).toHaveBeenCalledWith("生成完成")
    expect(document.body.textContent).toContain("生成完成")
  })

  it("reveals the generated file in its folder", async () => {
    renderModule()

    await clickButton("选择", 0)
    await clickButton("选择", 1)
    await clickButton("选择", 2)
    await clickButton("生成文档")
    await clickButton("在文件夹中查看")

    expect(shellBridge.showItemInFolder).toHaveBeenCalledWith("/tmp/output.docx")
  })

  it("generates from inline JSON object", async () => {
    renderModule()

    await clickButton("选择", 0)
    await clickLabel("内联")
    await clickButton("选择", 1)
    await changeTextarea('{"name":"Ada"}')
    await clickButton("生成文档")

    expect(documentTemplateBridge.docx.generate).toHaveBeenCalledWith({
      templatePath: "/tmp/template.docx",
      data: { name: "Ada" },
      outputPath: "/tmp/output.docx",
      overwrite: false,
    })
  })

  it("shows an inline JSON error without generating", async () => {
    renderModule()

    await clickButton("选择", 0)
    await clickLabel("内联")
    await clickButton("选择", 1)
    await changeTextarea("[]")
    await clickButton("生成文档")

    expect(documentTemplateBridge.docx.generate).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("JSON 数据必须是对象")
    expect(document.body.textContent).toContain("JSON 数据必须是对象")
  })
})

function renderModule(): void {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  act(() => {
    root.render(<DocumentTemplateModule />)
  })
}

async function clickButton(text: string, index = 0): Promise<void> {
  const buttons = Array.from(document.body.querySelectorAll("button"))
    .filter((button) => button.textContent === text)
  await act(async () => {
    buttons[index]?.click()
    await Promise.resolve()
  })
}

async function clickLabel(text: string): Promise<void> {
  const label = Array.from(document.body.querySelectorAll("label"))
    .find((item) => item.textContent === text)
  await act(async () => {
    label?.click()
    await Promise.resolve()
  })
}

async function changeTextarea(value: string): Promise<void> {
  const textarea = document.body.querySelector("textarea")
  await act(async () => {
    if (!textarea) throw new Error("Textarea not found")
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    valueSetter?.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    await Promise.resolve()
  })
}
