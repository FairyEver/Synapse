import { describe, expect, it, vi } from "vitest"

const defaultLoggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { createSystemAppWindowService } from "../system-app-window-service"

type BroadcastFilter = (window: { readonly id: number }) => boolean

vi.mock("../log-store", () => ({
  createMainLogger: () => defaultLoggerMock,
}))

describe("createSystemAppWindowService", () => {
  it("opens and focuses one window per app id", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const windowManager = createWindowManagerMock()
    const service = createSystemAppWindowService({
      createWindow,
      baseUrl: () => "app://index.html",
      windowManager,
    })

    await service.open("database")
    await service.open("database")

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      title: "Synapse AI Studio 本地数据库",
    }))
    expect(windowManager.attach).toHaveBeenCalledWith(
      { id: "system-app:database", role: "detail" },
      expect.objectContaining({ id: window.webContents.id }),
    )
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.loadURL).toHaveBeenCalledWith("app://index.html?window=system-app&appId=database")
  })

  it("delivers content open requests to an existing resource repository window", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const windowManager = createWindowManagerMock()
    const service = createSystemAppWindowService({
      createWindow,
      baseUrl: () => "app://index.html",
      windowManager,
    })
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
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:app:apps:operation:content_open_request",
      contentOpenRequest,
      expect.any(Function),
    )
    const filter = windowManager.broadcast.mock.calls[0]?.[2] as BroadcastFilter | undefined
    expect(filter?.({ id: window.webContents.id } as never)).toBe(true)
    expect(filter?.({ id: window.webContents.id + 1 } as never)).toBe(false)
  })

  it("opens different windows for different app ids", async () => {
    const windows = [createWindowMock(), createWindowMock()]
    const createWindow = vi.fn(() => windows.shift() as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })

    await service.open("database")
    await service.open("model-price")

    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(createWindow).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: "Synapse AI Studio 本地数据库",
    }))
    expect(createWindow).toHaveBeenNthCalledWith(2, expect.objectContaining({
      title: "Synapse AI Studio 价格管理",
    }))
  })

  it("uses the document text extractor title in its independent window", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })

    await service.open("document-text-extractor")

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      title: "Synapse AI Studio 文档文本提取",
    }))
    expect(window.loadURL).toHaveBeenCalledWith(
      "app://index.html?window=system-app&appId=document-text-extractor",
    )
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

  it("cleans up failed loads so the app can reopen with a fresh window", async () => {
    const first = createWindowMock()
    const second = createWindowMock()
    const createWindow = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const windowManager = createWindowManagerMock()
    const service = createSystemAppWindowService({
      createWindow,
      baseUrl: () => "app://index.html",
      windowManager,
    })
    first.loadURL.mockRejectedValueOnce(new Error("renderer unavailable"))

    await expect(service.open("database")).rejects.toThrow("renderer unavailable")
    await service.open("database")

    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(windowManager.detach).toHaveBeenCalledWith("system-app:database")
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.loadURL).toHaveBeenCalledWith("app://index.html?window=system-app&appId=database")
  })
})

function createWindowMock() {
  const webContentsId = Math.floor(Math.random() * 10_000) + 1
  let closedHandler: (() => void) | null = null
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    close: vi.fn(),
    destroy: vi.fn(),
    webContents: {
      id: webContentsId,
      send: vi.fn(),
    },
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "closed") closedHandler = handler
    }),
    emitClosed: () => closedHandler?.(),
  }
}

function createWindowManagerMock() {
  return {
    register: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    list: vi.fn(() => []),
    getAllWindows: vi.fn(() => []),
    broadcast: vi.fn((_channel: string, _payload: unknown, _filter?: BroadcastFilter) => 1),
  }
}
