import { describe, expect, it } from "vitest"
import {
  getTerminalPaneShortcut,
  isTerminalShiftEnterEvent,
  type TerminalKeyboardEvent,
} from "../terminal-keyboard"

const SHIFT_ENTER_EVENT: TerminalKeyboardEvent = {
  altKey: false,
  ctrlKey: false,
  isComposing: false,
  key: "Enter",
  metaKey: false,
  shiftKey: true,
}

describe("terminal keyboard", () => {
  it("recognizes unmodified Shift+Enter", () => {
    expect(isTerminalShiftEnterEvent(SHIFT_ENTER_EVENT)).toBe(true)
  })

  it.each([
    ["plain Enter", { shiftKey: false }],
    ["Alt+Shift+Enter", { altKey: true }],
    ["Ctrl+Shift+Enter", { ctrlKey: true }],
    ["Meta+Shift+Enter", { metaKey: true }],
    ["IME Shift+Enter", { isComposing: true }],
    ["another shifted key", { key: "Space" }],
  ])("leaves %s to xterm", (_name, overrides) => {
    expect(isTerminalShiftEnterEvent({
      ...SHIFT_ENTER_EVENT,
      ...overrides,
    })).toBe(false)
  })
})

describe("terminal pane shortcuts", () => {
  it.each([
    ["Cmd+D", "darwin", { metaKey: true, shiftKey: false, key: "d" }, "split-right"],
    ["Cmd+Shift+D", "darwin", { metaKey: true, shiftKey: true, key: "D" }, "split-down"],
    ["Option+Cmd+Left", "darwin", { altKey: true, metaKey: true, shiftKey: false, key: "ArrowLeft" }, "focus-left"],
    ["Cmd+W", "darwin", { metaKey: true, shiftKey: false, key: "w" }, "close-pane"],
    ["Alt+Shift++", "win32", { altKey: true, shiftKey: true, key: "+" }, "split-right"],
    ["Alt+Shift+-", "win32", { altKey: true, shiftKey: true, key: "-" }, "split-down"],
    ["Alt+Down", "win32", { altKey: true, shiftKey: false, key: "ArrowDown" }, "focus-down"],
    ["Ctrl+Shift+W", "win32", { ctrlKey: true, shiftKey: true, key: "W" }, "close-pane"],
  ])("maps %s", (_name, platform, overrides, expected) => {
    expect(getTerminalPaneShortcut({
      ...SHIFT_ENTER_EVENT,
      key: "",
      shiftKey: false,
      ...overrides,
    }, platform)).toBe(expected)
  })

  it("does not reserve shortcuts on Linux", () => {
    expect(getTerminalPaneShortcut({ ...SHIFT_ENTER_EVENT, metaKey: true, shiftKey: false, key: "d" }, "linux")).toBeNull()
  })
})
