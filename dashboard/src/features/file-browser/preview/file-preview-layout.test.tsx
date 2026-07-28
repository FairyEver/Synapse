// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FILE_PREVIEW_COMPACT_MAX_WIDTH,
  FilePreviewLayout,
  filePreviewLayoutModeForWidth,
  useFilePreviewLayoutMode,
} from './file-preview-layout'
import {
  getCompactOverflowToolbarItems,
  getCompactPrimaryToolbarItems,
  type FilePreviewToolbarItem,
} from './file-preview-toolbar'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
let observers: TestResizeObserver[]

beforeEach(() => {
  observers = []
  vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
    readonly callback: ResizeObserverCallback
    readonly observedElements: Element[] = []

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      observers.push(this)
    }

    observe = vi.fn((target: Element) => {
      this.observedElements.push(target)
    })

    disconnect = vi.fn()
  })
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.unstubAllGlobals()
})

describe('FilePreviewLayout', () => {
  it('switches modes at the content-driven 1024px boundary', () => {
    expect(filePreviewLayoutModeForWidth(390)).toBe('compact')
    expect(filePreviewLayoutModeForWidth(834)).toBe('compact')
    expect(filePreviewLayoutModeForWidth(FILE_PREVIEW_COMPACT_MAX_WIDTH)).toBe('compact')
    expect(filePreviewLayoutModeForWidth(1024)).toBe('regular')
    expect(filePreviewLayoutModeForWidth(1280)).toBe('regular')
  })

  it('responds to its own container width', async () => {
    renderLayout()

    await setObservedWidth(834)
    expect(layout().dataset.filePreviewLayout).toBe('compact')
    expect(probe().dataset.mode).toBe('compact')

    await setObservedWidth(1280)
    expect(layout().dataset.filePreviewLayout).toBe('regular')
    expect(probe().dataset.mode).toBe('regular')
  })

  it('separates compact primary and overflow toolbar items', () => {
    const items: readonly FilePreviewToolbarItem[] = [
      { kind: 'status', id: 'status', label: '未保存' },
      {
        kind: 'button',
        id: 'save',
        label: '保存',
        compactPlacement: 'primary',
      },
      {
        kind: 'button',
        id: 'reload',
        label: '重新加载',
      },
    ]

    expect(getCompactPrimaryToolbarItems(items).map((item) => item.id)).toEqual(['save'])
    expect(getCompactOverflowToolbarItems(items).map((item) => item.id)).toEqual(['status', 'reload'])
  })
})

function renderLayout() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <FilePreviewLayout>
        <LayoutModeProbe />
      </FilePreviewLayout>
    )
  })
}

function LayoutModeProbe() {
  const mode = useFilePreviewLayoutMode()
  return <div data-testid='layout-mode' data-mode={mode} />
}

async function setObservedWidth(width: number) {
  const observer = observers.find((item) => item.observedElements.includes(layout()))
  if (!observer) throw new Error('Missing FilePreviewLayout ResizeObserver')
  await act(async () => {
    observer.callback([
      {
        contentRect: {
          bottom: 844,
          height: 844,
          left: 0,
          right: width,
          top: 0,
          width,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
      } as ResizeObserverEntry,
    ], observer as unknown as ResizeObserver)
  })
}

function layout(): HTMLElement {
  const element = document.querySelector('[data-file-preview-layout]')
  if (!(element instanceof HTMLElement)) throw new Error('Missing preview layout')
  return element
}

function probe(): HTMLElement {
  const element = document.querySelector('[data-testid="layout-mode"]')
  if (!(element instanceof HTMLElement)) throw new Error('Missing layout mode probe')
  return element
}

type TestResizeObserver = {
  readonly callback: ResizeObserverCallback
  readonly observedElements: Element[]
}
