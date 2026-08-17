// @vitest-environment jsdom

import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createImageLightbox,
  type ImageLightboxPreview,
} from "./image-lightbox"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DialogCloseContext = createContext<(() => void) | null>(null)

const ImageLightbox = createImageLightbox({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    readonly size?: string
    readonly variant?: string
  }) => (
    <button {...props}>{children}</button>
  ),
  Dialog: ({
    children,
    onOpenChange,
  }: {
    readonly children: ReactNode
    readonly onOpenChange: (open: boolean) => void
  }) => (
    <DialogCloseContext.Provider value={() => onOpenChange(false)}>
      {children}
    </DialogCloseContext.Provider>
  ),
  DialogClose: ({ children }: { readonly children: ReactNode }) => {
    const close = useContext(DialogCloseContext)
    return <span onClick={close ?? undefined}>{children}</span>
  },
  DialogContent: ({
    children,
    showCloseButton: _showCloseButton,
    onPointerDownOutside: _onPointerDownOutside,
    ...props
  }: HTMLAttributes<HTMLDivElement> & {
    readonly showCloseButton?: boolean
    readonly onPointerDownOutside?: (event: { preventDefault: () => void }) => void
  }) => <div role="dialog" {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
  Tooltip: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { readonly children: ReactNode }) => <span>{children}</span>,
  TooltipProvider: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
})

let root: Root | null = null
let host: HTMLDivElement | null = null
let trigger: HTMLButtonElement | null = null
let viewportWidth: number
let viewportHeight: number
let resizeCallbacks: ResizeObserverCallback[]

beforeEach(() => {
  viewportWidth = 800
  viewportHeight = 600
  resizeCallbacks = []
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-image-lightbox-viewport") ? viewportWidth : 0
  })
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-image-lightbox-viewport") ? viewportHeight : 0
  })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return domRect(this.hasAttribute("data-image-lightbox-viewport")
      ? { width: viewportWidth, height: viewportHeight }
      : {})
  })
  vi.stubGlobal("ResizeObserver", class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback)
    }

    observe() {}
    disconnect() {}
    unobserve() {}
  })
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0)
    return 1
  })
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  trigger?.remove()
  document.body.innerHTML = ""
  root = null
  host = null
  trigger = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("ImageLightbox", () => {
  it("fits the image and supports zoom, original size, and viewport resize", async () => {
    renderViewer()
    loadActiveImage(1600, 800)

    expect(zoomText()).toBe("50%")

    await click(buttonByLabel("放大图片"))
    expect(zoomText()).toBe("63%")

    await click(buttonByLabel("按原始尺寸显示图片"))
    expect(zoomText()).toBe("100%")

    await click(buttonByLabel("适合窗口"))
    expect(zoomText()).toBe("50%")

    viewportWidth = 400
    viewportHeight = 300
    await notifyResize()
    expect(zoomText()).toBe("25%")

    await keyDown("1")
    expect(zoomText()).toBe("100%")
    await keyDown("0")
    expect(zoomText()).toBe("25%")
  })

  it("navigates a non-looping image group with controls and keyboard", async () => {
    renderViewer(preview({
      images: [
        { src: "/first.png", alt: "第一张" },
        { src: "/second.png", alt: "第二张" },
      ],
    }))

    expect(counterText()).toBe("1 / 2")
    expect(activeImage().getAttribute("src")).toBe("/first.png")
    expect(buttonByLabel("上一张图片").disabled).toBe(true)

    await click(buttonByLabel("下一张图片"))
    expect(activeImage().getAttribute("src")).toBe("/second.png")
    expect(buttonByLabel("下一张图片").disabled).toBe(true)

    await keyDown("ArrowLeft")
    expect(activeImage().getAttribute("src")).toBe("/first.png")
  })

  it("clamps zoom controls and constrains drag and pinch transforms", async () => {
    renderViewer()
    loadActiveImage(1600, 800)
    const viewport = imageViewport()

    await dispatch(viewport, new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 300,
      deltaY: -100,
    }))
    expect(zoomText()).toBe("63%")

    await dispatch(activeImage(), new MouseEvent("dblclick", {
      bubbles: true,
      clientX: 400,
      clientY: 300,
    }))
    expect(zoomText()).toBe("50%")
    await dispatch(activeImage(), new MouseEvent("dblclick", {
      bubbles: true,
      clientX: 400,
      clientY: 300,
    }))
    expect(zoomText()).toBe("100%")

    for (let index = 0; index < 20; index += 1) await click(buttonByLabel("缩小图片"))
    expect(zoomText()).toBe("10%")
    expect(buttonByLabel("缩小图片").disabled).toBe(true)

    for (let index = 0; index < 30; index += 1) await click(buttonByLabel("放大图片"))
    expect(zoomText()).toBe("500%")
    expect(buttonByLabel("放大图片").disabled).toBe(true)

    await click(buttonByLabel("按原始尺寸显示图片"))
    await dispatch(viewport, pointerEvent("pointerdown", 1, 400, 300))
    await dispatch(viewport, pointerEvent("pointermove", 1, 900, 300))
    expect(transformStyle()).toContain("400px")
    await dispatch(viewport, pointerEvent("pointerup", 1, 900, 300))

    await click(buttonByLabel("适合窗口"))
    await dispatch(viewport, pointerEvent("pointerdown", 1, 300, 300))
    await dispatch(viewport, pointerEvent("pointerdown", 2, 500, 300))
    await dispatch(viewport, pointerEvent("pointermove", 2, 700, 300))
    expect(zoomText()).toBe("100%")
  })

  it("retries a failed image load", async () => {
    renderViewer()
    const failedImage = activeImage()

    await dispatch(failedImage, new Event("error", { bubbles: true }))
    expect(document.body.textContent).toContain("图片加载失败")

    await click(buttonWithText("重新加载"))
    expect(document.body.textContent).toContain("正在加载图片")
    expect(activeImage()).not.toBe(failedImage)
  })

  it("restores focus to the opening element after close", async () => {
    const onClose = vi.fn()
    renderViewer(preview(), onClose)
    const openingElement = trigger
    if (!openingElement) throw new Error("Missing trigger")

    await click(buttonByLabel("关闭图片预览"))

    expect(onClose).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(openingElement)
  })

  it("closes from the empty background without closing from the image or controls", async () => {
    const onClose = vi.fn()
    renderViewer(preview({
      images: [
        { src: "/first.png", alt: "第一张" },
        { src: "/second.png", alt: "第二张" },
      ],
    }), onClose)
    const viewport = imageViewport()

    await dispatch(activeImage(), pointerEvent("pointerdown", 1, 400, 300))
    await dispatch(viewport, pointerEvent("pointerup", 1, 400, 300))
    await dispatch(viewport, new MouseEvent("click", { bubbles: true }))
    await click(buttonByLabel("下一张图片"))
    expect(onClose).not.toHaveBeenCalled()

    await dispatch(viewport, pointerEvent("pointerdown", 2, 100, 100))
    await dispatch(viewport, pointerEvent("pointermove", 2, 120, 100))
    await dispatch(viewport, pointerEvent("pointerup", 2, 120, 100))
    await dispatch(viewport, new MouseEvent("click", { bubbles: true, clientX: 120, clientY: 100 }))
    expect(onClose).not.toHaveBeenCalled()

    await dispatch(viewport, pointerEvent("pointerdown", 3, 100, 100))
    await dispatch(viewport, pointerEvent("pointerup", 3, 100, 100))
    await dispatch(viewport, new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 100 }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(trigger)
  })
})

