import { describe, expect, it } from "vitest"
import {
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
