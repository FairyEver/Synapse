/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let statusListener: ((event: { operationId: string; status: "waiting" | "running" }) => void) | undefined

const bridge = vi.hoisted(() => ({
  document: {
    choose: vi.fn(async () => "/tmp/report.pdf"),
    extract: vi.fn(async () => ({
      ok: true as const,
      result: {
        text: "完整正文",
        format: "pdf" as const,
        fileName: "report.pdf",
        size: 128,
        pages: 2,
      },
    })),
    cancel: vi.fn(async () => ({ cancelled: true })),
  },
  output: {
    choose: vi.fn(async () => "/tmp/report.txt"),
  },
  text: {
    save: vi.fn(async () => ({
      ok: true as const,
      result: {
        outputPath: "/tmp/report.txt",
        fileName: "report.txt",
        size: 12,
      },
    })),
  },
  operation: {
    onStatus: vi.fn((listener) => {
      statusListener = listener
      return () => undefined
    }),
  },
}))

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "textExtractor") return bridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("sonner", () => ({ toast }))

import { TextExtractorModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => {
  vi.clearAllMocks()
  statusListener = undefined
  bridge.operation.onStatus.mockImplementation((listener) => {
    statusListener = listener
    return () => undefined
  })
  bridge.document.choose.mockResolvedValue("/tmp/report.pdf")
  bridge.document.extract.mockResolvedValue({
    ok: true,
    result: {
      text: "完整正文",
      format: "pdf",
      fileName: "report.pdf",
      size: 128,
      pages: 2,
    },
  })
  bridge.document.cancel.mockResolvedValue({ cancelled: true })
  bridge.output.choose.mockResolvedValue("/tmp/report.txt")
  bridge.text.save.mockResolvedValue({
    ok: true,
    result: {
      outputPath: "/tmp/report.txt",
      fileName: "report.txt",
      size: 12,
    },
  })
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
})

