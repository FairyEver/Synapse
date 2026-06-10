import { describe, expect, it, vi } from "vitest"

import {
  createContentStoreInstallWindowService,
  loadContentStoreInstallWindow,
} from "../content-store-install-window-service"

vi.mock("../log-store", () => ({
  createMainLogger: () => createLogger(),
}))

vi.mock("../content-store-install-service", () => ({
  contentStoreInstallService: {
    cleanupIfIdle: vi.fn(async () => undefined),
  },
}))

describe("createContentStoreInstallWindowService", () => {
  it("creates an install window with editor bounds and renderer health tracking", async () => {
    const window = createMockWindow()
    const health = { attach: vi.fn(), detach: vi.fn() }
    const createWindow = vi.fn(() => window as never)
    const service = createContentStoreInstallWindowService({
      createWindow,
      createHealthService: vi.fn(() => health),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: createLogger(),
      loadWindow: vi.fn(async () => undefined),
    })

    await service.open({ session: "session-1" })

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 1280,
      height: 820,
      minWidth: 1120,
      minHeight: 680,
      show: false,
    }))
    expect(health.attach).toHaveBeenCalledWith(window.webContents)
  })

  it("focuses an existing same-session window and creates a different-session window", async () => {
    const firstWindow = createMockWindow()
    const secondWindow = createMockWindow()
    const windows = [firstWindow, secondWindow]
    const createWindow = vi.fn(() => windows.shift() as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createContentStoreInstallWindowService({
      createWindow,
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: createLogger(),
      loadWindow,
    })

    await service.open({ session: "session-1" })
    await service.open({ session: "session-1" })
    await service.open({ session: "session-2" })

    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(loadWindow).toHaveBeenCalledTimes(2)
    expect(firstWindow.focus).toHaveBeenCalledTimes(1)
  })

  it("cleans up same-session tracking and health when the window closes", async () => {
    const firstWindow = createMockWindow()
    const secondWindow = createMockWindow()
    const windows = [firstWindow, secondWindow]
    const health = { attach: vi.fn(), detach: vi.fn() }
    const createWindow = vi.fn(() => windows.shift() as never)
    const cleanupSession = vi.fn(async () => undefined)
    const service = createContentStoreInstallWindowService({
      createWindow,
      createHealthService: vi.fn(() => health),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: createLogger(),
      cleanupSession,
      loadWindow: vi.fn(async () => undefined),
    })

    await service.open({ session: "session-1" })
    findEventHandler(firstWindow.on, "closed")?.()
    await service.open({ session: "session-1" })

    expect(health.detach).toHaveBeenCalledTimes(1)
    expect(cleanupSession).toHaveBeenCalledWith("session-1")
    expect(createWindow).toHaveBeenCalledTimes(2)
  })

  it("does not remove a replacement window when a stale same-session window closes later", async () => {
    const firstWindow = createMockWindow()
    const secondWindow = createMockWindow()
    firstWindow.isDestroyed.mockReturnValue(true)
    const windows = [firstWindow, secondWindow]
    const createWindow = vi.fn(() => windows.shift() as never)
    const service = createContentStoreInstallWindowService({
      createWindow,
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: createLogger(),
      loadWindow: vi.fn(async () => undefined),
    })

    await service.open({ session: "session-1" })
    await service.open({ session: "session-1" })
    findEventHandler(firstWindow.on, "closed")?.()
    await service.open({ session: "session-1" })

    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(secondWindow.focus).toHaveBeenCalledTimes(1)
  })
})

describe("loadContentStoreInstallWindow", () => {
  it("loads the renderer with the content-store-install session query", async () => {
    const window = createMockWindow()

    await loadContentStoreInstallWindow(window as never, { session: "session-1" }, "/app")

    expect(window.loadFile).toHaveBeenCalledWith("/app/dist/index.html", {
      query: {
        session: "session-1",
        synapseWindow: "content-store-install",
      },
    })
  })
})

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function createMockWindow() {
  return {
    webContents: { on: vi.fn() },
    close: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    loadFile: vi.fn(async () => undefined),
    loadURL: vi.fn(async () => undefined),
    once: vi.fn(),
    on: vi.fn(),
    restore: vi.fn(),
    show: vi.fn(),
  }
}

function findEventHandler(mock: ReturnType<typeof vi.fn>, event: string): (() => void) | undefined {
  return mock.mock.calls.find(([registeredEvent]) => registeredEvent === event)?.[1]
}
