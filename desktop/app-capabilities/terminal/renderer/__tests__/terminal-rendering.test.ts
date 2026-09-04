/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
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
    expect(context.fillStyle).toBe("oklch(0.985 0 0)")
    expect(context.fillRect).toHaveBeenCalled()
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