function renderViewer(input = preview(), onClose = vi.fn()) {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(<ImageLightbox preview={input} onClose={onClose} />)
  })
}

function preview(overrides: Partial<ImageLightboxPreview> = {}): ImageLightboxPreview {
  trigger = document.createElement("button")
  document.body.append(trigger)
  return {
    images: [{ src: "/image.png", alt: "示意图" }],
    initialIndex: 0,
    trigger,
    ...overrides,
  }
}

function loadActiveImage(width: number, height: number) {
  const image = activeImage()
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width })
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height })
  act(() => image.dispatchEvent(new Event("load", { bubbles: true })))
}

async function notifyResize() {
  await act(async () => {
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver)
  })
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.click())
}

async function keyDown(key: string) {
  const dialog = document.querySelector("[data-image-lightbox]")
  if (!(dialog instanceof HTMLElement)) throw new Error("Missing image lightbox")
  await dispatch(dialog, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }))
}

async function dispatch(target: EventTarget, event: Event) {
  await act(async () => target.dispatchEvent(event))
}

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY })
  Object.defineProperty(event, "pointerId", { value: pointerId })
  return event
}

function activeImage() {
  const image = document.querySelector("[data-image-lightbox-active]")
  if (!(image instanceof HTMLImageElement)) throw new Error("Missing active image")
  return image
}

function imageViewport() {
  const viewport = document.querySelector("[data-image-lightbox-viewport]")
  if (!(viewport instanceof HTMLDivElement)) throw new Error("Missing image viewport")
  return viewport
}

function zoomText() {
  return document.querySelector("[data-image-lightbox-zoom]")?.textContent?.trim()
}

function counterText() {
  return document.querySelector("[aria-live='polite']")?.textContent?.trim()
}

function transformStyle() {
  const element = document.querySelector<HTMLElement>("[data-image-lightbox-transform]")
  if (!element) throw new Error("Missing image transform")
  return element.style.transform
}

function buttonByLabel(label: string) {
  const button = document.querySelector(`button[aria-label="${label}"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${label}`)
  return button
}

function buttonWithText(text: string) {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent?.trim() === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${text}`)
  return button
}

function domRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
    ...overrides,
  }
}
