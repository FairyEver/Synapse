/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConfigBackupPanel } from "../config-backup-panel"

const mocks = vi.hoisted(() => ({
  exportConfigBackup: vi.fn(),
  importConfigBackup: vi.fn(),
  info: vi.fn(),
  promise: vi.fn(async <T,>(fn: () => Promise<T>) => fn()),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/config-backup", () => ({
  exportConfigBackup: mocks.exportConfigBackup,
  importConfigBackup: mocks.importConfigBackup,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    info: mocks.info,
    warn: mocks.warn,
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    promise: mocks.promise,
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.exportConfigBackup.mockReset()
  mocks.importConfigBackup.mockReset()
  mocks.info.mockReset()
  mocks.promise.mockClear()
  mocks.warn.mockReset()
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

describe("ConfigBackupPanel", () => {
  it("returns focus to import after cancelling the confirmation with Escape", async () => {
    renderPanel()
    const importButton = findButton("导入")

    await act(async () => {
      importButton.click()
      await Promise.resolve()
    })
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.activeElement).toBe(importButton)
    })
  })

  it("returns focus to export after cancelling the save dialog", async () => {
    let resolveExport: (value: unknown) => void = () => {}
    mocks.exportConfigBackup.mockReturnValue(new Promise((resolve) => {
      resolveExport = resolve
    }))

    renderPanel()
    const exportButton = findButton("导出")
    exportButton.focus()

    await act(async () => {
      exportButton.click()
      await Promise.resolve()
    })
    exportButton.blur()

    await act(async () => {
      resolveExport(null)
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.activeElement).toBe(exportButton)
    })
  })

  it("disables export while a backup export is running", async () => {
    let resolveExport: (value: unknown) => void = () => {}
    mocks.exportConfigBackup.mockReturnValue(new Promise((resolve) => {
      resolveExport = resolve
    }))

    renderPanel()
    const exportButton = findButton("导出")

    await act(async () => {
      exportButton.click()
      await Promise.resolve()
    })

    expect(exportButton.disabled).toBe(true)

    await act(async () => {
      exportButton.click()
      await Promise.resolve()
    })
    expect(mocks.exportConfigBackup).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveExport({ filePath: "/tmp/config.zip" })
      await Promise.resolve()
    })

    expect(exportButton.disabled).toBe(false)
  })

  it("disables import confirmation while a backup import is running", async () => {
    let resolveImport: (value: unknown) => void = () => {}
    mocks.importConfigBackup.mockReturnValue(new Promise((resolve) => {
      resolveImport = resolve
    }))

    renderPanel()
    const importButton = findButton("导入")

    await act(async () => {
      importButton.click()
      await Promise.resolve()
    })

    const confirmButton = findButton("确认导入")

    await act(async () => {
      confirmButton.click()
      await Promise.resolve()
    })

    expect(confirmButton.disabled).toBe(true)

    await act(async () => {
      confirmButton.click()
      await Promise.resolve()
    })
    expect(mocks.importConfigBackup).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveImport(null)
      await Promise.resolve()
    })

    expect(Array.from(document.querySelectorAll("button"))
      .some((item) => item.textContent === "确认导入")).toBe(false)
  })

  it("returns focus to import confirmation after a selected backup fails validation", async () => {
    let rejectImport: (reason?: unknown) => void = () => {}
    mocks.importConfigBackup.mockReturnValue(new Promise((_, reject) => {
      rejectImport = reject
    }))

    renderPanel()
    const importButton = findButton("导入")

    await act(async () => {
      importButton.click()
      await Promise.resolve()
    })

    const confirmButton = findButton("确认导入")
    await act(async () => {
      confirmButton.click()
      await Promise.resolve()
    })
    confirmButton.blur()

    await act(async () => {
      rejectImport(new Error("备份文件不是有效的 JSON。"))
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.activeElement).toBe(confirmButton)
    })
  })
})

function renderPanel(): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(<ConfigBackupPanel />)
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
