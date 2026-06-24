/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ScreenshotModule } from "../index"
import type { ScreenshotArtifact } from "../../shared/schema"

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock("../../../../src/app-shell/logging", () => ({
  createRendererLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

const artifact: ScreenshotArtifact = {
  id: "shot-1",
  mimeType: "image/png",
  bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
  size: 7,
  width: 300,
  height: 160,
  tempPath: "/tmp/shot-1.png",
  capture: {
    mode: "region",
    region: { x: 12, y: 34, width: 300, height: 160 },
    coordinateSpace: "screen",
    capturedAt: "2026-06-24T08:00:00.000Z",
  },
}

describe("ScreenshotModule", () => {
  const roots: Root[] = []
  const bridge = {
    screenshot: {
      capture: vi.fn(async () => artifact),
      captureToFile: vi.fn(),
      copyToClipboard: vi.fn(),
      copyArtifactToClipboard: vi.fn(async () => ({ copied: true, artifact })),
      saveArtifact: vi.fn(async () => ({
        outputPath: "/tmp/screen.png",
        fileName: "screen.png",
        size: artifact.size,
        artifact,
      })),
      startInteractiveCapture: vi.fn(async () => artifact),
      completeInteractiveCapture: vi.fn(),
      cancelInteractiveCapture: vi.fn(),
      chooseOutputFile: vi.fn(async () => "/tmp/screen.png"),
    },
  }

  beforeEach(() => {
    document.body.innerHTML = ""
    class MockResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: MockResizeObserver,
    })
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: MockResizeObserver,
    })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: bridge,
    })
    for (const method of Object.values(bridge.screenshot)) {
      method.mockClear()
    }
    URL.createObjectURL = vi.fn(() => "blob:screenshot")
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("lets users select a region by dragging and syncs the returned coordinates", async () => {
    renderScreenshotModule(roots)

    await clickLabel("区域")
    await clickButton("框选")

    expect(bridge.screenshot.startInteractiveCapture).toHaveBeenCalledWith({ hideCurrentWindow: false })
    expect(input("X").value).toBe("12")
    expect(input("Y").value).toBe("34")
    expect(input("W").value).toBe("300")
    expect(input("H").value).toBe("160")
  })

  it("copies and saves the current artifact instead of taking a new screenshot", async () => {
    renderScreenshotModule(roots)

    expect(button("复制").disabled).toBe(true)
    expect(button("保存到文件").disabled).toBe(true)

    await clickButton("截图")
    await clickButton("选择")
    await clickButton("复制")
    await clickButton("保存到文件")

    expect(bridge.screenshot.copyArtifactToClipboard).toHaveBeenCalledWith(artifact)
    expect(bridge.screenshot.saveArtifact).toHaveBeenCalledWith({
      artifact,
      outputPath: "/tmp/screen.png",
    })
    expect(bridge.screenshot.copyToClipboard).not.toHaveBeenCalled()
    expect(bridge.screenshot.captureToFile).not.toHaveBeenCalled()
  })

  it("uses save-location copy and aligned region controls", async () => {
    renderScreenshotModule(roots)

    await clickLabel("区域")

    const output = document.getElementById("screenshot-output")
    expect(output).toBeInstanceOf(HTMLInputElement)
    expect((output as HTMLInputElement).placeholder).toBe("选择保存位置")
    expect((output as HTMLInputElement).readOnly).toBe(true)
    expect(document.querySelector("[aria-label='选择保存位置']")).toBeTruthy()
    expect(document.querySelector("[data-testid='screenshot-region-fields']")).toBeTruthy()
    expect(document.querySelector("[data-testid='screenshot-region-pick']")).toBeTruthy()
  })
})

function renderScreenshotModule(roots: Root[]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<ScreenshotModule />)
  })
}

async function clickButton(name: string) {
  await act(async () => {
    button(name).click()
    await Promise.resolve()
  })
}

function button(name: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll("button"))
  const found = buttons.find((candidate) => candidate.textContent?.trim() === name)
  if (!found) throw new Error(`Missing button: ${name}`)
  return found
}

async function clickLabel(name: string) {
  await act(async () => {
    const labels = Array.from(document.querySelectorAll("label"))
    const found = labels.find((candidate) => candidate.textContent?.trim() === name)
    if (!found) throw new Error(`Missing label: ${name}`)
    found.click()
    await Promise.resolve()
  })
}

function input(label: string): HTMLInputElement {
  const labels = Array.from(document.querySelectorAll("label"))
  const found = labels.find((candidate) => candidate.textContent?.trim() === label)
  const id = found?.getAttribute("for")
  const element = id ? document.getElementById(id) : found?.querySelector("input")
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input: ${label}`)
  return element
}
