/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MailLayout } from "../layout"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let width = 704
const observers = new Map<Element, ResizeObserverCallback>()

beforeEach(() => {
  width = 704
  document.documentElement.style.fontSize = "16px"
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }))
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { observers.set(target, this.callback) }
    unobserve(target: Element) { observers.delete(target) }
    disconnect() { for (const [target, callback] of observers) if (callback === this.callback) observers.delete(target) }
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  observers.clear()
  document.body.innerHTML = ""
  document.documentElement.style.removeProperty("font-size")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderLayout(showDetail = true) {
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<MailLayout navigation={<nav>信箱</nav>} list={<section>信件列表</section>} detail={<article>信件详情</article>} showDetail={showDetail} />))
  return container.firstElementChild!
}

async function resize(container: Element, nextWidth: number) {
  width = nextWidth
  await act(async () => {
    observers.get(container)?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
}

describe("站内信响应式布局", () => {
  it("keeps three columns at a width that fits the navigation, list and detail", () => {
    const container = renderLayout()
    expect(container.getAttribute("data-wide")).toBe("true")
    expect(container.querySelectorAll('[data-slot="resizable-handle"]')).toHaveLength(2)
    expect(container.querySelector("section")?.parentElement).not.toBe(container.querySelector("article")?.parentElement)
  })

  it("switches to compact mode only below the panel width budget and restores columns when widened", async () => {
    const container = renderLayout()
    await resize(container, 703)
    expect(container.getAttribute("data-wide")).toBe("false")
    expect(container.querySelector('[data-slot="resizable-panel-group"]')).toBeNull()
    expect(container.querySelector("section")?.parentElement).toBe(container.querySelector("article")?.parentElement)
    await resize(container, 704)
    expect(container.getAttribute("data-wide")).toBe("true")
    expect(container.querySelectorAll('[data-slot="resizable-handle"]')).toHaveLength(2)
  })

  it("does not inflate pixel-based panel constraints when the root font is larger", () => {
    document.documentElement.style.fontSize = "20px"
    width = 800
    const container = renderLayout()
    expect(container.querySelectorAll('[data-slot="resizable-handle"]')).toHaveLength(2)
  })

  it("keeps navigation beside the list when there is no detail pane", () => {
    const container = renderLayout(false)
    expect(container.querySelectorAll('[data-slot="resizable-handle"]')).toHaveLength(1)
    expect(container.querySelector("article")).toBeNull()
  })
})
