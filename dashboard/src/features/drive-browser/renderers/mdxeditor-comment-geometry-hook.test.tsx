// @vitest-environment jsdom

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveAnnotationThreadDto } from '@synapse/shared'
import { useMdxEditorCommentGeometry } from './mdxeditor-comment-geometry'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useMdxEditorCommentGeometry', () => {
  it('batches resize work by frame and measures duplicate ranges once', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
    TestResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const getClientRects = vi.fn(() => [rect({ top: 80, left: 20, width: 50, height: 18 })])
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: getClientRects })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-test-scroll')) return rect({ top: 10, left: 0, width: 600, height: 400 })
      if (this.hasAttribute('data-test-host')) return rect({ top: 10, left: 0, width: 600, height: 300 })
      return rect({})
    })

    renderHook([commentThread('thread-1'), commentThread('thread-2')])
    expect(frames.size).toBe(1)
    await flushFrames(frames)

    expect(getClientRects).toHaveBeenCalledTimes(1)
    expect(resultElement().dataset.anchors).toBe('thread-1:70,thread-2:70')
    const observer = TestResizeObserver.instances[0]
    if (!observer) throw new Error('Missing ResizeObserver')

    observer.emit()
    observer.emit()
    expect(frames.size).toBe(1)
    await flushFrames(frames)

    expect(getClientRects).toHaveBeenCalledTimes(2)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2)

    const scroller = document.querySelector<HTMLElement>('[data-test-scroll="true"]')
    if (!scroller) throw new Error('Missing editor scroller')
    scroller.dispatchEvent(new Event('scroll'))

    expect(frames.size).toBe(0)
    expect(getClientRects).toHaveBeenCalledTimes(2)
  })

  it('cancels pending geometry work when the editor unmounts', () => {
    const frames = new Map<number, FrameRequestCallback>()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(1, callback)
      return 1
    })
    const cancelAnimationFrame = vi.fn((id: number) => frames.delete(id))
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    TestResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', TestResizeObserver)

    renderHook([commentThread('thread-1')])
    expect(frames.size).toBe(1)
    act(() => root?.unmount())
    root = null

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(frames.size).toBe(0)
    expect(TestResizeObserver.instances[0]?.disconnected).toBe(true)
  })

  it('trusts a bounded server range when the authoritative quote status is modified', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = frames.size + 1
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [rect({ top: 80, left: 20, width: 50, height: 18 })],
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-test-scroll')) return rect({ top: 10, left: 0, width: 600, height: 400 })
      if (this.hasAttribute('data-test-host')) return rect({ top: 10, left: 0, width: 600, height: 300 })
      return rect({})
    })
    const source = commentThread('thread-1')
    if (source.target.kind !== 'textRange') throw new Error('Expected text range thread')
    const modified: DriveAnnotationThreadDto = {
      ...source,
      target: { ...source.target, quote: { exact: 'Older', prefix: '', suffix: '' } },
      anchor: source.anchor ? { ...source.anchor, quoteStatus: 'modified' as const } : null,
    }

    renderHook([modified])
    await flushFrames(frames)

    expect(resultElement().dataset.anchors).toBe('thread-1:70')
  })
})

function GeometryHarness({ threads }: { readonly threads: readonly DriveAnnotationThreadDto[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentHostRef = useRef<HTMLDivElement | null>(null)
  const { geometry } = useMdxEditorCommentGeometry({
    enabled: true,
    layoutKey: 'wide:open',
    resetKey: 'version-1',
    threads,
    projection: null,
    imagePreviewUrls: new Map(),
    scrollRef,
    contentHostRef,
  })
  const anchors = Object.entries(geometry.anchorTopByThreadId)
    .map(([threadId, top]) => `${threadId}:${top}`)
    .join(',')
  return (
    <div ref={scrollRef} data-test-scroll='true'>
      <div ref={contentHostRef} data-test-host='true'>
        <div className='drive-mdxeditor-content'>Notes</div>
      </div>
      <output data-test-result='true' data-anchors={anchors} />
    </div>
  )
}

function renderHook(threads: readonly DriveAnnotationThreadDto[]) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<GeometryHarness threads={threads} />))
}

function resultElement(): HTMLOutputElement {
  const element = document.querySelector('[data-test-result="true"]')
  if (!(element instanceof HTMLOutputElement)) throw new Error('Missing result element')
  return element
}

function commentThread(id: string): DriveAnnotationThreadDto {
  return {
    id,
    itemId: 'file',
    baseVersionId: 'version-1',
    targetKind: 'textRange',
    target: {
      schemaVersion: 1,
      kind: 'textRange',
      surface: 'markdownRenderedText',
      range: { start: 0, end: 5 },
      quote: { exact: 'Notes', prefix: '', suffix: '' },
    },
    anchorStatus: 'attached',
    anchor: {
      schemaVersion: 2,
      baseVersionId: 'version-1',
      selectors: {
        schemaVersion: 2,
        kind: 'textRange',
        position: { start: 0, end: 7 },
        quote: { exact: 'Notes', prefix: '', suffix: '' },
        semantic: { blockId: 'block-1', blockLocalRange: { start: 0, end: 5 }, headingPath: [] },
      },
      positionStatus: 'attached',
      quoteStatus: 'exact',
      resolvedSourceRange: { start: 2, end: 7 },
      resolvedRenderedRange: { start: 0, end: 5 },
      confidence: 1,
      lastResolvedVersionId: 'version-1',
    },
    author: { id: 'user-1', email: null, handle: 'author' },
    comments: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    permissions: { canDelete: true },
  }
}

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = []
  disconnected = false
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    TestResizeObserver.instances.push(this)
  }

  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true }
  emit() { this.callback([], this) }
}

function rect(input: Partial<DOMRect>): DOMRect {
  const top = input.top ?? 0
  const left = input.left ?? 0
  const width = input.width ?? 0
  const height = input.height ?? 0
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
}

async function flushFrames(frames: Map<number, FrameRequestCallback>) {
  while (frames.size > 0) {
    const pending = [...frames]
    frames.clear()
    await act(async () => {
      pending.forEach(([, callback]) => callback(0))
    })
  }
}
