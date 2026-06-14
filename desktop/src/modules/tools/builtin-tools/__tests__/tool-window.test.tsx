/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseToolRunPayload, SynapseToolRunResult } from "@/types/tools"

import { BuiltinToolWindow } from "../shared/tool-window"

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

describe("BuiltinToolWindow", () => {
  it("renders descriptor fields and runs the tool", async () => {
    await renderWindow("docx-to-markdown")
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("DOCX 转 Markdown")
    })

    await act(async () => {
      buttonByText("选择文件").click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText("运行").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.tools.selectFile).toHaveBeenCalledWith({ toolId: "docx-to-markdown", fieldId: "inputPath" })
    expect(bridgeMocks.tools.runTool).toHaveBeenCalledWith({
      toolId: "docx-to-markdown",
      input: expect.objectContaining({ inputPath: "/tmp/a.docx" }),
      runId: expect.any(String),
    })
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("完成")
    })
  })

  it("cancels a running tool from the stop button", async () => {
    let resolveRun: ((result: SynapseToolRunResult) => void) | undefined
    bridgeMocks.tools.runTool.mockImplementationOnce(
      () =>
        new Promise<SynapseToolRunResult>((resolve) => {
          resolveRun = resolve
        })
    )
    bridgeMocks.tools.cancelRun.mockImplementationOnce(async () => {
      resolveRun?.({
        ok: false,
        toolId: "docx-to-markdown",
        error: { code: "cancelled", message: "已停止" },
        metadata: {},
      })
      return { cancelled: true }
    })

    await renderWindow("docx-to-markdown")
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("DOCX 转 Markdown")
    })

    await act(async () => {
      buttonByText("选择文件").click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText("运行").click()
      await Promise.resolve()
    })

    const runId = bridgeMocks.tools.runTool.mock.calls[0]?.[0].runId
    await act(async () => {
      buttonByText("停止").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.tools.cancelRun).toHaveBeenCalledWith({ runId })
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("运行")
    })
  })

  it("cancels a running tool when the window unmounts", async () => {
    bridgeMocks.tools.runTool.mockImplementationOnce(() => new Promise(() => undefined))

    await renderWindow("docx-to-markdown")
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("DOCX 转 Markdown")
    })

    await act(async () => {
      buttonByText("选择文件").click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText("运行").click()
      await Promise.resolve()
    })

    const runId = bridgeMocks.tools.runTool.mock.calls[0]?.[0].runId
    await act(async () => {
      roots.at(-1)?.unmount()
      roots.pop()
      await Promise.resolve()
    })

    expect(bridgeMocks.tools.cancelRun).toHaveBeenCalledWith({ runId })
  })
})

async function renderWindow(toolId: string): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<BuiltinToolWindow toolId={toolId} />)
    await Promise.resolve()
  })
}

function createBridgeMocks() {
  return {
    tools: {
      getToolDescriptor: vi.fn(async () => ({
        id: "docx-to-markdown",
        title: "DOCX 转 Markdown",
        description: "转换一个 DOCX 文件",
        category: "conversion",
        inputFields: [
          { id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] },
          {
            id: "outputMode",
            kind: "select",
            label: "输出",
            required: true,
            defaultValue: "return",
            options: [
              { value: "return", label: "仅返回结果" },
              { value: "write-file", label: "写入文件" },
            ],
          },
        ],
        outputPreview: { kind: "markdown", pathFromOutput: "outputPath" },
        input: { kind: "file", extensions: [".docx"] },
        output: { kind: "markdown" },
      })),
      selectFile: vi.fn(async () => ({ filePath: "/tmp/a.docx" })),
      selectDirectory: vi.fn(async () => ({ directoryPath: "/tmp/out" })),
      cancelRun: vi.fn(async () => ({ cancelled: true })),
      runTool: vi.fn(async (_payload: SynapseToolRunPayload): Promise<SynapseToolRunResult> => ({
        ok: true,
        toolId: "docx-to-markdown",
        output: { markdown: "# OK", warnings: [], metadata: {}, sourcePath: "/tmp/a.docx" },
        warnings: [],
        metadata: {},
      })),
    },
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`)
  return button
}

async function waitForExpectation(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}
