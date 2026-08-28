import { describe, expect, it, vi } from "vitest"

import {
  buildDetachedViewWindowUrl,
  createDetachedViewWindowService,
} from "../detached-view-window-service"

describe("detached view window service", () => {
  it("opens one window per key and focuses existing windows", async () => {
    const window = createWindowMock()
    const service = createDetachedViewWindowService({
      createWindow: vi.fn(() => window as never),
      logger: createLoggerMock(),
    })
    const onCreated = vi.fn()
    const onReadyToShow = vi.fn()

    await service.open({
      key: "view:1",
      payload: { url: "app://index.html?window=test" },
      options: { title: "Test" },
      load: (target, payload) => target.loadURL(payload.url),
      onCreated,
      onReadyToShow,
    })
    await service.open({
      key: "view:1",
      payload: { url: "app://index.html?window=test" },
      options: { title: "Test" },
      load: (target, payload) => target.loadURL(payload.url),
    })

    expect(window.loadURL).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith({
      key: "view:1",
      window,
      payload: { url: "app://index.html?window=test" },
    })
    expect(onReadyToShow).toHaveBeenCalledWith(window)
  })

  it("removes tracked windows when they close", async () => {
    const window = createWindowMock()
    const service = createDetachedViewWindowService({
      createWindow: () => window as never,
      logger: createLoggerMock(),
    })
    const onRemoved = vi.fn()
    const onClosed = vi.fn()

    await service.open({
      key: "view:1",
      payload: { id: "payload-1" },
      options: { title: "Test" },
      load: async () => undefined,
      onRemoved,
      onClosed,
    })
    window.emitClosed()

    expect(service.get("view:1")).toBeNull()
    expect(onRemoved).toHaveBeenCalledWith({
      key: "view:1",
      window,
      payload: { id: "payload-1" },
    })
    expect(onClosed).toHaveBeenCalledWith({
      key: "view:1",
      window,
      payload: { id: "payload-1" },
    })
  })

  it("keeps the BrowserWindow title authoritative after the renderer loads", async () => {
    const window = createWindowMock()
    const service = createDetachedViewWindowService({
      createWindow: () => window as never,
      logger: createLoggerMock(),
    })

    await service.open({
      key: "view:1",
      payload: {},
      options: { title: "Git · Synapse" },
      load: async () => undefined,
    })

    const event = { preventDefault: vi.fn() }
    window.emitPageTitleUpdated(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it("cleans up and closes windows when loading fails by default", async () => {
    const window = createWindowMock()
    const loadError = new Error("load failed")
    const logger = createLoggerMock()
    const service = createDetachedViewWindowService({
      createWindow: () => window as never,
      logger,
    })
    const onRemoved = vi.fn()

    await expect(service.open({
      key: "view:1",
      payload: { id: "payload-1" },
      options: { title: "Test" },
      load: async () => {
        throw loadError
      },
      loadErrorMessage: "Detached window failed to load.",
      logMetadata: (payload) => ({ id: payload.id }),
      onRemoved,
    })).rejects.toThrow(loadError)

    expect(service.get("view:1")).toBeNull()
    expect(window.close).toHaveBeenCalledTimes(1)
    expect(onRemoved).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      "Detached window failed to load.",
      { id: "payload-1", error: loadError },
    )
  })

  it("can keep failed windows tracked when a caller preserves legacy behavior", async () => {
    const window = createWindowMock()
    const service = createDetachedViewWindowService({
      createWindow: () => window as never,
      logger: createLoggerMock(),
    })

    await expect(service.open({
      key: "view:1",
      payload: {},
      options: { title: "Test" },
      load: async () => {
        throw new Error("load failed")
      },
      cleanupOnLoadError: false,
    })).rejects.toThrow("load failed")

    expect(service.get("view:1")).toBe(window)
    expect(window.close).not.toHaveBeenCalled()
  })

  it("replaces a tracked key without creating another window", async () => {
    const window = createWindowMock()
    const service = createDetachedViewWindowService({
      createWindow: () => window as never,
      logger: createLoggerMock(),
    })

    await service.open({
      key: "view:1",
      payload: {},
      options: { title: "Test" },
      load: async () => undefined,
    })

    expect(service.replaceKey("view:1", "view:2")).toBe(window)
    expect(service.get("view:1")).toBeNull()
    expect(service.get("view:2")).toBe(window)
  })

  it("builds renderer URLs with existing query strings", () => {
    expect(buildDetachedViewWindowUrl(
      "http://localhost:5173?theme=dark",
      new URLSearchParams({ window: "test" }),
    )).toBe("http://localhost:5173?theme=dark&window=test")
  })
})

function createWindowMock() {
  type WindowListener = (event?: { preventDefault: () => void }) => void
  const listeners = new Map<string, WindowListener[]>()
  const window = {
    id: Math.floor(Math.random() * 100_000),
    webContents: {
      id: Math.floor(Math.random() * 100_000),
      on: vi.fn(),
    },
    close: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    loadURL: vi.fn(async () => undefined),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === "ready-to-show") listener()
    }),
    on: vi.fn((event: string, listener: WindowListener) => {
      const current = listeners.get(event) ?? []
      listeners.set(event, current.concat(listener))
    }),
    restore: vi.fn(),
    emitClosed: () => {
      for (const listener of listeners.get("closed") ?? []) listener()
    },
    emitPageTitleUpdated: (event: { preventDefault: () => void }) => {
      for (const listener of listeners.get("page-title-updated") ?? []) listener(event)
    },
  }
  return window
}

function createLoggerMock() {
  return {
    error: vi.fn(),
  }
}
