/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { createTerminalRenderingOptions } from "../terminal-rendering"

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
      container: document.createElement("div"),
      disableStdin: false,
    })

    expect(options.theme?.background).toBe("rgba(250, 250, 250, 1)")
    expect(context.fillStyle).toBe("oklch(0.985 0 0)")
    expect(context.fillRect).toHaveBeenCalled()
  })
})
