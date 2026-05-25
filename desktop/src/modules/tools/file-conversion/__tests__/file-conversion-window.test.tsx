/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FileConversionWindow } from "../file-conversion-window"

const loggerWarn = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: toastSuccess,
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let bridgeMocks: ReturnType<typeof createBridgeMocks>

beforeEach(() => {
  bridgeMocks = createBridgeMocks()
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: bridgeMocks,
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("FileConversionWindow", () => {
  it("uses downloads as the default output directory before converting to markdown", async () => {
    renderWindow()
    await flushPromises()

    expect(document.body.textContent).not.toContain("文件转换")
    expect(buttonByText("转换").disabled).toBe(true)
    expect(document.body.textContent).toContain("/Users/test/Downloads")

    await act(async () => {
      buttonByText("添加文件").click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("report.docx")
    expect(buttonByText("转换").disabled).toBe(false)

    await act(async () => {
      buttonByText("转换").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.tools.fileConversion.convert).toHaveBeenCalledWith({
      filePaths: ["/tmp/report.docx"],
      outputDirectory: "/Users/test/Downloads",
    })
    expect(document.body.textContent).toContain("report.md")
    expect(toastSuccess).toHaveBeenCalledWith("已转换 1 个文件")

    await act(async () => {
      buttonByText("在文件夹中显示").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.shell.showItemInFolder).toHaveBeenCalledWith("/Users/test/Downloads/report.md")
  })

  it("passes the current output directory when choosing another folder", async () => {
    renderWindow()
    await flushPromises()

    await act(async () => {
      buttonByText("更改").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.tools.fileConversion.selectOutputDirectory).toHaveBeenCalledWith({
      defaultPath: "/Users/test/Downloads",
    })
    expect(document.body.textContent).toContain("/tmp/out")
  })

  it("adds supported dropped files and ignores unsupported files", async () => {
    renderWindow()
    await flushPromises()
    bridgeMocks.tools.fileConversion.filePathForDroppedFile
      .mockReturnValueOnce("/tmp/report.docx")
      .mockReturnValueOnce("/tmp/photo.png")
      .mockReturnValueOnce("/tmp/report.docx")

    const dropTarget = document.querySelector<HTMLElement>('[aria-label="文件转换窗口"]')
    if (!dropTarget) throw new Error("Drop target not found.")

    const dragOverEvent = new Event("dragover", { bubbles: true, cancelable: true })
    Object.defineProperty(dragOverEvent, "dataTransfer", {
      value: { dropEffect: "" },
    })

    await act(async () => {
      dropTarget.dispatchEvent(dragOverEvent)
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("松开添加文件")

    const dropEvent = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: {
        files: [
          new File(["doc"], "report.docx"),
          new File(["image"], "photo.png"),
          new File(["doc"], "report.docx"),
        ],
      },
    })

    await act(async () => {
      dropTarget.dispatchEvent(dropEvent)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("report.docx")
    expect(document.body.textContent).not.toContain("photo.png")
    expect(toastError).toHaveBeenCalledWith("仅支持 docx、xlsx、pdf、pptx 文件")
  })

  it("recovers controls after conversion fails", async () => {
    bridgeMocks.tools.fileConversion.convert.mockRejectedValueOnce(new Error("conversion failed"))
    renderWindow()
    await flushPromises()

    await act(async () => {
      buttonByText("添加文件").click()
      await Promise.resolve()
    })

    await act(async () => {
      buttonByText("转换").click()
      await Promise.resolve()
    })

    expect(toastError).toHaveBeenCalledWith("转换失败")
    expect(buttonByText("转换").disabled).toBe(false)
  })
})

function renderWindow() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<FileConversionWindow />)
  })
}

function createBridgeMocks() {
  return {
    shell: {
      showItemInFolder: vi.fn(async () => undefined),
    },
    tools: {
      fileConversion: {
        selectInputFiles: vi.fn(async () => ({ filePaths: ["/tmp/report.docx"] })),
        selectOutputDirectory: vi.fn(async () => ({ directoryPath: "/tmp/out" })),
        getDefaultOutputDirectory: vi.fn(async () => ({ directoryPath: "/Users/test/Downloads" })),
        filePathForDroppedFile: vi.fn<(file: File) => string | null>(() => null),
        convert: vi.fn(async () => ({
          successes: [{ sourcePath: "/tmp/report.docx", outputPath: "/Users/test/Downloads/report.md", warningCount: 0 }],
          failures: [],
        })),
      },
    },
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}
