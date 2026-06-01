/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { UseStickToBottomReturn } from "../use-stick-to-bottom"
import { useStickToBottom } from "../use-stick-to-bottom"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
let rafId = 0

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const nextId = ++rafId
    queueMicrotask(() => callback(0))
    return nextId
  })
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots.length = 0
  rafId = 0
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("useStickToBottom", () => {
  it("smoothly follows streamed content while pinned", async () => {
    const { rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })
    scrollTo.mockClear()
    scrollTo.mockClear()

    await act(async () => {
      rerender({ signal: "message:assistant:12", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" })
  })

  it("keeps following when streamed content grows after the viewport was already at bottom", async () => {
    const { rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })
    viewport?.dispatchEvent(new Event("scroll", { bubbles: true }))
    scrollTo.mockClear()

    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2200, clientHeight: 600 })
    await act(async () => {
      rerender({ signal: "message:assistant:20", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).toHaveBeenCalledWith({ top: 2200, behavior: "smooth" })
  })

  it("scrolls to the bottom when historical conversation content loads", async () => {
    const { rerender, scrollTo } = await renderStickHarness({
      signal: "empty",
      latestEntryId: undefined,
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 0, scrollHeight: 2600, clientHeight: 600 })
    scrollTo.mockClear()

    await act(async () => {
      rerender({ signal: "message:assistant:200", latestEntryId: "assistant-history" })
    })

    expect(scrollTo).toHaveBeenCalledWith({ top: 2600, behavior: "smooth" })
  })

  it("uses an instant scroll after forcePin so session switches do not animate from top", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "empty",
      latestEntryId: undefined,
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 0, scrollHeight: 2600, clientHeight: 600 })
    scrollTo.mockClear()

    await act(async () => {
      controls.current?.forcePin()
      rerender({ signal: "message:assistant:200", latestEntryId: "assistant-history" })
    })

    expect(scrollTo).toHaveBeenCalledWith({ top: 2600, behavior: "auto" })
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 2600, behavior: "smooth" })
  })

  it("lets user upward scrolling pause stream following until explicitly resumed", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })
    scrollTo.mockClear()

    await act(async () => {
      viewport?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }))
    })
    expect(controls.current?.isPinned).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()

    await act(async () => {
      rerender({ signal: "message:assistant:20", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).not.toHaveBeenCalled()
    expect(controls.current?.hasUnread).toBe(true)

    await act(async () => {
      controls.current?.scrollToBottom({ behavior: "smooth" })
    })

    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" })
    expect(controls.current?.isPinned).toBe(true)
    expect(controls.current?.hasUnread).toBe(false)
  })

  it("pauses following when user input leaves the viewport off bottom even if wheel direction is unreliable", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })

    await act(async () => {
      rerender({ signal: "message:assistant:12", latestEntryId: "assistant-1" })
    })
    scrollTo.mockClear()

    await act(async () => {
      viewport?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 120 }))
      setScrollMetrics(viewport, { scrollTop: 1000, scrollHeight: 2200, clientHeight: 600 })
      viewport?.dispatchEvent(new Event("scroll", { bubbles: true }))
    })

    expect(controls.current?.isPinned).toBe(false)

    await act(async () => {
      rerender({ signal: "message:assistant:20", latestEntryId: "assistant-1" })
    })

    expect(controls.current?.hasUnread).toBe(true)
  })

  it("does not race a stream update against a recent user wheel intent", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })

    await act(async () => {
      rerender({ signal: "message:assistant:12", latestEntryId: "assistant-1" })
    })
    scrollTo.mockClear()

    await act(async () => {
      viewport?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }))
      rerender({ signal: "message:assistant:20", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).not.toHaveBeenCalled()
    expect(controls.current?.isPinned).toBe(false)
    expect(controls.current?.hasUnread).toBe(true)
  })

  it("does not issue a corrective scroll when the user takes over", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })

    await act(async () => {
      rerender({ signal: "message:assistant:12", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" })
    scrollTo.mockClear()

    await act(async () => {
      setScrollMetrics(viewport, { scrollTop: 1320, scrollHeight: 2000, clientHeight: 600 })
      viewport?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }))
    })

    expect(scrollTo).not.toHaveBeenCalled()
    expect(controls.current?.isPinned).toBe(false)
  })

  it("pauses following when the viewport scrolls upward without a wheel event", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })

    await act(async () => {
      viewport?.dispatchEvent(new Event("scroll", { bubbles: true }))
    })
    await act(async () => {
      rerender({ signal: "message:assistant:12", latestEntryId: "assistant-1" })
    })
    scrollTo.mockClear()

    await act(async () => {
      setScrollMetrics(viewport, { scrollTop: 1100, scrollHeight: 2200, clientHeight: 600 })
      viewport?.dispatchEvent(new Event("scroll", { bubbles: true }))
    })

    expect(controls.current?.isPinned).toBe(false)

    await act(async () => {
      rerender({ signal: "message:assistant:20", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 2200, behavior: "smooth" })
    expect(controls.current?.hasUnread).toBe(true)
  })

  it("does not re-enable following from a later pinned scroll event after user interruption", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })

    await act(async () => {
      rerender({ signal: "message:assistant:12", latestEntryId: "assistant-1" })
    })
    await act(async () => {
      viewport?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }))
      setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })
      viewport?.dispatchEvent(new Event("scroll", { bubbles: true }))
    })
    scrollTo.mockClear()

    await act(async () => {
      rerender({ signal: "message:assistant:20", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).not.toHaveBeenCalledWith({ top: 2000, behavior: "smooth" })
    expect(controls.current?.isPinned).toBe(false)
    expect(controls.current?.hasUnread).toBe(true)
  })

  it("re-enables following when the user manually scrolls back to the bottom", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })

    await act(async () => {
      rerender({ signal: "message:assistant:12", latestEntryId: "assistant-1" })
    })
    scrollTo.mockClear()

    await act(async () => {
      setScrollMetrics(viewport, { scrollTop: 1000, scrollHeight: 2000, clientHeight: 600 })
      viewport?.dispatchEvent(new Event("scroll", { bubbles: true }))
    })

    expect(controls.current?.isPinned).toBe(false)

    await act(async () => {
      rerender({ signal: "message:assistant:20", latestEntryId: "assistant-1" })
    })

    expect(controls.current?.hasUnread).toBe(true)

    await act(async () => {
      setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })
      viewport?.dispatchEvent(new Event("scroll", { bubbles: true }))
    })

    expect(controls.current?.isPinned).toBe(true)
    expect(controls.current?.hasUnread).toBe(false)

    await act(async () => {
      rerender({ signal: "message:assistant:24", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" })
  })

  it("pauses following when wheel input is captured on window inside the timeline area", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })
    setViewportRect(viewport, { bottom: 700, left: 100, right: 900, top: 100 })
    scrollTo.mockClear()

    await act(async () => {
      window.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        clientX: 500,
        clientY: 300,
        deltaY: -120,
      }))
    })

    expect(controls.current?.isPinned).toBe(false)

    await act(async () => {
      rerender({ signal: "message:assistant:20", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 2000, behavior: "smooth" })
    expect(controls.current?.hasUnread).toBe(true)
  })

  it("stays pinned when wheel input at bottom does not move the viewport away", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })
    setViewportRect(viewport, { bottom: 700, left: 100, right: 900, top: 100 })
    scrollTo.mockClear()

    await act(async () => {
      window.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        clientX: 500,
        clientY: 300,
        deltaY: 120,
      }))
    })

    expect(controls.current?.isPinned).toBe(true)

    await act(async () => {
      rerender({ signal: "message:assistant:20", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" })
    expect(controls.current?.hasUnread).toBe(false)
  })

  it("ignores global wheel input outside the viewport bounds", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
    })
    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })
    setViewportRect(viewport, { bottom: 700, left: 100, right: 900, top: 100 })
    scrollTo.mockClear()

    await act(async () => {
      window.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        clientX: 950,
        clientY: 300,
        deltaY: -120,
      }))
    })

    expect(controls.current?.isPinned).toBe(true)

    await act(async () => {
      rerender({ signal: "message:assistant:20", latestEntryId: "assistant-1" })
    })

    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" })
    expect(controls.current?.hasUnread).toBe(false)
  })

  it("attaches wheel handling when the viewport mounts after the hook", async () => {
    const { controls, rerender, scrollTo } = await renderStickHarness({
      signal: "message:assistant:4",
      latestEntryId: "assistant-1",
      renderViewport: false,
    })

    await act(async () => {
      rerender({
        signal: "message:assistant:4",
        latestEntryId: "assistant-1",
        renderViewport: true,
      })
    })

    const viewport = document.querySelector<HTMLDivElement>("[data-testid='viewport']")
    expect(viewport).not.toBeNull()
    setScrollMetrics(viewport, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })
    scrollTo.mockClear()

    await act(async () => {
      window.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        deltaY: -120,
      }))
    })

    expect(controls.current?.isPinned).toBe(false)

    await act(async () => {
      rerender({
        signal: "message:assistant:20",
        latestEntryId: "assistant-1",
        renderViewport: true,
      })
    })

    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 2000, behavior: "smooth" })
    expect(controls.current?.hasUnread).toBe(true)
  })

})

