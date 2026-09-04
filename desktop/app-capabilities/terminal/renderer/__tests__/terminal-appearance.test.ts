/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_TERMINAL_APPEARANCE_SIZE,
  getTerminalAppearanceOptions,
  readTerminalAppearanceSize,
  writeTerminalAppearanceSize,
} from "../terminal-appearance"

describe("terminal appearance", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("keeps the existing 14px terminal size as medium", () => {
    expect(DEFAULT_TERMINAL_APPEARANCE_SIZE).toBe("medium")
    expect(getTerminalAppearanceOptions("small").fontSize).toBe(12)
    expect(getTerminalAppearanceOptions("medium").fontSize).toBe(14)
    expect(getTerminalAppearanceOptions("large").fontSize).toBe(16)
  })

  it("persists semantic size values and ignores invalid stored values", () => {
    writeTerminalAppearanceSize("large")
    expect(readTerminalAppearanceSize()).toBe("large")

    window.localStorage.setItem("synapse:app:terminal:appearance_size:v1", "18")
    expect(readTerminalAppearanceSize()).toBe("medium")
  })
})
