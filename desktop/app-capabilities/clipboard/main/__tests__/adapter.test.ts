import { describe, expect, it, vi } from "vitest"
import {
  createElectronClipboardAdapter,
  createUnavailableClipboardAdapter,
} from "../adapter"

describe("Clipboard adapter", () => {
  it("uses only Electron default readText and writeText calls", () => {
    const readText = vi.fn(() => "value")
    const writeText = vi.fn()
    const adapter = createElectronClipboardAdapter({ readText, writeText })

    expect(adapter.readText()).toBe("value")
    adapter.writeText("next")
    expect(readText).toHaveBeenCalledWith()
    expect(writeText).toHaveBeenCalledWith("next")
  })

  it("provides a stable unavailable adapter", () => {
    const adapter = createUnavailableClipboardAdapter()
    expect(adapter.kind).toBe("unavailable")
    expect(() => adapter.readText()).toThrow()
    expect(() => adapter.writeText("value")).toThrow()
  })
})
