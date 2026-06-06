import { describe, expect, it, vi } from "vitest"

const defaultLoggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

import { createAutomationWindowService } from "../automation-window-service"

vi.mock("../log-store", () => ({
  createMainLogger: () => defaultLoggerMock,
}))

function createWindowMock() {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    on: vi.fn(),
    destroy: vi.fn(),
    webContents: { id: Math.floor(Math.random() * 10000) },
  }
}

function createLoggerMock() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

describe("createAutomationWindowService", () => {
  it("reuses and reloads the create draft window", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const service = createAutomationWindowService({ createWindow, baseUrl: () => "app://-" })

    await service.openCreate()
    await service.openCreate()

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.loadURL).toHaveBeenCalledTimes(2)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("logs when reusing an existing editor window", async () => {
    const window = createWindowMock()
    const logger = createLoggerMock()
    const createWindow = vi.fn(() => window as never)
    const service = createAutomationWindowService({ createWindow, baseUrl: () => "app://-", logger })

    await service.openCreate()
    await service.openCreate()

    expect(logger.info).toHaveBeenCalledWith("Focused existing automation editor window.", {
      windowKey: "create",
      windowMode: "create",
    })
  })

  it("logs and cleans up when loading the editor window fails", async () => {
    const window = createWindowMock()
    const logger = createLoggerMock()
    const loadError = new Error("load failed")
    window.loadURL.mockRejectedValue(loadError)
    const createWindow = vi.fn(() => window as never)
    const service = createAutomationWindowService({ createWindow, baseUrl: () => "app://-", logger })

    await expect(service.openEdit("automation:1")).rejects.toThrow("load failed")

    expect(logger.warn).toHaveBeenCalledWith("Failed to load automation editor window.", {
      errorName: "Error",
      errorLength: "load failed".length,
      windowKey: "automation:1",
      windowMode: "edit",
    })
    expect(window.destroy).toHaveBeenCalledTimes(1)
  })

  it("reuses the same edit window by automation id", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const service = createAutomationWindowService({ createWindow, baseUrl: () => "app://-" })

    await service.openEdit("automation-1")
    await service.openEdit("automation-1")

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("opens different edit windows for different automation ids", async () => {
    const createWindow = vi.fn(() => createWindowMock() as never)
    const service = createAutomationWindowService({ createWindow, baseUrl: () => "app://-" })

    await service.openEdit("automation-1")
    await service.openEdit("automation-2")

    expect(createWindow).toHaveBeenCalledTimes(2)
  })

  it("uses the built preload script for editor windows", async () => {
    const createWindow = vi.fn(() => createWindowMock() as never)
    const service = createAutomationWindowService({ createWindow, baseUrl: () => "app://-" })

    await service.openCreate()

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      webPreferences: expect.objectContaining({
        preload: expect.stringMatching(/preload\.js$/),
      }),
    }))
  })

  it("opens editor windows with the compact automation editor bounds", async () => {
    const createWindow = vi.fn(() => createWindowMock() as never)
    const service = createAutomationWindowService({ createWindow, baseUrl: () => "app://-" })

    await service.openCreate()

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 950,
      minWidth: 860,
      height: 720,
      minHeight: 560,
    }))
  })
})
