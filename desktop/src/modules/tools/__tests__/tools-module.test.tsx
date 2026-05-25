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
      expect(document.body.textContent).toContain("文件转换")
    })

    await act(async () => {
      buttonByLabel("打开文件转换").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.tools.openTool).toHaveBeenCalledWith("file-conversion")
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
          id: "file-conversion",
          label: "文件转换",
          windowTitle: "文件转换",
          description: "转为 Markdown",
          supportedExtensions: [".docx", ".xlsx", ".pdf", ".pptx"],
          bounds: { width: 760, height: 560, minWidth: 560, minHeight: 420 },
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
