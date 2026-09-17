import { describe, expect, it } from "vitest"
import {
  TERMINAL_TOOLBAR_ACTIONS,
  getTerminalToolbarActions,
  isTerminalToolbarActionEnabled,
  resolveTerminalToolbarPayload,
} from "../terminal-toolbar-actions"

describe("terminal toolbar actions", () => {
  it("exposes the built-in actions in stable display order", () => {
    // 「回车」 leads because the phone's accessory bar is this same list, and a phone
    // has no other way to send a bare carriage return. On a desktop with a keyboard
    // it is redundant — that is the price of the two ends agreeing item for item.
    expect(TERMINAL_TOOLBAR_ACTIONS.map((action) => action.id)).toEqual([
      "enter",
      "interrupt",
      "clear",
      "slash-exit",
      "slash-clear",
    ])
    expect(TERMINAL_TOOLBAR_ACTIONS.map((action) => action.label)).toEqual([
      "回车",
      "Ctrl+C",
      "Clear",
      "/exit",
      "/clear",
    ])
  })

  it("keeps only actions supported on the current renderer platform", () => {
    expect(getTerminalToolbarActions("darwin").map((action) => action.id)).toEqual([
      "enter",
      "interrupt",
      "clear",
      "slash-exit",
      "slash-clear",
    ])
    expect(getTerminalToolbarActions("sunos").map((action) => action.id)).toEqual([
      "enter",
      "interrupt",
      "clear",
      "slash-exit",
      "slash-clear",
    ])
    expect(getTerminalToolbarActions(undefined).map((action) => action.id)).toEqual([
      "enter",
      "interrupt",
      "clear",
      "slash-exit",
      "slash-clear",
    ])
  })

  it("sends a carriage return for the new built-in", () => {
    const enter = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "enter")
    if (!enter) throw new Error("Missing the enter action")
    expect(resolveTerminalToolbarPayload(enter, "darwin")).toBe("\r")
    // Only a running terminal can be answered, like the other sequences.
    expect(isTerminalToolbarActionEnabled(enter, "running")).toBe(true)
    expect(isTerminalToolbarActionEnabled(enter, "exited")).toBe(false)
  })

  it("resolves terminal sequences and shell commands for the active platform", () => {
    const interrupt = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "interrupt")
    const slashExit = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "slash-exit")
    const slashClear = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "slash-clear")

    expect(interrupt ? resolveTerminalToolbarPayload(interrupt, "win32") : null).toBe("\x03")
    expect(slashExit ? resolveTerminalToolbarPayload(slashExit, "darwin") : null).toBe("/exit")
    expect(slashClear ? resolveTerminalToolbarPayload(slashClear, "linux") : null).toBe("/clear")
  })

  it("treats running-only actions as disabled for non-running sessions", () => {
    const interrupt = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "interrupt")
    const clear = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "clear")
    if (!interrupt || !clear) throw new Error("Missing toolbar actions")

    expect(isTerminalToolbarActionEnabled(interrupt, "running")).toBe(true)
    expect(isTerminalToolbarActionEnabled(interrupt, "lost")).toBe(false)
    expect(isTerminalToolbarActionEnabled(interrupt, "exited")).toBe(false)
    expect(isTerminalToolbarActionEnabled(interrupt, "killed")).toBe(false)
    expect(isTerminalToolbarActionEnabled(interrupt, "failed")).toBe(false)
    expect(isTerminalToolbarActionEnabled(clear, "lost")).toBe(true)
  })
})
