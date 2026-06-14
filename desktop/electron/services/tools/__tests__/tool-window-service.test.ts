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
    close: vi.fn(),
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

    await service.open("docx-to-markdown")

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 500,
      height: 560,
      minWidth: 500,
      minHeight: 420,
      resizable: true,
      title: "DOCX 转 Markdown",
      webPreferences: expect.objectContaining({
        preload: "/preload.js",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      }),
    }))
    expect(health.attach).toHaveBeenCalledWith(window.webContents)
    expect(loadWindow).toHaveBeenCalledWith(window, expect.objectContaining({
      id: "docx-to-markdown",
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

    await service.open("docx-to-markdown")
    await service.open("docx-to-markdown")

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(loadWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("cleans up a hidden window when loading fails so the next open retries", async () => {
    const firstWindow = createWindowMock()
    const secondWindow = createWindowMock()
    const firstHealth = { attach: vi.fn(), detach: vi.fn() }
    const secondHealth = { attach: vi.fn(), detach: vi.fn() }
    const createWindow = vi.fn()
      .mockReturnValueOnce(firstWindow)
      .mockReturnValueOnce(secondWindow)
    const createHealthService = vi.fn()
      .mockReturnValueOnce(firstHealth)
      .mockReturnValueOnce(secondHealth)
    const loadError = new Error("load failed")
    const loadWindow = vi.fn()
      .mockRejectedValueOnce(loadError)
      .mockResolvedValueOnce(undefined)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const service = createToolWindowService({
      createWindow,
      createHealthService,
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      loadWindow,
      logger,
    })

    await expect(service.open("docx-to-markdown")).rejects.toThrow("load failed")
    await service.open("docx-to-markdown")

    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(loadWindow).toHaveBeenNthCalledWith(1, firstWindow, expect.objectContaining({
      id: "docx-to-markdown",
    }))
    expect(loadWindow).toHaveBeenNthCalledWith(2, secondWindow, expect.objectContaining({
      id: "docx-to-markdown",
    }))
    expect(firstHealth.detach).toHaveBeenCalledTimes(1)
    expect(firstWindow.close).toHaveBeenCalledTimes(1)
    expect(firstWindow.focus).not.toHaveBeenCalled()
    expect(secondHealth.attach).toHaveBeenCalledWith(secondWindow.webContents)
    expect(logger.error).toHaveBeenCalledWith("Failed to load tool window.", {
      toolId: "docx-to-markdown",
      error: loadError,
    })
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
