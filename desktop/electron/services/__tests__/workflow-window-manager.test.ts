import Module from "node:module"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

type FakeBrowserWindow = {
  readonly id: number
  readonly options: Electron.BrowserWindowConstructorOptions
  destroyed: boolean
  focused: boolean
  loadedUrls: string[]
  sentMessages: Array<{ channel: string; payload: unknown }>
  loadError?: Error
  closedHandler?: () => void
  webContents: {
    send: (channel: string, payload: unknown) => void
    ipc: { on: () => void; removeListener: () => void }
    on: () => void
    removeListener: () => void
    isDestroyed: () => boolean
  }
  isDestroyed: () => boolean
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
      loadedUrls: [],
      sentMessages: [],
      loadError: nextLoadError,
      webContents: {
        send: (channel, payload) => {
          win.sentMessages.push({ channel, payload })
        },
        ipc: { on: vi.fn(), removeListener: vi.fn() },
        on: vi.fn(),
        removeListener: vi.fn(),
        isDestroyed: () => win.destroyed,
      },
      isDestroyed: () => win.destroyed,
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

vi.mock("../log-store", () => ({
  createMainLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
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
  })

  it("closes the editor window when opening the runner for the same workflow", async () => {
    const manager = new WorkflowWindowManager()

    const editor = manager.open("workflow-1", "app://-")
    const runner = await manager.openRunner("workflow-1", "run-1", "app://-")

    expect(editor).not.toBe(runner)
    expect(editor.isDestroyed()).toBe(true)
    expect(runner.isDestroyed()).toBe(false)
    expect(manager.getOpenEditorIds()).toEqual([])
  })

  it("opens editor windows wider and taller than before with main window minimum bounds", () => {
    const manager = new WorkflowWindowManager()

    const editor = manager.open("workflow-1", "app://-") as unknown as FakeBrowserWindow

    expect(editor.options).toMatchObject({
      width: 1350,
      height: 900,
      minWidth: 1000,
      minHeight: 600,
      title: "Workflow Editor",
    })
  })

  it("closes the runner window when opening the editor for the same workflow", async () => {
    const manager = new WorkflowWindowManager()

    const runner = await manager.openRunner("workflow-1", "run-1", "app://-")
    const editor = manager.open("workflow-1", "app://-")

    expect(runner).not.toBe(editor)
    expect(runner.isDestroyed()).toBe(true)
    expect(editor.isDestroyed()).toBe(false)
    expect(manager.getOpenEditorIds()).toEqual(["workflow-1"])
  })

  it("keeps the editor open when runner URL loading fails", async () => {
    const manager = new WorkflowWindowManager()

    const editor = manager.open("workflow-1", "app://-")
    electronMock.setNextLoadError(new Error("load failed"))
    const openPromise = manager.openRunner("workflow-1", "run-1", "app://-")

    await expect(openPromise).rejects.toThrow("load failed")

    expect(editor.isDestroyed()).toBe(false)
  })
})
