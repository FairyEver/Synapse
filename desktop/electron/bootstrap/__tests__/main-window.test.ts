import { describe, expect, it, vi } from "vitest"
import { isDevToolsToggleShortcut } from "../main-window"

vi.mock("electron", () => ({
  app: {
    exit: vi.fn(),
    getVersion: () => "0.0.0-test",
    relaunch: vi.fn(),
  },
  BrowserWindow: class {},
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
