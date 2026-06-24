import Module from "node:module"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { WindowManager } from "../../runtime/window"

type FakeBrowserWindow = {
  readonly id: number
  readonly options: Electron.BrowserWindowConstructorOptions
  destroyed: boolean
  focused: boolean
  minimized: boolean
  restored: boolean
  loadedUrls: string[]
  sentMessages: Array<{ channel: string; payload: unknown }>
  loadError?: Error
  closedHandler?: () => void
  windowOpenHandler?: (details: { url: string }) => { action: "allow" | "deny" }
  webContents: {
    send: (channel: string, payload: unknown) => void
    ipc: { on: () => void; removeListener: () => void }
    on: (event: string, handler: (...args: unknown[]) => void) => void
    removeListener: (event: string, handler: (...args: unknown[]) => void) => void
    isDestroyed: () => boolean
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: "allow" | "deny" }) => void
    trigger: (event: string, ...args: unknown[]) => void
  }
  isDestroyed: () => boolean
  isMinimized: () => boolean
  restore: () => void
  focus: () => void
  loadURL: (url: string) => Promise<void>
  on: (event: string, handler: () => void) => void
  close: () => void
  destroy: () => void
}

const electronMock = vi.hoisted(() => {
  const windows: FakeBrowserWindow[] = []
  let nextId = 1
  let nextLoadError: Error | undefined

  function createWindow(options: Electron.BrowserWindowConstructorOptions = {}): FakeBrowserWindow {
    const win: FakeBrowserWindow = {
      id: nextId++,
      options,
      destroyed: false,
      focused: false,
      minimized: false,
      restored: false,
      loadedUrls: [],
      sentMessages: [],
      loadError: nextLoadError,
      windowOpenHandler: undefined,
      webContents: {
        send: (channel, payload) => {
          win.sentMessages.push({ channel, payload })
        },
        ipc: { on: vi.fn(), removeListener: vi.fn() },
        on: (event, handler) => {
          const handlers = webContentsHandlers.get(event) ?? []
          handlers.push(handler)
          webContentsHandlers.set(event, handlers)
        },
        removeListener: (event, handler) => {
          const handlers = webContentsHandlers.get(event) ?? []
          webContentsHandlers.set(event, handlers.filter((candidate) => candidate !== handler))
        },
        isDestroyed: () => win.destroyed,
        setWindowOpenHandler: (handler) => {
          win.windowOpenHandler = handler
        },
        trigger: (event, ...args) => {
          for (const handler of webContentsHandlers.get(event) ?? []) {
            handler(...args)
          }
        },
      },
      isDestroyed: () => win.destroyed,
      isMinimized: () => win.minimized,
      restore: () => {
        win.restored = true
        win.minimized = false
      },
      focus: () => {
        win.focused = true
      },
      loadURL: async (url: string) => {
        if (win.loadError) throw win.loadError
        win.loadedUrls.push(url)
      },
      on: (event: string, handler: () => void) => {
        if (event === "closed") win.closedHandler = handler
      },
      close: () => {
        win.destroyed = true
        win.closedHandler?.()
      },
      destroy: () => {
        win.destroyed = true
      },
    }
    const webContentsHandlers = new Map<string, Array<(...args: unknown[]) => void>>()
    windows.push(win)
    nextLoadError = undefined
    return win
  }

  return {
    windows,
    reset: () => {
      windows.length = 0
      nextId = 1
      nextLoadError = undefined
    },
    setNextLoadError: (error: Error) => {
      nextLoadError = error
    },
    BrowserWindow: vi.fn(function BrowserWindow(options: Electron.BrowserWindowConstructorOptions) {
      return createWindow(options)
    }),
  }
})

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
}))

const healthMock = vi.hoisted(() => ({
  attach: vi.fn(),
  detach: vi.fn(),
}))

vi.mock("../renderer-health", () => ({
  RendererHealthService: vi.fn(function RendererHealthService() {
    return healthMock
  }),
}))

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("../log-store", () => ({
  createMainLogger: vi.fn(() => loggerMock),
}))

const moduleResolver = Module as typeof Module & {
  _resolveFilename: (
    request: string,
    parent?: unknown,
    isMain?: boolean,
    options?: unknown,
  ) => string
}
const originalResolveFilename = moduleResolver._resolveFilename

import { WorkflowWindowManager } from "../workflow/window-manager"

