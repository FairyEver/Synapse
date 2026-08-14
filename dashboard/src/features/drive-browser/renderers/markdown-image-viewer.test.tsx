// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownImageViewer, type MarkdownImageViewerPreview } from './markdown-image-viewer'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
let viewportWidth: number
let viewportHeight: number
let resizeCallbacks: ResizeObserverCallback[]

beforeEach(() => {
  viewportWidth = 800
  viewportHeight = 600
  resizeCallbacks = []
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
    return this.hasAttribute('data-markdown-image-viewport') ? viewportWidth : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
    return this.hasAttribute('data-markdown-image-viewport') ? viewportHeight : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return domRect(this.hasAttribute('data-markdown-image-viewport')
      ? { width: viewportWidth, height: viewportHeight }
      : {})
  })
  vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback)
    }

    observe() {}
    disconnect() {}
    unobserve() {}
  })
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  document.body.innerHTML = ''
  root = null
  host = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MarkdownImageViewer', () => {
  it('fits the image by default and exposes zoom, original-size, and resize controls', async () => {
    renderViewer()
    loadActiveImage(1600, 800)

    expect(zoomText()).toBe('50%')

    await click(buttonByLabel('放大图片'))
    expect(zoomText()).toBe('63%')

    await click(buttonByLabel('按原始尺寸显示图片'))
    expect(zoomText()).toBe('100%')

    await click(buttonByLabel('适合窗口'))
    expect(zoomText()).toBe('50%')

    viewportWidth = 400
    viewportHeight = 300
    await notifyResize()
    expect(zoomText()).toBe('25%')

    await keyDown('1')
    expect(zoomText()).toBe('100%')
    await keyDown('0')
    expect(zoomText()).toBe('25%')
  })

  it('navigates a non-looping image group with buttons and arrow keys', async () => {
    renderViewer(preview({
      images: [
        { src: '/first.png', alt: '第一张' },
        { src: '/second.png', alt: '第二张' },
      ],
    }))

    expect(counterText()).toBe('1 / 2')
    expect(activeImage().getAttribute('src')).toBe('/first.png')
    expect(buttonByLabel('上一张图片').disabled).toBe(true)

    await click(buttonByLabel('下一张图片'))
    expect(counterText()).toBe('2 / 2')
    expect(activeImage().getAttribute('src')).toBe('/second.png')
    expect(buttonByLabel('下一张图片').disabled).toBe(true)

    await keyDown('ArrowLeft')
    expect(counterText()).toBe('1 / 2')
    expect(activeImage().getAttribute('src')).toBe('/first.png')
  })

  it('clamps zoom controls at 10% and 500%', async () => {
    renderViewer()
    loadActiveImage(800, 600)

    await keyDown('-')
    expect(zoomText()).toBe('80%')
    for (let index = 0; index < 20; index += 1) await click(buttonByLabel('缩小图片'))
    expect(zoomText()).toBe('10%')
    expect(buttonByLabel('缩小图片').disabled).toBe(true)

    for (let index = 0; index < 30; index += 1) await click(buttonByLabel('放大图片'))
    expect(zoomText()).toBe('500%')
    expect(buttonByLabel('放大图片').disabled).toBe(true)
  })

  it('zooms around the viewport and constrains drag and pinch transforms', async () => {
    renderViewer()
    loadActiveImage(1600, 800)
    const viewport = imageViewport()

    await dispatch(viewport, new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 300,
      deltaY: -100,
    }))
    expect(zoomText()).toBe('63%')

    await dispatch(activeImage(), new MouseEvent('dblclick', {
      bubbles: true,
      clientX: 400,
      clientY: 300,
    }))
    expect(zoomText()).toBe('50%')
    await dispatch(activeImage(), new MouseEvent('dblclick', {
      bubbles: true,
      clientX: 400,
      clientY: 300,
    }))
    expect(zoomText()).toBe('100%')

    await dispatch(viewport, pointerEvent('pointerdown', 1, 400, 300))
    await dispatch(viewport, pointerEvent('pointermove', 1, 900, 300))
    expect(transformStyle()).toContain('400px')
    await dispatch(viewport, pointerEvent('pointerup', 1, 900, 300))

    await click(buttonByLabel('适合窗口'))
    await dispatch(viewport, pointerEvent('pointerdown', 1, 300, 300))
    await dispatch(viewport, pointerEvent('pointerdown', 2, 500, 300))
    await dispatch(viewport, pointerEvent('pointermove', 2, 700, 300))
    expect(zoomText()).toBe('100%')
    await dispatch(viewport, pointerEvent('pointerup', 1, 300, 300))
    await dispatch(viewport, pointerEvent('pointerup', 2, 700, 300))
  })

  it('shows a concise error state and retries the same protected image url', async () => {
    renderViewer()
    const failedImage = activeImage()

    await dispatch(failedImage, new Event('error', { bubbles: true }))
    expect(document.body.textContent).toContain('图片加载失败')

    await click(buttonWithText('重新加载'))
    expect(document.body.textContent).toContain('正在加载图片')
    expect(activeImage()).not.toBe(failedImage)
    expect(activeImage().getAttribute('src')).toBe('/image.png')
  })
})

function renderViewer(input = preview()) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(<MarkdownImageViewer preview={input} onClose={vi.fn()} />)
  })
}

function preview(overrides: Partial<MarkdownImageViewerPreview> = {}): MarkdownImageViewerPreview {
  const trigger = document.createElement('img')
  trigger.src = '/image.png'
  return {
    images: [{ src: '/image.png', alt: '示意图' }],
    initialIndex: 0,
    trigger,
    ...overrides,
  }
}

function loadActiveImage(width: number, height: number) {
  const image = activeImage()
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width })
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height })
  act(() => image.dispatchEvent(new Event('load', { bubbles: true })))
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
  const dialog = document.querySelector('[data-markdown-image-preview]')
  if (!(dialog instanceof HTMLElement)) throw new Error('Missing image preview dialog')
  await dispatch(dialog, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }))
}

async function dispatch(target: EventTarget, event: Event) {
  await act(async () => target.dispatchEvent(event))
}

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  return event
}

function activeImage() {
  const image = document.querySelector('[data-markdown-image-active]')
  if (!(image instanceof HTMLImageElement)) throw new Error('Missing active image')
  return image
}

function imageViewport() {
  const viewport = document.querySelector('[data-markdown-image-viewport]')
  if (!(viewport instanceof HTMLDivElement)) throw new Error('Missing image viewport')
  return viewport
}

function zoomText() {
  return document.querySelector('[data-markdown-image-zoom]')?.textContent?.trim()
}

function counterText() {
  return document.querySelector('[aria-live="polite"]')?.textContent?.trim()
}

function transformStyle() {
  const element = document.querySelector<HTMLElement>('[data-markdown-image-transform]')
  if (!element) throw new Error('Missing image transform')
  return element.style.transform
}

function buttonByLabel(label: string) {
  const button = document.querySelector(`button[aria-label="${label}"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${label}`)
  return button
}

function buttonWithText(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${text}`)
  return button
}

function domRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...overrides,
  }
}
