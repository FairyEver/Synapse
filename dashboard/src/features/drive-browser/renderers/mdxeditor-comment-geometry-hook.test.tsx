// @vitest-environment jsdom

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveAnnotationThreadDto, DriveMarkdownProjectionDto } from '@synapse/shared'
import {
  MILKDOWN_COMMENT_IGNORED_SELECTOR,
  useDriveEditorCommentGeometry,
} from './drive-editor-comment-geometry'

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
  Reflect.deleteProperty(document, 'fonts')
})

describe('useDriveEditorCommentGeometry', () => {
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

  it('measures Milkdown ProseMirror text with the same Unicode range contract', async () => {
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

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(<MilkdownGeometryHarness threads={[commentThread('thread-1')]} />))
    await flushFrames(frames)

    expect(resultElement().dataset.anchors).toBe('thread-1:70')
  })

  it('excludes Milkdown ordered-list labels from comment offsets', async () => {
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

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <MilkdownGeometryHarness
        threads={[commentThread('thread-1', { start: 15, end: 20 }, 'After')]}
        withOrderedList
      />
    ))
    await flushFrames(frames)

    expect(resultElement().dataset.anchors).toBe('thread-1:70')
  })

  it('positions a Milkdown range across an inline hardbreak', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = frames.size + 1
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const getClientRects = vi.fn(() => [rect({ top: 80, left: 20, width: 50, height: 18 })])
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: getClientRects })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-test-scroll')) return rect({ top: 10, left: 0, width: 600, height: 400 })
      if (this.hasAttribute('data-test-host')) return rect({ top: 10, left: 0, width: 600, height: 300 })
      return rect({})
    })

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <MilkdownGeometryHarness
        threads={[commentThread('thread-1', { start: 1, end: 18 }, 'line one\nline two')]}
        withHardbreak
      />
    ))
    await flushFrames(frames)

    expect(getClientRects).toHaveBeenCalledOnce()
    expect(resultElement().dataset.anchors).toBe('thread-1:70')
  })

  it('positions Milkdown text after a raw HTML image alt', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = frames.size + 1
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const getClientRects = vi.fn(() => [rect({ top: 80, left: 20, width: 50, height: 18 })])
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: getClientRects })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-test-scroll')) return rect({ top: 10, left: 0, width: 600, height: 400 })
      if (this.hasAttribute('data-test-host')) return rect({ top: 10, left: 0, width: 600, height: 300 })
      return rect({})
    })

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <MilkdownGeometryHarness
        threads={[commentThread('thread-1', { start: 15, end: 20 }, 'after')]}
        withRawHtmlImage
      />
    ))
    await flushFrames(frames)

    expect(getClientRects).toHaveBeenCalledOnce()
    expect(resultElement().dataset.anchors).toBe('thread-1:70')
  })

  it('discovers a delayed ProseMirror root and observes its layout changes until unmount', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    TestMutationObserver.instances = []
    TestResizeObserver.instances = []
    vi.stubGlobal('MutationObserver', TestMutationObserver)
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const fonts = new EventTarget()
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    const getClientRects = vi.fn(() => [rect({ top: 80, left: 20, width: 50, height: 18 })])
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: getClientRects })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-test-scroll')) return rect({ top: 10, left: 0, width: 600, height: 400 })
      if (this.hasAttribute('data-test-host')) return rect({ top: 10, left: 0, width: 600, height: 300 })
      return rect({ top: 80, left: 20, width: 50, height: 18 })
    })

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(<MilkdownGeometryHarness threads={[commentThread('thread-1')]} mounted={false} />))

    const mutationObserver = TestMutationObserver.instances[0]
    const resizeObserver = TestResizeObserver.instances[0]
    if (!mutationObserver || !resizeObserver) throw new Error('Missing geometry observers')
    expect(mutationObserver.observedTargets).toContain(document.querySelector('[data-test-host="true"]'))
    expect(frames.size).toBe(0)

    act(() => root?.render(<MilkdownGeometryHarness threads={[commentThread('thread-1')]} withImage />))
    mutationObserver.emit(document.querySelector('[data-test-host="true"]'))
    await flushFrames(frames)
    expect(getClientRects).toHaveBeenCalledTimes(1)

    const image = document.querySelector<HTMLImageElement>('.ProseMirror img')
    const contentRoot = document.querySelector<HTMLElement>('.ProseMirror')
    if (!image || !contentRoot) throw new Error('Missing delayed Milkdown content')
    expect(resizeObserver.observedTargets).toEqual(expect.arrayContaining([contentRoot, image]))
    image.dispatchEvent(new Event('load'))
    await flushFrames(frames)
    expect(getClientRects).toHaveBeenCalledTimes(2)

    resizeObserver.emit()
    await flushFrames(frames)
    expect(getClientRects).toHaveBeenCalledTimes(3)

    mutationObserver.emit(contentRoot)
    await flushFrames(frames)
    expect(getClientRects).toHaveBeenCalledTimes(4)

    fonts.dispatchEvent(new Event('loadingdone'))
    await flushFrames(frames)
    expect(getClientRects).toHaveBeenCalledTimes(5)

    act(() => root?.unmount())
    root = null
    expect(mutationObserver.disconnected).toBe(true)
    expect(resizeObserver.disconnected).toBe(true)
    image.dispatchEvent(new Event('load'))
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(frames.size).toBe(0)
  })

  it('does not attach an image comment by URL when its projected image is missing', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('ResizeObserver', TestResizeObserver)

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <MilkdownGeometryHarness
        threads={[imageCommentThread()]}
        projection={duplicateImageProjection()}
        withDuplicateImages
      />
    ))
    await flushFrames(frames)

    expect(resultElement().dataset.anchors).toBe('thread-image:null')
  })

  it('uses the shared Anchor V2 image geometry in Milkdown', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-test-scroll')) return rect({ top: 10, left: 0, width: 600, height: 400 })
      if (this.hasAttribute('data-test-host')) return rect({ top: 10, left: 0, width: 600, height: 300 })
      if (this instanceof HTMLImageElement && this.alt === 'second') {
        return rect({ top: 80, left: 20, width: 50, height: 40 })
      }
      return rect({ top: 40, left: 20, width: 50, height: 40 })
    })

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <MilkdownGeometryHarness
        threads={[anchoredImageCommentThread()]}
        projection={duplicateImageProjection()}
        withDuplicateImages
      />
    ))
    await flushFrames(frames)

    expect(resultElement().dataset.anchors).toBe('thread-image:70')
  })
})

