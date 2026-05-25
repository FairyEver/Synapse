/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DatabaseSettingsPanel } from "../database-settings-panel"

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  promise: vi.fn(async <T,>(fn: () => Promise<T>) => fn()),
  refreshStatus: vi.fn(),
  showItemInFolder: vi.fn(),
  useDatabaseStatus: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: mocks.error,
    promise: mocks.promise,
  }),
}))

vi.mock("@/modules/database/hooks/use-database", () => ({
  databaseExport: vi.fn(),
  databaseImport: vi.fn(),
  useDatabaseStatus: mocks.useDatabaseStatus,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.error.mockReset()
  mocks.loggerError.mockReset()
  mocks.loggerInfo.mockReset()
  mocks.loggerWarn.mockReset()
  mocks.promise.mockClear()
  mocks.refreshStatus.mockReset()
  mocks.showItemInFolder.mockReset()
  mocks.useDatabaseStatus.mockReturnValue({
    refresh: mocks.refreshStatus,
    status: {
      dbDirectoryPath: "/Users/liyang/Library/Application Support/Synapse",
      dbSize: 1024,
      port: 57321,
      running: true,
      tableCount: 3,
    },
  })
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      shell: {
        showItemInFolder: mocks.showItemInFolder,
      },
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
  vi.restoreAllMocks()
})

describe("DatabaseSettingsPanel", () => {
  it("does not render the retired Synapse CLI controls", () => {
    renderPanel()

    expect(document.body.textContent).not.toContain("CLI")
    expect(document.body.textContent).not.toContain("安装 CLI")
    expect(document.body.textContent).not.toContain("测试 CLI")
  })

  it("notifies when opening the database directory fails", async () => {
    mocks.showItemInFolder.mockRejectedValue(new Error("permission denied"))

    renderPanel()
    const directoryButton = findButton("/Users/liyang/Library/Application Support/Synapse")

    await act(async () => {
      directoryButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.showItemInFolder).toHaveBeenCalledWith("/Users/liyang/Library/Application Support/Synapse")
    expect(mocks.error).toHaveBeenCalledWith("无法打开数据库目录。")
    expect(mocks.loggerWarn).toHaveBeenCalledWith("Failed to open database directory.", {
      error: "Error",
      pathLength: "/Users/liyang/Library/Application Support/Synapse".length,
    })
  })
})

function renderPanel(): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(<DatabaseSettingsPanel />)
  })
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent === label)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button "${label}" was not rendered`)
  }
  return button
}
