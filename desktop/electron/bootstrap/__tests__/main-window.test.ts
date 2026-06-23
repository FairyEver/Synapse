import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const windows: Array<{
    emitClose: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void
    focus: ReturnType<typeof vi.fn>
    hide: ReturnType<typeof vi.fn>
    loadFile: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    webContents: {
      on: ReturnType<typeof vi.fn>
      toggleDevTools: ReturnType<typeof vi.fn>
    }
  }> = []

  const BrowserWindow = vi.fn(function (this: {
    emitClose: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void
    focus: ReturnType<typeof vi.fn>
    hide: ReturnType<typeof vi.fn>
    loadFile: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    webContents: {
      on: ReturnType<typeof vi.fn>
      toggleDevTools: ReturnType<typeof vi.fn>
    }
  }) {
    const handlers = new Map<string, (event: { preventDefault: ReturnType<typeof vi.fn> }) => void>()
    this.emitClose = (event) => {
      handlers.get("close")?.(event)
    }
    this.focus = vi.fn()
    this.hide = vi.fn()
    this.loadFile = vi.fn(async () => undefined)
    this.loadURL = vi.fn(async () => undefined)
    this.on = vi.fn((event: string, handler: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void) => {
      handlers.set(event, handler)
    })
    this.once = vi.fn()
    this.show = vi.fn()
    this.webContents = {
      on: vi.fn(),
      toggleDevTools: vi.fn(),
    }
    windows.push(this)
  })

  return {
    app: {
      exit: vi.fn(),
      getVersion: () => "0.0.0-test",
      relaunch: vi.fn(),
    },
    BrowserWindow,
    windows,
  }
})

import { createMainWindow, isDevToolsToggleShortcut } from "../main-window"

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: mocks.BrowserWindow,
}))

vi.mock("../../services/app-icon-service", () => ({
  getWindowIconPath: () => null,
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("../../services/renderer-health", () => ({
  RendererHealthService: class {
    attach() {}
    detach() {}
  },
}))

function input(overrides: Partial<Electron.Input>): Electron.Input {
  return {
    alt: false,
    code: "",
    control: false,
    isAutoRepeat: false,
    isComposing: false,
    key: "",
    location: 0,
    meta: false,
    modifiers: [],
    shift: false,
    type: "keyDown",
    ...overrides,
  }
}

describe("main window development shortcuts", () => {
  it("recognizes DevTools toggle shortcuts", () => {
    expect(isDevToolsToggleShortcut(input({ alt: true, key: "I", meta: true }))).toBe(true)
    expect(isDevToolsToggleShortcut(input({ key: "F12" }))).toBe(true)
  })

  it("ignores ordinary input", () => {
    expect(isDevToolsToggleShortcut(input({ key: "I", meta: true }))).toBe(false)
    expect(isDevToolsToggleShortcut(input({ alt: true, key: "I", meta: true, type: "keyUp" }))).toBe(false)
  })
})

describe("createMainWindow close behavior", () => {
  it("hides the main window instead of closing while the app keeps running", () => {
    const state = { current: null }
    createMainWindow({ state, isAppQuitting: () => false })
    const closeEvent = { preventDefault: vi.fn() }

    mocks.windows.at(-1)?.emitClose(closeEvent)

    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(mocks.windows.at(-1)?.hide).toHaveBeenCalledTimes(1)
  })

  it("allows the main window to close while the app is quitting", () => {
    const state = { current: null }
    createMainWindow({ state, isAppQuitting: () => true })
    const closeEvent = { preventDefault: vi.fn() }

    mocks.windows.at(-1)?.emitClose(closeEvent)

    expect(closeEvent.preventDefault).not.toHaveBeenCalled()
    expect(mocks.windows.at(-1)?.hide).not.toHaveBeenCalled()
  })
})
