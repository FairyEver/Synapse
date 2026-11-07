/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

const bridge = vi.hoisted(() => ({
  view: {
    attach: vi.fn().mockResolvedValue(undefined),
    setBounds: vi.fn(),
    detach: vi.fn(),
    setOccluded: vi.fn(),
  },
  navigation: {
    perform: vi.fn(),
    getState: vi.fn().mockResolvedValue({
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      currentUrl: "https://example.com/read",
      error: "none",
    }),
    onStateChanged: vi.fn(() => () => undefined),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({ customApps: bridge }),
}))

import { WebAppViewport } from "../web-app-viewport"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"
let root: ReturnType<typeof createRoot> | null = null
let container: HTMLDivElement | null = null

describe("WebAppViewport", () => {
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it("attaches the native view to the measured viewport and detaches on unmount", async () => {
    const original = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as never
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root!.render(<WebAppViewport appId={appId} />))
    expect(bridge.view.attach).toHaveBeenCalledWith(expect.objectContaining({
      appId,
      bounds: expect.objectContaining({ width: 0, height: 0 }),
    }))

    await act(async () => root?.unmount())
    root = null
    expect(bridge.view.detach).toHaveBeenCalled()
    globalThis.ResizeObserver = original
  })
})
