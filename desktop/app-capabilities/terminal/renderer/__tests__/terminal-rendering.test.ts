/**
 * @vitest-environment jsdom
 */
import { Terminal } from "@xterm/xterm"
import { afterEach, describe, expect, it, vi } from "vitest"
import { installTerminalUnicodeWidth, TERMINAL_UNICODE_VERSION } from "../../shared/terminal-unicode-width"
import {
  applyTerminalTheme,
  constrainTerminalCompositionToViewport,
  createTerminalRenderingOptions,
} from "../terminal-rendering"

describe("terminal rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("normalizes modern theme token colors for the WebGL renderer", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "oklch(0.985 0 0)",
    } as unknown as CSSStyleDeclaration)

    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([250, 250, 250, 255]),
      })),
      fillStyle: "",
    }
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )

    const options = createTerminalRenderingOptions({
      appearanceSize: "medium",
      container: document.createElement("div"),
      disableStdin: false,
    })

    expect(options.theme?.background).toBe("rgba(250, 250, 250, 1)")
    expect(options.macOptionClickForcesSelection).toBe(true)
    expect(options.allowProposedApi).toBe(true)
    expect(context.fillStyle).toBe("oklch(0.985 0 0)")
    expect(context.fillRect).toHaveBeenCalled()
  })

  it("switches palette and canvas colors while preserving text and truecolor cells", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    const frame = document.createElement("div")
    frame.setAttribute("data-terminal-xterm-frame", "")
    const container = frame.appendChild(document.createElement("div"))
    const terminal = new Terminal({ cols: 20, rows: 4 })
    try {
      await new Promise<void>((resolve) => terminal.write("\x1b[31mR\x1b[38;2;12;34;56mT\x1b[0m", resolve))
      const row = terminal.buffer.active.getLine(0)!
      applyTerminalTheme(terminal, container, "catppuccin-latte")
      expect(terminal.options.theme?.background).toBe("#eff1f5")
      expect(frame.style.getPropertyValue("--terminal-background")).toBe("#eff1f5")
      expect(row.translateToString(true)).toBe("RT")
      expect(row.getCell(0)?.getFgColor()).toBe(1)
      expect(row.getCell(1)?.getFgColor()).toBe(0x0c2238)
      expect([terminal.cols, terminal.rows]).toEqual([20, 4])
      const previousTheme = terminal.options.theme
      applyTerminalTheme(terminal, container, "default")
      expect(terminal.options.theme).not.toBe(previousTheme)
      expect(terminal.options.theme?.background).not.toBe("#eff1f5")
      expect(row.translateToString(true)).toBe("RT")
    } finally {
      terminal.dispose()
    }
  })

  it("activates the emoji aware width table for renderer terminals", async () => {
    const terminal = new Terminal({
      ...createTerminalRenderingOptions({
        appearanceSize: "medium",
        container: document.createElement("div"),
        disableStdin: false,
      }),
      cols: 20,
      rows: 4,
    })
    try {
      expect(installTerminalUnicodeWidth(terminal)).toBe("patched")
      expect(terminal.unicode.activeVersion).toBe(TERMINAL_UNICODE_VERSION)
      expect(terminal.unicode.versions).toContain(TERMINAL_UNICODE_VERSION)
      await new Promise<void>((resolve) => terminal.write("⏺a", resolve))
      expect(terminal.buffer.active.cursorX).toBe(3)
    } finally {
      terminal.dispose()
    }
  })

  it("keeps long IME composition text within the remaining terminal width", () => {
    const container = document.createElement("div")
    const screen = document.createElement("div")
    const helpers = document.createElement("div")
    const textarea = document.createElement("textarea")
    const composition = document.createElement("div")
    screen.className = "xterm-screen"
    textarea.className = "xterm-helper-textarea"
    composition.className = "composition-view active"
    composition.style.left = "180px"
    helpers.append(textarea, composition)
    screen.append(helpers)
    container.append(screen)
    Object.defineProperty(screen, "clientWidth", { value: 240 })
    Object.defineProperty(composition, "scrollWidth", { value: 320 })

    constrainTerminalCompositionToViewport(container)

    expect(composition.style.maxWidth).toBe("60px")
    expect(textarea.style.maxWidth).toBe("60px")
    expect(composition.classList.contains("overflow-x-hidden")).toBe(true)
    expect(composition.scrollLeft).toBe(320)
  })

  it("does not constrain composition before xterm has measurable geometry", () => {
    const container = document.createElement("div")
    const screen = document.createElement("div")
    const composition = document.createElement("div")
    screen.className = "xterm-screen"
    composition.className = "composition-view"
    composition.style.left = "20px"
    screen.append(composition)
    container.append(screen)

    constrainTerminalCompositionToViewport(container)

    expect(composition.style.maxWidth).toBe("")
  })
})
