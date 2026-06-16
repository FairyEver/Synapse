import { describe, expect, it, vi } from "vitest"

const defaultLoggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

import { createSystemAppWindowService } from "../system-app-window-service"

vi.mock("../log-store", () => ({
  createMainLogger: () => defaultLoggerMock,
}))

describe("createSystemAppWindowService", () => {
  it("opens and focuses one window per app id", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })

    await service.open("database")
    await service.open("database")

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.loadURL).toHaveBeenCalledWith("app://index.html?window=system-app&appId=database")
  })

  it("delivers content open requests to an existing resource repository window", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })
    const contentOpenRequest = {
      kind: "detail",
      requestId: "request-1",
      contentType: "skill",
      contentId: "skill-1",
    } as const

    await service.open("resource-repository")
    await service.open("resource-repository", { contentOpenRequest })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.webContents.send).toHaveBeenCalledWith("synapse:apps:content-open-request", contentOpenRequest)
  })

  it("opens different windows for different app ids", async () => {
    const windows = [createWindowMock(), createWindowMock()]
    const createWindow = vi.fn(() => windows.shift() as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })

    await service.open("database")
    await service.open("model-price")

    expect(createWindow).toHaveBeenCalledTimes(2)
  })

  it("removes closed windows so the app can reopen", async () => {
    const first = createWindowMock()
    const second = createWindowMock()
    const createWindow = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })

    await service.open("database")
    first.emitClosed()
    await service.open("database")

    expect(createWindow).toHaveBeenCalledTimes(2)
  })
})

function createWindowMock() {
  let closedHandler: (() => void) | null = null
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    webContents: {
      send: vi.fn(),
    },
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "closed") closedHandler = handler
    }),
    emitClosed: () => closedHandler?.(),
  }
}
