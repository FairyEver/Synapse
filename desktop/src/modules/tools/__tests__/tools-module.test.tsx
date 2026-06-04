/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ToolsModule } from "../index"

const loggerWarn = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
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

describe("ToolsModule", () => {
  it("lists tools and opens each tool through the bridge", async () => {
    await renderModule()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("DOCX 转 Markdown")
    })

    await act(async () => {
      buttonByLabel("打开 DOCX 转 Markdown").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.tools.openTool).toHaveBeenCalledWith("docx-to-markdown")
  })
})

async function renderModule(): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<ToolsModule />)
    await Promise.resolve()
  })
}

function createBridgeMocks() {
  return {
    tools: {
      listTools: vi.fn(async () => ({
        tools: [{
          id: "docx-to-markdown",
          title: "DOCX 转 Markdown",
          description: "转换一个 DOCX 文件",
          category: "conversion",
          inputFields: [{ id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] }],
          outputPreview: { kind: "markdown", pathFromOutput: "outputPath" },
          input: { kind: "file", extensions: [".docx"] },
          output: { kind: "markdown" },
        }],
      })),
      openTool: vi.fn(async () => undefined),
    },
  }
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
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
