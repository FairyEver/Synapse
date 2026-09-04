import { describe, expect, it } from "vitest"
import {
  TERMINAL_TOOLBAR_ACTIONS,
  getTerminalToolbarActions,
  isTerminalToolbarActionEnabled,
  resolveTerminalToolbarPayload,
} from "../terminal-toolbar-actions"

describe("terminal toolbar actions", () => {
  it("exposes the built-in actions in stable display order", () => {
    expect(TERMINAL_TOOLBAR_ACTIONS.map((action) => action.id)).toEqual([
      "interrupt",
      "clear",
      "claude",
      "codex",
      "vscode",
      "slash-exit",
      "slash-clear",
    ])
    expect(TERMINAL_TOOLBAR_ACTIONS.map((action) => action.label)).toEqual([
      "Ctrl+C",
      "Clear",
      "Claude",
      "Codex",
      "code .",
      "/exit",
      "/clear",
    ])
  })

  it("keeps only actions supported on the current renderer platform", () => {
    expect(getTerminalToolbarActions("darwin").map((action) => action.id)).toEqual([
      "interrupt",
      "clear",
      "claude",
      "codex",
      "vscode",
      "slash-exit",
      "slash-clear",
    ])
    expect(getTerminalToolbarActions("sunos").map((action) => action.id)).toEqual([
      "interrupt",
      "clear",
      "claude",
      "codex",
      "vscode",
      "slash-exit",
      "slash-clear",
    ])
    expect(getTerminalToolbarActions(undefined).map((action) => action.id)).toEqual([
      "interrupt",
      "clear",
      "claude",
      "codex",
      "vscode",
      "slash-exit",
      "slash-clear",
    ])
  })

  it("resolves terminal sequences and shell commands for the active platform", () => {
    const interrupt = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "interrupt")
    const claude = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "claude")
    const slashClear = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "slash-clear")

    expect(interrupt ? resolveTerminalToolbarPayload(interrupt, "win32") : null).toBe("\x03")
    expect(claude ? resolveTerminalToolbarPayload(claude, "darwin") : null).toBe("claude")
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
