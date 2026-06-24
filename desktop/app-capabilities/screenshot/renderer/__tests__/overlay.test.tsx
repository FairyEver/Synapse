/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ScreenshotOverlayApp } from "../overlay"

describe("ScreenshotOverlayApp", () => {
  const roots: Root[] = []
  let closeWindow: ReturnType<typeof vi.fn>
  const bridge = {
    screenshot: {
      completeInteractiveCapture: vi.fn(async () => true),
      cancelInteractiveCapture: vi.fn(async () => true),
    },
  }

  beforeEach(() => {
    document.body.innerHTML = ""
    window.history.replaceState({}, "", "/?window=screenshot-overlay&offsetX=100&offsetY=200")
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: bridge,
    })
    closeWindow = vi.fn()
    vi.spyOn(window, "close").mockImplementation(closeWindow)
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()
    bridge.screenshot.completeInteractiveCapture.mockReset()
    bridge.screenshot.cancelInteractiveCapture.mockReset()
    bridge.screenshot.completeInteractiveCapture.mockResolvedValue(true)
    bridge.screenshot.cancelInteractiveCapture.mockResolvedValue(true)
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
    vi.restoreAllMocks()
  })

  it("completes an interactive capture when users drag a valid region", async () => {
    renderOverlay(roots)
    const overlay = getOverlay()

    await pointer(overlay, "pointerdown", { x: 10, y: 20 })
    await pointer(overlay, "pointermove", { x: 110, y: 120 })
    await pointer(overlay, "pointerup", { x: 110, y: 120 })

    expect(bridge.screenshot.completeInteractiveCapture).toHaveBeenCalledWith({
      x: 110,
      y: 220,
      width: 100,
      height: 100,
    })
  })

  it("uses the pointerup position as the final region point", async () => {
    renderOverlay(roots)
    const overlay = getOverlay()

    await pointer(overlay, "pointerdown", { x: 10, y: 20 })
    await pointer(overlay, "pointerup", { x: 110, y: 120 })

    expect(bridge.screenshot.completeInteractiveCapture).toHaveBeenCalledWith({
      x: 110,
      y: 220,
      width: 100,
      height: 100,
    })
  })

  it("lets users confirm the selected region with Enter", async () => {
    renderOverlay(roots)
    const overlay = getOverlay()

    await pointer(overlay, "pointerdown", { x: 20, y: 30 })
    await pointer(overlay, "pointermove", { x: 80, y: 90 })
    await key(overlay, "Enter")

    expect(bridge.screenshot.completeInteractiveCapture).toHaveBeenCalledWith({
      x: 120,
      y: 230,
      width: 60,
      height: 60,
    })
  })

  it("cancels the capture with Escape", async () => {
    renderOverlay(roots)

    await key(getOverlay(), "Escape")

    expect(bridge.screenshot.cancelInteractiveCapture).toHaveBeenCalledTimes(1)
  })

  it("closes the overlay when completion is rejected by the main process", async () => {
    bridge.screenshot.completeInteractiveCapture.mockResolvedValueOnce(false)
    renderOverlay(roots)
    const overlay = getOverlay()

    await pointer(overlay, "pointerdown", { x: 10, y: 20 })
    await pointer(overlay, "pointerup", { x: 110, y: 120 })
    await flushPromises()

    expect(closeWindow).toHaveBeenCalledTimes(1)
  })

  it("closes the overlay when completion fails", async () => {
    bridge.screenshot.completeInteractiveCapture.mockRejectedValueOnce(new Error("missing session"))
    renderOverlay(roots)
    const overlay = getOverlay()

    await pointer(overlay, "pointerdown", { x: 10, y: 20 })
    await pointer(overlay, "pointerup", { x: 110, y: 120 })
    await flushPromises()

    expect(closeWindow).toHaveBeenCalledTimes(1)
  })

  it("resets tiny regions instead of completing them", async () => {
    renderOverlay(roots)
    const overlay = getOverlay()

    await pointer(overlay, "pointerdown", { x: 10, y: 20 })
    await pointer(overlay, "pointermove", { x: 11, y: 21 })
    await pointer(overlay, "pointerup", { x: 11, y: 21 })

    expect(bridge.screenshot.completeInteractiveCapture).not.toHaveBeenCalled()
    expect(document.querySelector("[data-testid='screenshot-selection']")).toBeNull()
  })

  it("marks the document root transparent for transparent BrowserWindow rendering", () => {
    renderOverlay(roots)

    expect(document.documentElement.classList.contains("bg-transparent")).toBe(true)
    expect(document.body.classList.contains("bg-transparent")).toBe(true)
    expect(document.getElementById("root")?.classList.contains("bg-transparent")).toBe(true)
  })
})

function renderOverlay(roots: Root[]) {
  const container = document.createElement("div")
  container.id = "root"
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<ScreenshotOverlayApp />)
  })
}

function getOverlay(): HTMLDivElement {
  const overlay = document.querySelector("[aria-label='截图区域']")
  if (!(overlay instanceof HTMLDivElement)) throw new Error("Missing overlay")
  return overlay
}

async function pointer(
  target: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  point: { x: number; y: number },
) {
  await act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      clientX: { value: point.x },
      clientY: { value: point.y },
      pointerId: { value: 1 },
    })
    target.dispatchEvent(event)
    await Promise.resolve()
  })
}

async function key(target: HTMLElement, keyName: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: keyName }))
    await Promise.resolve()
  })
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}