function GeometryHarness({ threads }: { readonly threads: readonly DriveAnnotationThreadDto[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentHostRef = useRef<HTMLDivElement | null>(null)
  const { geometry } = useDriveEditorCommentGeometry({
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

function MilkdownGeometryHarness({
  threads,
  mounted = true,
  projection = null,
  withDuplicateImages = false,
  withHardbreak = false,
  withImage = false,
  withOrderedList = false,
  withRawHtmlImage = false,
}: {
  readonly threads: readonly DriveAnnotationThreadDto[]
  readonly mounted?: boolean
  readonly projection?: DriveMarkdownProjectionDto | null
  readonly withDuplicateImages?: boolean
  readonly withHardbreak?: boolean
  readonly withImage?: boolean
  readonly withOrderedList?: boolean
  readonly withRawHtmlImage?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentHostRef = useRef<HTMLDivElement | null>(null)
  const { geometry } = useDriveEditorCommentGeometry({
    enabled: true,
    layoutKey: 'wide:open',
    resetKey: 'version-1',
    threads,
    projection,
    imagePreviewUrls: new Map(),
    scrollRef,
    contentHostRef,
    contentRootSelector: '.milkdown .ProseMirror',
    ignoredElementSelector: MILKDOWN_COMMENT_IGNORED_SELECTOR,
  })
  const anchors = Object.entries(geometry.anchorTopByThreadId)
    .map(([threadId, top]) => `${threadId}:${top}`)
    .join(',')
  return (
    <div ref={scrollRef} data-test-scroll='true'>
      <div ref={contentHostRef} data-test-host='true'>
        <div className='milkdown'>
          {mounted ? <div className='ProseMirror'>
            {withRawHtmlImage ? (
              <p>Before <span data-type='html' data-value='<img src="/object/x" alt="Raw alt">'>{'<img src="/object/x" alt="Raw alt">'}</span> after</p>
            ) : withHardbreak ? (
              <p>🙂line one<span data-type='hardbreak' data-is-inline='true'> </span>line two</p>
            ) : withOrderedList ? (
              <>
                <p>Before</p>
                <ol>
                  <li className='list-item'>
                    <div className='label-wrapper' contentEditable={false}><span className='label'>1.</span></div>
                    <div className='children'><p>List item</p></div>
                  </li>
                </ol>
                <p>After</p>
              </>
            ) : (
              <>
                Notes
                {withImage ? <img src='/files/layout.png' alt='layout' /> : null}
                {withDuplicateImages ? (
                  <>
                    <img src='/files/duplicate.png' alt='first' />
                    <img src='/files/duplicate.png' alt='second' />
                  </>
                ) : null}
              </>
            )}
          </div> : null}
        </div>
      </div>
      <output data-test-result='true' data-anchors={anchors} />
    </div>
  )
}

function resultElement(): HTMLOutputElement {
  const element = document.querySelector('[data-test-result="true"]')
  if (!(element instanceof HTMLOutputElement)) throw new Error('Missing result element')
  return element
}

function commentThread(
  id: string,
  range: { readonly start: number; readonly end: number } = { start: 0, end: 5 },
  quote = 'Notes',
): DriveAnnotationThreadDto {
  return {
    id,
    itemId: 'file',
    baseVersionId: 'version-1',
    targetKind: 'textRange',
    target: {
      schemaVersion: 1,
      kind: 'textRange',
      surface: 'markdownRenderedText',
      range,
      quote: { exact: quote, prefix: '', suffix: '' },
    },
    anchorStatus: 'attached',
    anchor: {
      schemaVersion: 2,
      baseVersionId: 'version-1',
      selectors: {
        schemaVersion: 2,
        kind: 'textRange',
        position: { start: 0, end: 7 },
        quote: { exact: quote, prefix: '', suffix: '' },
        semantic: { blockId: 'block-1', blockLocalRange: range, headingPath: [] },
      },
      positionStatus: 'attached',
      quoteStatus: 'exact',
      resolvedSourceRange: { start: 2, end: 7 },
      resolvedRenderedRange: range,
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

function imageCommentThread(): DriveAnnotationThreadDto {
  return {
    ...commentThread('thread-image'),
    targetKind: 'image',
    target: {
      schemaVersion: 1,
      kind: 'image',
      surface: 'markdownRenderedImage',
      imageId: 'deleted-image',
      resourceKey: 'file:duplicate',
      source: { startOffset: 0, endOffset: 24 },
      snapshot: { src: '/files/duplicate.png', alt: 'deleted', title: null },
      blockHint: { blockId: 'block-image', blockIndex: 0, imageIndex: 0, headingPath: [] },
    },
    anchor: null,
  }
}

function anchoredImageCommentThread(): DriveAnnotationThreadDto {
  const thread = imageCommentThread()
  if (thread.target.kind !== 'image') throw new Error('Expected image thread')
  return {
    ...thread,
    anchorStatus: 'orphaned',
    anchor: {
      schemaVersion: 2,
      baseVersionId: thread.baseVersionId,
      selectors: {
        schemaVersion: 2,
        kind: 'image',
        position: { start: 0, end: 24 },
        semantic: { blockId: 'block-image', imageIndex: 0, headingPath: [] },
        identity: { imageId: thread.target.imageId, resourceKey: thread.target.resourceKey },
      },
      positionStatus: 'attached',
      quoteStatus: 'exact',
      resolvedSourceRange: { start: 24, end: 48 },
      resolvedRenderedRange: null,
      confidence: 0.96,
      lastResolvedVersionId: 'version-2',
    },
  }
}

function duplicateImageProjection(): DriveMarkdownProjectionDto {
  return {
    schemaVersion: 1,
    parserVersion: 'test',
    sourceSha256: 'hash',
    blocks: [],
    segments: [],
    imageAnchorsVersion: 1,
    images: [0, 1].map((documentIndex) => ({
      imageId: `current-image-${documentIndex}`,
      segmentId: `segment-${documentIndex}`,
      blockId: `block-${documentIndex}`,
      imageIndex: 0,
      documentIndex,
      sourceStart: documentIndex * 24,
      sourceEnd: (documentIndex + 1) * 24,
      renderedStart: 0,
      renderedEnd: 0,
      source: '/files/duplicate.png',
      resourceKey: 'file:duplicate',
      alt: documentIndex === 0 ? 'first' : 'second',
      title: null,
    })),
  }
}

class TestMutationObserver implements MutationObserver {
  static instances: TestMutationObserver[] = []
  disconnected = false
  readonly observedTargets: Node[] = []
  private readonly callback: MutationCallback

  constructor(callback: MutationCallback) {
    this.callback = callback
    TestMutationObserver.instances.push(this)
  }

  observe(target: Node) { this.observedTargets.push(target) }
  disconnect() { this.disconnected = true }
  takeRecords() { return [] }
  emit(target: Node | null) {
    if (!this.disconnected && target) this.callback([{ target } as MutationRecord], this)
  }
}

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = []
  disconnected = false
  readonly observedTargets: Element[] = []
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    TestResizeObserver.instances.push(this)
  }

  observe(target: Element) { this.observedTargets.push(target) }
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
