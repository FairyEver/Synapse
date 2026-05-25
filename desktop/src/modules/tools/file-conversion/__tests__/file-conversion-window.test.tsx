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
  it("selects files and output directory before converting to markdown", async () => {
    renderWindow()

    expect(buttonByText("转换").disabled).toBe(true)

    await act(async () => {
      buttonByText("选择文件").click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("report.docx")

    await act(async () => {
      buttonByText("选择目录").click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("/tmp/out")
    expect(buttonByText("转换").disabled).toBe(false)

    await act(async () => {
      buttonByText("转换").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.tools.fileConversion.convert).toHaveBeenCalledWith({
      filePaths: ["/tmp/report.docx"],
      outputDirectory: "/tmp/out",
    })
    expect(document.body.textContent).toContain("report.md")
    expect(toastSuccess).toHaveBeenCalledWith("已转换 1 个文件")
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
    tools: {
      fileConversion: {
        selectInputFiles: vi.fn(async () => ({ filePaths: ["/tmp/report.docx"] })),
        selectOutputDirectory: vi.fn(async () => ({ directoryPath: "/tmp/out" })),
        convert: vi.fn(async () => ({
          successes: [{ sourcePath: "/tmp/report.docx", outputPath: "/tmp/out/report.md", warningCount: 0 }],
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
