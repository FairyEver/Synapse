/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LogExportPanel } from "../log-export-panel"

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  listFiles: vi.fn(),
  promise: vi.fn(async <T,>(
    task: () => Promise<T>,
    options?: { error?: (error: unknown) => unknown },
  ) => {
    try {
      return await task()
    } catch (error) {
      options?.error?.(error)
      throw error
    }
  }),
  readFiles: vi.fn(),
  showError: vi.fn(),
  writeText: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: mocks.loggerError,
    info: mocks.loggerInfo,
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: mocks.showError,
    promise: mocks.promise,
  }),
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    log: {
      listFiles: mocks.listFiles,
    },
  }),
  requireSynapseBridge: () => ({
    log: {
      clear: vi.fn(),
      export: vi.fn(),
      listFiles: mocks.listFiles,
      readFiles: mocks.readFiles,
    },
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listFiles.mockResolvedValue([
    { name: "latest.log", modifiedAt: "2026-06-05T00:00:00.000Z", sizeBytes: 128 },
    { name: "previous.log", modifiedAt: "2026-06-04T00:00:00.000Z", sizeBytes: 64 },
  ])
  mocks.readFiles.mockRejectedValue(new Error("read failed"))
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: mocks.writeText,
    },
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
})

describe("LogExportPanel", () => {
  it("handles selected log copy failures", async () => {
    renderPanel()

    await act(async () => {
      findButton("复制到剪切板").click()
      await settle()
    })

    expect(document.body.textContent).toContain("选择要复制的日志文件")

    await act(async () => {
      findButton("复制选中的 1 个文件").click()
      await settle()
    })

    expect(mocks.readFiles).toHaveBeenCalledWith(["latest.log"])
    expect(mocks.loggerError).toHaveBeenCalledWith("Copy selected log files failed.", expect.any(Error))
  })
})

function renderPanel(): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(<LogExportPanel />)
  })
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent?.trim() === label)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button "${label}" was not rendered`)
  }
  return button
}