describe("TextExtractorModule", () => {
  it("waits for an explicit action after choosing a document", async () => {
    renderModule()

    await clickButton("选择")

    expect(bridge.document.extract).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>("#text-extractor-path")?.value)
      .toBe("/tmp/report.pdf")

    await clickButton("提取文本")

    expect(bridge.document.extract).toHaveBeenCalledWith(expect.objectContaining({
      filePath: "/tmp/report.pdf",
    }))
    expect(document.body.textContent).toContain("PDF · 2 页")
    expect(document.body.textContent).toContain("12 B")
    expect(document.body.textContent).toContain("完整正文")
  })

  it("shows waiting and running states and cancels without an error toast", async () => {
    let resolveExtraction!: (value: unknown) => void
    bridge.document.extract.mockImplementation(() => new Promise((resolve) => {
      resolveExtraction = resolve
    }))
    renderModule()
    await clickButton("选择")

    await clickButton("提取文本")
    expect(document.body.textContent).toContain("等待提取")
    expect(document.querySelector("form")?.getAttribute("aria-busy")).toBe("true")
    expect(findButton("选择").disabled).toBe(true)
    expect(document.querySelector<HTMLInputElement>("#text-extractor-path")?.disabled).toBe(true)
    expect(document.body.textContent).not.toMatch(/\d+%/u)

    const request = bridge.document.extract.mock.calls[0]?.[0]
    await act(async () => {
      statusListener?.({ operationId: request.operationId, status: "running" })
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("提取中")

    await clickButton("取消提取")
    expect(bridge.document.cancel).toHaveBeenCalledWith({ operationId: request.operationId })
    expect(document.body.textContent).toContain("已取消")
    expect(toast.error).not.toHaveBeenCalled()

    await act(async () => {
      resolveExtraction({
        ok: false,
        error: { code: "EXTRACTION_CANCELLED", message: "文本提取已取消。" },
      })
      await Promise.resolve()
    })
  })

  it("limits the preview while copying and saving the full UTF-8 text", async () => {
    const fullText = `${"a".repeat(200 * 1024 - 1)}完整尾部`
    bridge.document.extract.mockResolvedValue({
      ok: true,
      result: {
        text: fullText,
        format: "docx",
        fileName: "report.docx",
        size: 300_000,
      },
    })
    renderModule()
    await clickButton("选择")
    await clickButton("提取文本")

    const preview = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='提取文本预览']")
    expect(preview?.value).toBe("a".repeat(200 * 1024 - 1))
    expect(preview?.value).not.toContain("完整尾部")
    expect(document.body.textContent).toContain("仅显示前 200 KiB，复制和保存包含完整文本")

    await clickButton("复制文本")
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(fullText)
    expect(toast.success).toHaveBeenCalledWith("已复制")

    await clickButton("保存文本")
    expect(bridge.output.choose).toHaveBeenCalledWith({ defaultPath: "report.txt" })
    expect(bridge.text.save).toHaveBeenCalledWith({ outputPath: "/tmp/report.txt", text: fullText })
    expect(toast.success).toHaveBeenCalledWith("已保存")
  })

  it("shows an empty successful result and disables copy and save", async () => {
    bridge.document.extract.mockResolvedValue({
      ok: true,
      result: {
        text: "",
        format: "pdf",
        fileName: "scan.pdf",
        size: 256,
        pages: 1,
      },
    })
    renderModule()
    await clickButton("选择")
    await clickButton("提取文本")

    expect(document.body.textContent).toContain("未提取到文本")
    expect(findButton("复制文本").disabled).toBe(true)
    expect(findButton("保存文本").disabled).toBe(true)
    expect(document.querySelector("[role='alert']")).toBeNull()
  })

  it("shows the stable path-free save error returned by the main process", async () => {
    bridge.text.save.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "WRITE_FAILED",
        message: "保存文本失败。",
      },
    })
    renderModule()
    await clickButton("选择")
    await clickButton("提取文本")

    await clickButton("保存文本")

    expect(toast.error).toHaveBeenCalledWith("保存文本失败。")
    expect(JSON.stringify(toast.error.mock.calls)).not.toContain("/tmp/report.txt")
  })

  it("shows a concise extraction error and clears it when another file is chosen", async () => {
    bridge.document.extract.mockResolvedValue({
      ok: false,
      error: { code: "INVALID_DOCUMENT", message: "文档格式无效或文件已损坏。" },
    })
    renderModule()
    await clickButton("选择")
    await clickButton("提取文本")

    expect(document.body.textContent).toContain("文档格式无效或文件已损坏。")
    expect(document.querySelector("[role='alert']")).toBeInstanceOf(HTMLElement)

    bridge.document.choose.mockResolvedValueOnce("/tmp/next.docx")
    await clickButton("选择")
    expect(document.body.textContent).not.toContain("文档格式无效或文件已损坏。")
    expect(document.querySelector<HTMLInputElement>("#text-extractor-path")?.value)
      .toBe("/tmp/next.docx")
  })

  it("clears a successful result as soon as a new extraction starts", async () => {
    renderModule()
    await clickButton("选择")
    await clickButton("提取文本")
    expect(document.body.textContent).toContain("完整正文")

    bridge.document.extract.mockImplementationOnce(() => new Promise(() => undefined))
    await clickButton("提取文本")

    expect(document.body.textContent).toContain("等待提取")
    expect(document.body.textContent).not.toContain("完整正文")
    expect(document.querySelector("textarea[aria-label='提取文本预览']")).toBeNull()
  })

  it("requests cancellation when the renderer module unmounts during extraction", async () => {
    bridge.document.extract.mockImplementationOnce(() => new Promise(() => undefined))
    const root = renderModule()
    await clickButton("选择")
    await clickButton("提取文本")
    const operationId = bridge.document.extract.mock.calls[0]?.[0]?.operationId

    act(() => root.unmount())
    roots = roots.filter((candidate) => candidate !== root)

    expect(bridge.document.cancel).toHaveBeenCalledWith({ operationId })
  })

  it("keeps the single-task UI keyboard and screen-reader accessible", () => {
    renderModule()

    expect(document.querySelector("[role='tab']")).toBeNull()
    expect(document.querySelector("[role='status'][aria-live='polite']")).toBeInstanceOf(HTMLElement)
    expect(document.querySelector("button[aria-label='选择文档文件']")).toBeInstanceOf(HTMLButtonElement)
    const input = document.querySelector<HTMLInputElement>("#text-extractor-path")
    expect(input?.readOnly).toBe(true)
    expect(document.querySelector("label[for='text-extractor-path']")).toBeInstanceOf(HTMLLabelElement)
    expect(findButton("提取文本").type).toBe("submit")
    expect(findButton("选择").type).toBe("button")
    expect(document.querySelector("[draggable='true']")).toBeNull()
  })
})

function renderModule(): Root {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  act(() => root.render(<TextExtractorModule />))
  return root
}

async function clickButton(label: string): Promise<void> {
  const button = findButton(label)
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === label)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`)
  return button
}