function StickHarness({
  latestEntryId,
  onStick,
  renderViewport = true,
  signal,
}: {
  readonly latestEntryId: string | undefined
  readonly onStick: (stick: UseStickToBottomReturn) => void
  readonly renderViewport?: boolean
  readonly signal: string
}) {
  const stick = useStickToBottom({ contentSignal: [signal, latestEntryId], latestEntryId })
  useEffect(() => {
    onStick(stick)
  }, [onStick, stick])
  return renderViewport ? <div ref={stick.viewportRef} data-testid="viewport" /> : null
}

async function renderStickHarness(initialProps: {
  readonly latestEntryId: string | undefined
  readonly renderViewport?: boolean
  readonly signal: string
}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  const controls: { current: UseStickToBottomReturn | null } = { current: null }
  const scrollTo = vi.fn(function scrollTo(this: HTMLElement, options?: ScrollToOptions) {
    if (typeof options?.top === "number") {
      this.scrollTop = options.top
    }
  })
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: scrollTo,
  })

  const render = (props: typeof initialProps) => {
    root.render(
      <StickHarness
        signal={props.signal}
        latestEntryId={props.latestEntryId}
        renderViewport={props.renderViewport}
        onStick={(stick) => {
          controls.current = stick
        }}
      />,
    )
  }

  await act(async () => {
    render(initialProps)
  })

  return {
    controls,
    rerender: render,
    scrollTo,
  }
}

function setScrollMetrics(
  element: HTMLElement | null,
  metrics: {
    readonly clientHeight: number
    readonly scrollHeight: number
    readonly scrollTop: number
  },
) {
  if (!element) return
  element.scrollTop = metrics.scrollTop
  Object.defineProperties(element, {
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
  })
}

function setViewportRect(
  element: HTMLElement | null,
  rect: {
    readonly bottom: number
    readonly left: number
    readonly right: number
    readonly top: number
  },
) {
  if (!element) return
  element.getBoundingClientRect = () => ({
    bottom: rect.bottom,
    height: rect.bottom - rect.top,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.right - rect.left,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  })
}
