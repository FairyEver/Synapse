import { describe, expect, it, vi } from "vitest"

vi.mock("../../log-store", () => ({
  createMainLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

import { createToolWindowService } from "../tool-window-service"

function createWindowMock() {
  return {
    webContents: { on: vi.fn() },
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
  }
}

describe("createToolWindowService", () => {
  it("opens a generic tool window with the tool route", async () => {
    const window = createWindowMock()
    const health = { attach: vi.fn(), detach: vi.fn() }
    const createWindow = vi.fn(() => window as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createToolWindowService({
      createWindow,
      createHealthService: vi.fn(() => health),
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      loadWindow,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await service.open("file-conversion")

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 920,
      height: 680,
      minWidth: 720,
      minHeight: 520,
      resizable: true,
      title: "文件转换",
      webPreferences: expect.objectContaining({
        preload: "/preload.js",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      }),
    }))
    expect(health.attach).toHaveBeenCalledWith(window.webContents)
    expect(loadWindow).toHaveBeenCalledWith(window, expect.objectContaining({
      id: "file-conversion",
    }))
  })

  it("focuses the existing window for repeated opens", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createToolWindowService({
      createWindow,
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      loadWindow,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await service.open("file-conversion")
    await service.open("file-conversion")

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(loadWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("rejects unknown tool ids", async () => {
    const service = createToolWindowService({
      createWindow: vi.fn(),
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      loadWindow: vi.fn(async () => undefined),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await expect(service.open("unknown")).rejects.toThrow("Unknown tool: unknown")
  })
})
