import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  createCcConversationWindowService,
  resolveCcConversationWindowPreloadPath,
} from "../usage-analysis/cc-conversation-window-service"

vi.mock("../log-store", () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

describe("createCcConversationWindowService", () => {
  it("resolves the preload script from the compiled Electron root", () => {
    expect(resolveCcConversationWindowPreloadPath("/repo/desktop/dist-electron/electron/services/usage-analysis")).toBe(
      path.join("/repo/desktop/dist-electron/electron", "preload.js"),
    )
  })

  it("keeps packaged preload paths inside app.asar", () => {
    expect(
      resolveCcConversationWindowPreloadPath(
        "/Applications/Synapse.app/Contents/Resources/app.asar/dist-electron/electron/services/usage-analysis",
      ),
    ).toBe(
      path.join(
        "/Applications/Synapse.app/Contents/Resources/app.asar/dist-electron/electron",
        "preload.js",
      ),
    )
  })

  it("opens one window per session and reloads focus for duplicates", async () => {
    const window = createMockWindow()
    const createWindow = vi.fn(() => window as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createCcConversationWindowService({
      createWindow,
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadWindow,
    })

    await service.openConversationWindow({ sessionId: "s1", title: "对话", focus: { eventId: "event-1" } })
    await service.openConversationWindow({ sessionId: "s1", title: "对话", focus: { eventId: "event-2" } })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(loadWindow).toHaveBeenCalledTimes(2)
    expect(loadWindow).toHaveBeenLastCalledWith(window, {
      sessionId: "s1",
      title: "对话",
      focus: { eventId: "event-2" },
    })
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("keeps a dedicated native title when the shared renderer updates the page title", async () => {
    const window = createMockWindow()
    const createWindow = vi.fn(() => window as never)
    const service = createCcConversationWindowService({
      createWindow,
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadWindow: vi.fn(async () => undefined),
    })

    await service.openConversationWindow({ sessionId: "s1", title: "/private/conversation/path" })

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      title: "Synapse AI Studio CC 对话详情",
    }))
    const pageTitleHandler = window.listeners.get("page-title-updated")
    expect(pageTitleHandler).toBeTypeOf("function")
    const event = { preventDefault: vi.fn() }
    pageTitleHandler?.(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it("cleans up tracking state when loading a conversation window fails", async () => {
    const firstWindow = createMockWindow()
    const secondWindow = createMockWindow()
    const windows = [firstWindow, secondWindow]
    const health = { attach: vi.fn(), detach: vi.fn() }
    const createWindow = vi.fn(() => windows.shift() as never)
    const loadError = new Error("load failed")
    const loadWindow = vi.fn()
      .mockRejectedValueOnce(loadError)
      .mockResolvedValueOnce(undefined)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const service = createCcConversationWindowService({
      createWindow,
      createHealthService: vi.fn(() => health),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger,
      loadWindow,
    })

    await expect(service.openConversationWindow({ sessionId: "s1", title: "对话" })).rejects.toThrow(loadError)
    await expect(service.openConversationWindow({ sessionId: "s1", title: "对话" })).resolves.toBeUndefined()

    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(loadWindow).toHaveBeenCalledTimes(2)
    expect(health.detach).toHaveBeenCalledTimes(1)
    expect(firstWindow.focus).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to load CC conversation window.",
      { error: loadError, sessionId: "s1" },
    )
  })
})

function createMockWindow() {
  const listeners = new Map<string, (event?: { preventDefault: () => void }) => void>()
  return {
    listeners,
    webContents: { on: vi.fn() },
    close: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    once: vi.fn(),
    on: vi.fn((event: string, listener: (event?: { preventDefault: () => void }) => void) => {
      listeners.set(event, listener)
    }),
    restore: vi.fn(),
    show: vi.fn(),
  }
}
