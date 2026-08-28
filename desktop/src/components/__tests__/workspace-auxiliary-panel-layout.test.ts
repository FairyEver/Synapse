/**
 * @vitest-environment jsdom
 */
import { act, createElement, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  resolveWorkspaceAuxiliaryPanelMode,
  WorkspaceAuxiliaryPanelLayout,
} from "../workspace-auxiliary-panel-layout"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { readonly children: ReactNode }) => createElement("div", null, children),
  ResizablePanel: ({ children }: { readonly children: ReactNode }) => createElement("div", null, children),
  ResizableHandle: () => createElement("div"),
}))

let resizeCallback: ResizeObserverCallback | null = null

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

afterEach(() => {
  document.body.innerHTML = ""
  resizeCallback = null
  vi.unstubAllGlobals()
})

describe("resolveWorkspaceAuxiliaryPanelMode", () => {
  it("keeps the conversation pane when the auxiliary panel is closed", () => {
    expect(resolveWorkspaceAuxiliaryPanelMode(800, false)).toBe("closed")
  })

  it("uses a split layout only when both panes have enough width", () => {
    expect(resolveWorkspaceAuxiliaryPanelMode(1040, true)).toBe("split")
    expect(resolveWorkspaceAuxiliaryPanelMode(1039, true)).toBe("detail")
  })

  it("preserves auxiliary state and focus while switching between detail and split layouts", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 960,
      height: 720,
      top: 0,
      right: 960,
      bottom: 720,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    function Auxiliary() {
      const [wrap, setWrap] = useState(true)
      return createElement("button", {
        type: "button",
        "aria-pressed": wrap,
        onClick: () => setWrap((current) => !current),
      }, "自动换行")
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(WorkspaceAuxiliaryPanelLayout, {
        main: createElement("button", { type: "button" }, "对话输入"),
        auxiliary: createElement(Auxiliary),
        persistenceId: "agent-test",
      }))
    })

    const wrapButton = document.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')!
    await act(async () => {
      wrapButton.focus()
      wrapButton.click()
    })
    expect(wrapButton.getAttribute("aria-pressed")).toBe("false")
    expect(document.activeElement).toBe(wrapButton)

    await act(async () => {
      resizeCallback?.([{ contentRect: { width: 1200 } } as ResizeObserverEntry], {} as ResizeObserver)
    })

    const resizedWrapButton = document.querySelector<HTMLButtonElement>('button[aria-pressed]')!
    expect(resizedWrapButton).toBe(wrapButton)
    expect(resizedWrapButton.getAttribute("aria-pressed")).toBe("false")
    expect(document.activeElement).toBe(resizedWrapButton)

    await act(async () => root.unmount())
  })
})