describe("WorkflowWindowManager", () => {
  beforeAll(() => {
    moduleResolver._resolveFilename = (request, parent, isMain, options) => {
      if (request === "../../preload") return "/tmp/synapse-preload.js"
      return originalResolveFilename.call(moduleResolver, request, parent, isMain, options)
    }
  })

  afterAll(() => {
    moduleResolver._resolveFilename = originalResolveFilename
  })

  beforeEach(() => {
    electronMock.reset()
    electronMock.BrowserWindow.mockClear()
    healthMock.attach.mockClear()
    healthMock.detach.mockClear()
    loggerMock.error.mockClear()
    loggerMock.info.mockClear()
    loggerMock.warn.mockClear()
  })

  it("closes the editor window when opening the runner for the same workflow", async () => {
    const manager = new WorkflowWindowManager()

    const editor = await manager.open("workflow-1", "app://-")
    const runner = await manager.openRunner("workflow-1", "run-1", "app://-")

    expect(editor).not.toBe(runner)
    expect(editor.isDestroyed()).toBe(true)
    expect(runner.isDestroyed()).toBe(false)
    expect(manager.getOpenEditorIds()).toEqual([])
  })

  it("opens editor windows wider and taller than before with main window minimum bounds", async () => {
    const manager = new WorkflowWindowManager()

    const editor = await manager.open("workflow-1", "app://-") as unknown as FakeBrowserWindow

    expect(editor.options).toMatchObject({
      width: 1350,
      height: 900,
      minWidth: 1000,
      minHeight: 600,
      title: "Workflow Editor",
    })
  })

  it("restores a minimized editor window when reusing it", async () => {
    const manager = new WorkflowWindowManager()

    const editor = await manager.open("workflow-1", "app://-") as unknown as FakeBrowserWindow
    editor.minimized = true
    const reused = await manager.open("workflow-1", "app://-")

    expect(reused).toBe(editor)
    expect(editor.restored).toBe(true)
    expect(editor.focused).toBe(true)
  })

  it("cleans up editor window state when editor URL loading fails", async () => {
    const manager = new WorkflowWindowManager()
    electronMock.setNextLoadError(new Error("load failed"))

    await expect(manager.open("workflow-1", "app://-")).rejects.toThrow("load failed")

    expect(manager.getOpenEditorIds()).toEqual([])
    expect(electronMock.windows[0]?.isDestroyed()).toBe(true)
    expect(healthMock.detach).toHaveBeenCalled()
  })

  it("detaches editor windows from the main WindowManager when they close", async () => {
    const mainWindowManager = createMainWindowManager()
    const manager = new WorkflowWindowManager(mainWindowManager)

    const editor = await manager.open("workflow-1", "app://-") as unknown as FakeBrowserWindow
    editor.close()

    expect(mainWindowManager.detach).toHaveBeenCalledWith("workflow-editor:workflow-1")
  })

  it("detaches editor windows from the main WindowManager when URL loading fails", async () => {
    const mainWindowManager = createMainWindowManager()
    const manager = new WorkflowWindowManager(mainWindowManager)
    electronMock.setNextLoadError(new Error("load failed"))

    await expect(manager.open("workflow-1", "app://-")).rejects.toThrow("load failed")

    expect(mainWindowManager.detach).toHaveBeenCalledWith("workflow-editor:workflow-1")
  })

  it("closes the runner window when opening the editor for the same workflow", async () => {
    const manager = new WorkflowWindowManager()

    const runner = await manager.openRunner("workflow-1", "run-1", "app://-")
    const editor = await manager.open("workflow-1", "app://-")

    expect(runner).not.toBe(editor)
    expect(runner.isDestroyed()).toBe(true)
    expect(editor.isDestroyed()).toBe(false)
    expect(manager.getOpenEditorIds()).toEqual(["workflow-1"])
  })

  it("detaches runner windows from the main WindowManager when they are closed by an editor", async () => {
    const mainWindowManager = createMainWindowManager()
    const manager = new WorkflowWindowManager(mainWindowManager)

    await manager.openRunner("workflow-1", "run-1", "app://-")
    await manager.open("workflow-1", "app://-")

    expect(mainWindowManager.detach).toHaveBeenCalledWith("workflow-runner:workflow-1")
  })

  it("keeps the editor open when runner URL loading fails", async () => {
    const manager = new WorkflowWindowManager()

    const editor = await manager.open("workflow-1", "app://-")
    electronMock.setNextLoadError(new Error("load failed"))
    const openPromise = manager.openRunner("workflow-1", "run-1", "app://-")

    await expect(openPromise).rejects.toThrow("load failed")

    expect(editor.isDestroyed()).toBe(false)
  })

  it("restores a minimized runner window when reusing it", async () => {
    const manager = new WorkflowWindowManager()

    const runner = await manager.openRunner("workflow-1", "run-1", "app://-") as unknown as FakeBrowserWindow
    runner.minimized = true
    const reused = await manager.openRunner("workflow-1", "run-2", "app://-")

    expect(reused).toBe(runner)
    expect(runner.restored).toBe(true)
    expect(runner.focused).toBe(true)
  })

  it("attaches navigation diagnostics and denies popups for workflow detail windows", async () => {
    const manager = new WorkflowWindowManager()

    const editor = await manager.open("workflow-1", "app://index.html") as unknown as FakeBrowserWindow
    const runner = await manager.openRunner("workflow-2", "run-1", "app://index.html") as unknown as FakeBrowserWindow

    expect(editor.windowOpenHandler?.({ url: "https://example.com" })).toEqual({ action: "deny" })
    expect(runner.windowOpenHandler?.({ url: "https://example.com" })).toEqual({ action: "deny" })
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "workflow detail window popup blocked",
      expect.objectContaining({ attemptedUrl: "https://example.com/" }),
    )
  })

  it("allows expected workflow detail main-frame navigation and logs it", async () => {
    const manager = new WorkflowWindowManager()

    const runner = await manager.openRunner("workflow-1", "run-1", "app://index.html") as unknown as FakeBrowserWindow
    const expectedUrl = "app://index.html?window=workflow-runner&workflowId=workflow-1&runId=run-1"
    const event = createNavigationEvent()

    runner.webContents.trigger("will-navigate", event, expectedUrl)
    runner.webContents.trigger("did-navigate", {}, expectedUrl, 200, "OK")

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(loggerMock.info).toHaveBeenCalledWith(
      "workflow detail window did navigate",
      expect.objectContaining({
        allowed: true,
        runId: "run-1",
        url: expectedUrl,
        windowType: "workflow-runner",
        workflowId: "workflow-1",
      }),
    )
  })

  it("blocks workflow runner main-frame navigation to dependency source files", async () => {
    const manager = new WorkflowWindowManager()

    const runner = await manager.openRunner("workflow-1", "run-1", "app://index.html") as unknown as FakeBrowserWindow
    const event = createNavigationEvent()
    const sourceUrl = "app://node_modules/zrender/src/Element.ts"

    runner.webContents.trigger("will-navigate", event, sourceUrl)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "workflow detail window blocked unexpected navigation",
      expect.objectContaining({
        attemptedUrl: sourceUrl,
        runId: "run-1",
        windowType: "workflow-runner",
        workflowId: "workflow-1",
      }),
    )
  })

  it("blocks workflow editor main-frame navigation to external URLs", async () => {
    const manager = new WorkflowWindowManager()

    const editor = await manager.open("workflow-1", "app://index.html") as unknown as FakeBrowserWindow
    const event = createNavigationEvent()

    editor.webContents.trigger("will-navigate", event, "https://example.com")

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "workflow detail window blocked unexpected navigation",
      expect.objectContaining({
        attemptedUrl: "https://example.com/",
        windowType: "workflow-editor",
        workflowId: "workflow-1",
      }),
    )
  })

  it("logs unexpected main-frame navigation starts before a takeover completes", async () => {
    const manager = new WorkflowWindowManager()

    const runner = await manager.openRunner("workflow-1", "run-1", "app://index.html") as unknown as FakeBrowserWindow
    const sourceUrl = "app://node_modules/zrender/src/Element.ts"

    runner.webContents.trigger("did-start-navigation", {}, sourceUrl, false, true)

    expect(loggerMock.warn).toHaveBeenCalledWith(
      "workflow detail window unexpected navigation started",
      expect.objectContaining({
        attemptedUrl: sourceUrl,
        isMainFrame: true,
        windowType: "workflow-runner",
      }),
    )
  })

  it("logs sub-frame load failures without treating them as main-frame takeovers", async () => {
    const manager = new WorkflowWindowManager()

    const runner = await manager.openRunner("workflow-1", "run-1", "app://index.html") as unknown as FakeBrowserWindow

    runner.webContents.trigger("did-fail-load", {}, -3, "ABORTED", "app://iframe.html", false)

    expect(loggerMock.warn).not.toHaveBeenCalledWith(
      "workflow detail window blocked unexpected navigation",
      expect.anything(),
    )
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "workflow detail window load failed",
      expect.objectContaining({
        errorCode: -3,
        errorDescription: "ABORTED",
        isMainFrame: false,
        validatedUrl: "app://iframe.html",
      }),
    )
  })
})

function createNavigationEvent(): { preventDefault: ReturnType<typeof vi.fn> } {
  return { preventDefault: vi.fn() }
}

function createMainWindowManager(): WindowManager & {
  attach: ReturnType<typeof vi.fn>
  detach: ReturnType<typeof vi.fn>
} {
  return {
    register: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    list: vi.fn(() => []),
    getAllWindows: vi.fn(() => []),
    broadcast: vi.fn(() => 1),
  } as unknown as WindowManager & {
    attach: ReturnType<typeof vi.fn>
    detach: ReturnType<typeof vi.fn>
  }
}
