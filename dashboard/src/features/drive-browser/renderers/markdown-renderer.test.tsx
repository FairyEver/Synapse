// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriveMarkdownRenderer } from './markdown-renderer'
import { useAuthStore } from '@/stores/auth-store'
import { DrivePreviewToolbarItemView } from './drive-preview-header'
import { DriveRendererToolbarProvider, useDriveRendererToolbar } from './drive-renderer-toolbar-context'

vi.mock('../use-drive-annotations', () => ({
  useDriveAnnotations: () => annotationsMock,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & {
  ResizeObserver: typeof ResizeObserver
}).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let root: Root | null = null
let host: HTMLDivElement | null = null
let annotationsMock: ReturnType<typeof createAnnotationsMock>
let scrollIntoViewMock: ReturnType<typeof vi.fn>
let scrollContainerScrollToMock: ReturnType<typeof vi.fn>
let rangeRects: DOMRect[]
let resizeObservers: TestResizeObserver[]
let animationFrameCallbacks: Array<{ readonly id: number; readonly callback: FrameRequestCallback }>
let nextAnimationFrameId: number

beforeEach(() => {
  annotationsMock = createAnnotationsMock()
  scrollIntoViewMock = vi.fn()
  scrollContainerScrollToMock = vi.fn()
  rangeRects = [domRect({ left: 80, top: 120, width: 48, height: 20 })]
  resizeObservers = []
  animationFrameCallbacks = []
  nextAnimationFrameId = 1
  Element.prototype.scrollIntoView = scrollIntoViewMock
  Range.prototype.getBoundingClientRect = vi.fn(() => rangeRects[0] ?? domRect())
  Range.prototype.getClientRects = vi.fn(() => rangeRects as unknown as DOMRectList)
  vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
    readonly callback: ResizeObserverCallback
    readonly observe = vi.fn((target: Element) => {
      this.observedElements.push(target)
    })
    readonly disconnect = vi.fn()
    readonly observedElements: Element[] = []

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      resizeObservers.push(this)
    }
  })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextAnimationFrameId
    nextAnimationFrameId += 1
    animationFrameCallbacks.push({ id, callback })
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    animationFrameCallbacks = animationFrameCallbacks.filter((item) => item.id !== id)
  })
  useAuthStore.getState().auth.reset()
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DriveMarkdownRenderer', () => {
  it('aligns the outline rail with the markdown content top padding', () => {
    renderMarkdown({ previewData: preview({ outline: [outlineItem()] }) })

    const outlineNav = document.querySelector('nav[aria-label="目录"]')
    expect(outlineNav?.className).toContain('top-6')
    expect(outlineNav?.className).not.toContain('top-16')
  })

  it('keeps markdown rails pinned to the viewport edges while only the document body has a max width', () => {
    renderMarkdown({ previewData: preview({ outline: [outlineItem()] }) })

    const layout = document.querySelector('[data-testid="markdown-layout"]')
    const outlineRail = document.querySelector('nav[aria-label="目录"]')?.closest('[data-slot="resizable-panel"]')
    const outlineAside = document.querySelector('nav[aria-label="目录"]')?.closest('aside')
    const documentColumn = document.querySelector('[data-testid="markdown-body"]')?.parentElement
    const documentScroller = document.querySelector('[data-testid="markdown-document-scroll"]')

    expect(layout?.className).toContain('h-full')
    expect(layout?.className).toContain('overflow-hidden')
    expect(layout?.className).toContain('w-full')
    expect(layout?.className).not.toContain('min-h-full')
    expect(layout?.className).not.toContain('px-4')
    expect(layout?.className).not.toContain('py-6')
    expect(layout?.className).not.toContain('md:px-6')
    expect(layout?.className).not.toContain('mx-auto')
    expect(layout?.className).not.toContain('max-w-7xl')
    expect(layout?.className).not.toContain('gap-6')
    expect(document.querySelector('[data-slot="resizable-panel-group"]')).not.toBeNull()
    expect(outlineRail?.getAttribute('data-slot')).toBe('resizable-panel')
    expect(outlineRail?.getAttribute('data-panel-size')).toBe('16%')
    expect(outlineRail?.getAttribute('data-panel-min-size')).toBe('12%')
    expect(outlineRail?.getAttribute('data-panel-max-size')).toBe('22%')
    expect(outlineAside?.className).toContain('px-4')
    expect(outlineAside?.className).toContain('py-6')
    expect(outlineAside?.className).toContain('overflow-hidden')
    expect(outlineAside?.className.split(/\s+/u)).not.toContain('hidden')
    expect(outlineAside?.className).not.toContain('xl:block')
    expect(documentScroller?.className).toContain('h-full')
    expect(documentScroller?.className).toContain('overflow-auto')
    expect(documentScroller?.className).toContain('px-4')
    expect(documentScroller?.className).toContain('py-6')
    expect(documentColumn?.className).toContain('mx-auto')
    expect(documentColumn?.className).not.toContain('ml-auto')
    expect(documentColumn?.className).toContain('max-w-3xl')
    expect(documentColumn?.getAttribute('data-markdown-width-mode')).toBe('reading')
  })

  it('switches the markdown document between reading and wide width', async () => {
    renderMarkdown()

    const documentColumn = () => document.querySelector('[data-testid="markdown-body"]')?.parentElement
    expect(documentColumn()?.className).toContain('max-w-3xl')
    expect(documentColumn()?.getAttribute('data-markdown-width-mode')).toBe('reading')
    expect(buttonWithText('宽屏')).not.toBeNull()

    await click(buttonWithText('宽屏'))

    expect(documentColumn()?.className).not.toContain('max-w-3xl')
    expect(documentColumn()?.className).toContain('max-w-none')
    expect(documentColumn()?.className).toContain('w-full')
    expect(documentColumn()?.getAttribute('data-markdown-width-mode')).toBe('wide')
    expect(buttonWithText('阅读')).not.toBeNull()
  })

  it('keeps wide markdown tables scrollable inside the reader column', () => {
    renderMarkdown({
      previewData: preview({
        text: [
          '前端文件:行号',
          'v-for 数据源',
          '处理口径',
        ].join(''),
        html: [
          '<div data-drive-markdown-table-scroll="true">',
          '<table>',
          '<thead><tr><th>#</th><th>前端文件:行号</th><th>v-for 数据源</th><th>处理口径</th></tr></thead>',
          '<tbody><tr>',
          '<td>1</td>',
          '<td><code>app/portal/views/dashboard/material/operation/special/transport/list.vue:26</code></td>',
          '<td><code>(item, index) in record.orderList?.length ? record.orderList : [record]</code></td>',
          '<td>来自详情状态对象，但当前文件未能静态拼出完整接口。</td>',
          '</tr></tbody>',
          '</table>',
          '</div>',
        ].join(''),
      }),
    })

    const body = document.querySelector<HTMLElement>('[data-testid="markdown-body"]')
    const wrapper = document.querySelector<HTMLElement>('[data-drive-markdown-table-scroll="true"]')
    const table = document.querySelector<HTMLTableElement>('[data-testid="markdown-body"] table')
    expect(wrapper).not.toBeNull()
    expect(table).not.toBeNull()
    expect(body?.className).toContain('[&_[data-drive-markdown-table-scroll="true"]]:max-w-full')
    expect(body?.className).toContain('[&_[data-drive-markdown-table-scroll="true"]]:overflow-x-auto')
    expect(body?.className).toContain('[&_table]:w-max')
    expect(body?.className).toContain('[&_table]:min-w-full')
    expect(body?.className).toContain('[&_td:not(:first-child)]:min-w-56')
    expect(body?.className).toContain('[&_th:not(:first-child)]:min-w-56')
    expect(body?.className).not.toContain('[&_table]:block')
    expect(body?.className).not.toContain('[&_table]:w-full')
    expect(body?.parentElement?.className).toContain('max-w-3xl')
  })

  it('opens the comment rail by default when comments exist', async () => {
    annotationsMock.threads = [thread()]
    const windowAddEventListener = vi.spyOn(window, 'addEventListener')
    renderMarkdown({ previewData: preview({ outline: [outlineItem()] }) })

    await act(async () => undefined)

    expect(document.body.textContent).toContain('评论')
    expect(document.body.textContent).toContain('1')
    expect(document.body.textContent).toContain('Comment body')
    expect(toolbarButtonTexts()).toEqual(['宽屏', '目录', '评论 1'])
    expect(commentRailTitle()?.querySelector('button[aria-label="刷新评论"]')).not.toBeNull()
    expect(commentRailShell()?.className).toContain('border-l')
    expect(commentRailPanelGroup()?.getAttribute('data-slot')).toBe('resizable-panel')
    expect(commentRailPanelGroup()?.getAttribute('data-panel-size')).toBe('22%')
    expect(commentRailPanelGroup()?.getAttribute('data-panel-min-size')).toBe('17%')
    expect(commentRailPanelGroup()?.getAttribute('data-panel-max-size')).toBe('32%')
    expect(commentRailShell()?.className).toContain('overflow-hidden')
    expect(commentRailShell()?.className).not.toContain('gap-6')
    expect(commentRailPanel()?.className).toContain('h-full')
    expect(commentRailPanel()?.className).not.toContain('max-h-screen')
    expect(commentRailTitle()?.className).toContain('sticky')
    expect(commentRailTitle()?.className).toContain('top-0')
    expect(commentRailScrollRegion()?.className).not.toContain('overflow-y-auto')
    expect(windowAddEventListener).not.toHaveBeenCalledWith('resize', expect.any(Function))
    expect(document.querySelector('[data-testid="markdown-body"]')?.parentElement?.className).toContain('mx-auto')
    expect(document.querySelector('[data-testid="markdown-body"]')?.parentElement?.className).not.toContain('ml-auto')

    windowAddEventListener.mockRestore()
  })

  it('refreshes comments from the comment rail header', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown()

    await act(async () => undefined)

    await click(buttonByLabel('刷新评论'))

    expect(annotationsMock.refresh).toHaveBeenCalledTimes(1)
    expect(toolbarButtonTexts()).not.toContain('刷新评论')
  })

  it('opens a selection action before creating a comment from selected rendered text', async () => {
    renderMarkdown()
    const strongText = document.querySelector('strong')?.firstChild
    if (!strongText) throw new Error('missing strong text')
    const range = document.createRange()
    range.setStart(strongText, 0)
    range.setEnd(strongText, 2)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(document.querySelector('textarea')).toBeNull()
    expect(buttonWithText('添加评论')).not.toBeNull()
    expect(buttonWithText('添加评论').className).toContain('shadow-md')
    expect(selectionAction()?.className).not.toContain('bg-popover')
    expect(selectionAction()?.className).not.toContain('border')
    expect(pendingOverlay()).not.toBeNull()
    expect(pendingOverlay()?.className).toContain('mix-blend-multiply')
    expect(pendingMarker()).toBeNull()

    await click(buttonWithText('添加评论'))
    expect(pendingOverlay()).not.toBeNull()
    await inputValue(textarea(), 'New comment')
    await click(buttonWithText('评论'))

    expect(annotationsMock.createThread).toHaveBeenCalledWith(expect.objectContaining({
      targetKind: 'textRange',
      body: 'New comment',
      target: expect.objectContaining({
        range: { start: 3, end: 5 },
        quote: expect.objectContaining({ exact: '重点' }),
      }),
    }))
    expect(pendingOverlay()).toBeNull()
  })

  it('clears the pending marker when the add comment dialog is cancelled', async () => {
    renderMarkdown()
    selectStrongText()

    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(pendingOverlay()).not.toBeNull()
    expect(pendingMarker()).toBeNull()

    await click(buttonWithText('添加评论'))
    await click(buttonWithText('取消'))

    expect(pendingOverlay()).toBeNull()
    expect(document.body.textContent).not.toContain('添加评论')
  })

  it('does not open the composer for logged-out share viewers', async () => {
    renderMarkdown({ annotationContext: { context: 'share', shareId: 'share-1' } })
    selectStrongText()

    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(document.querySelector('textarea')).toBeNull()
    expect(document.body.textContent).not.toContain('添加评论')
    expect(pendingOverlay()).toBeNull()
  })

  it('does not open the composer for read-only share viewers', async () => {
    useAuthStore.getState().auth.setUser({
      id: 'reader-1',
      email: 'reader@example.com',
      displayName: null,
      avatarUrl: null,
      role: 'user',
      storageLimitBytes: '0',
      storageUsedBytes: '0',
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:00.000Z',
    })
    renderMarkdown({ annotationContext: { context: 'share', shareId: 'share-1', canWrite: false } })
    selectStrongText()

    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(document.querySelector('textarea')).toBeNull()
    expect(document.body.textContent).not.toContain('添加评论')
    expect(pendingOverlay()).toBeNull()
  })

  it('hides reply actions for logged-out share viewers', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown({ annotationContext: { context: 'share', shareId: 'share-1' } })

    await act(async () => undefined)

    expect(document.body.textContent).toContain('Comment body')
    expect(document.body.textContent).not.toContain('回复')
  })

  it('does not show comment controls for markdown previews whose file name is not .md', async () => {
    renderMarkdown({ currentItem: current({ name: 'notes.mdx' }) })
    selectStrongText()

    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(document.body.textContent).not.toContain('评论')
    expect(document.body.textContent).not.toContain('添加评论')
    expect(document.querySelector('textarea')).toBeNull()
    expect(pendingOverlay()).toBeNull()
  })

  it('scrolls the preview container to the measured overlay rect when a thread is focused from the rail', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown()

    await act(async () => undefined)
    await click(elementWithText('Comment body'))

    expect(scrollIntoViewMock).not.toHaveBeenCalled()
    expect(scrollContainerScrollToMock).toHaveBeenCalledWith({ top: 80, behavior: 'smooth' })
    expect(host?.scrollTop).toBe(80)
  })

  it('renders existing comments as overlay rectangles and focuses them by click position', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown()

    await act(async () => undefined)

    const overlay = threadOverlay('thread-1')
    expect(overlay).not.toBeNull()
    expect(overlay?.className).toContain('mix-blend-multiply')
    expect(document.querySelector('[data-drive-annotation-thread-id]')).toBeNull()

    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: 96,
        clientY: 128,
      }))
    })

    expect(document.body.textContent).toContain('评论')
    expect(document.body.textContent).toContain('1')
    expect(scrollIntoViewMock).not.toHaveBeenCalled()
    expect(scrollContainerScrollToMock).toHaveBeenCalledWith({ top: 80, behavior: 'smooth' })
  })

  it('remeasures comment overlays after markdown body resize without using window resize listeners', async () => {
    annotationsMock.threads = [thread()]
    const windowAddEventListener = vi.spyOn(window, 'addEventListener')
    renderMarkdown()

    await act(async () => undefined)

    expect(markdownResizeObserver()).not.toBeNull()
    expect(threadOverlay('thread-1')?.getAttribute('style')).toContain('top: 120px')
    expect(threadOverlay('thread-1')?.getAttribute('style')).toContain('left: 80px')

    rangeRects = [domRect({ left: 160, top: 240, width: 90, height: 22 })]
    triggerMarkdownResize()
    triggerMarkdownResize()
    triggerMarkdownResize()

    expect(animationFrameCallbacks).toHaveLength(1)

    await flushAnimationFrames()

    expect(threadOverlay('thread-1')?.getAttribute('style')).toContain('top: 240px')
    expect(threadOverlay('thread-1')?.getAttribute('style')).toContain('left: 160px')
    expect(threadOverlay('thread-1')?.getAttribute('style')).toContain('width: 90px')

    scrollContainerScrollToMock.mockClear()
    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: 180,
        clientY: 250,
      }))
    })

    expect(scrollContainerScrollToMock).toHaveBeenCalledWith({ top: 201, behavior: 'smooth' })
    expect(windowAddEventListener).not.toHaveBeenCalledWith('resize', expect.any(Function))

    windowAddEventListener.mockRestore()
  })

  it('moves anchored comment cards with a compositor transform during markdown document scroll', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown()

    await act(async () => undefined)

    expect(threadCommentCard('thread-1')?.getAttribute('style')).toContain('top: 80px')
    expect(commentAnchorLayer()?.style.transform).toBe('')

    const scroller = markdownDocumentScroller()
    scroller.scrollTop = 50
    await act(async () => {
      scroller.dispatchEvent(new Event('scroll'))
      scroller.dispatchEvent(new Event('scroll'))
      scroller.dispatchEvent(new Event('scroll'))
    })

    expect(animationFrameCallbacks).toHaveLength(1)

    await flushAnimationFrames()

    expect(threadCommentCard('thread-1')?.getAttribute('style')).toContain('top: 80px')
    expect(commentAnchorLayer()?.style.transform).toBe('translate3d(0px, -50px, 0px)')

    rangeRects = [domRect({ left: 80, top: 190, width: 48, height: 20 })]
    vi.spyOn(markdownBody(), 'getBoundingClientRect').mockReturnValue(domRect({ left: 0, top: -50, width: 600, height: 400 }))
    triggerMarkdownResize()

    await flushAnimationFrames()

    expect(threadCommentCard('thread-1')?.getAttribute('style')).toContain('top: 200px')
    expect(commentAnchorLayer()?.style.transform).toBe('translate3d(0px, -50px, 0px)')
  })

  it('renders the focused thread overlay with a stronger active highlight', async () => {
    annotationsMock.threads = [
      thread({ id: 'thread-1', body: 'First comment' }),
      thread({ id: 'thread-2', body: 'Second comment', range: { start: 6, end: 8 }, quote: '内容' }),
    ]
    renderMarkdown()

    await act(async () => undefined)

    expect(threadOverlay('thread-1')?.className).not.toContain('ring-1')
    expect(threadOverlay('thread-2')?.className).not.toContain('ring-1')

    await click(elementWithText('First comment'))

    expect(threadOverlay('thread-1')?.className).toContain('ring-1')
    expect(threadOverlay('thread-1')?.className).toContain('bg-amber-200/70')
    expect(threadOverlay('thread-2')?.className).not.toContain('ring-1')
  })

  it('uses the precise overlay rect for focus scrolling across table and inline code ranges', async () => {
    rangeRects = [
      domRect({ left: 20, top: 40, width: 520, height: 96 }),
      domRect({ left: 48, top: 58, width: 120, height: 24 }),
    ]
    annotationsMock.threads = [
      thread({ range: { start: 0, end: 4 }, quote: '重点代码' }),
    ]
    renderMarkdown({
      previewData: preview({
        text: '重点代码',
        html: '<table><tbody><tr><td><strong>重点</strong><code>代码</code></td></tr></tbody></table>',
      }),
    })

    await act(async () => undefined)
    await click(elementWithText('Comment body'))

    expect(scrollIntoViewMock).not.toHaveBeenCalled()
    expect(scrollContainerScrollToMock).toHaveBeenCalledWith({ top: 20, behavior: 'smooth' })
  })

  it('filters narrow empty overlay rectangles from cross-structure selections', async () => {
    rangeRects = [
      domRect({ left: 20, top: 40, width: 1, height: 20 }),
      domRect({ left: 32, top: 40, width: 120, height: 20 }),
    ]
    renderMarkdown()
    selectStrongText()

    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(document.querySelectorAll('[data-drive-annotation-overlay-kind="pending"]')).toHaveLength(1)
  })

  it('drops broad container overlay rectangles when precise text rectangles overlap them', async () => {
    rangeRects = [
      domRect({ left: 20, top: 40, width: 520, height: 96 }),
      domRect({ left: 48, top: 58, width: 120, height: 24 }),
    ]
    renderMarkdown()
    selectStrongText()

    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    const overlays = document.querySelectorAll<HTMLElement>('[data-drive-annotation-overlay-kind="pending"]')
    expect(overlays).toHaveLength(1)
    expect(overlays[0]?.style.width).toBe('120px')
  })

  it('sorts attached comments by current rendered position', async () => {
    annotationsMock.threads = [
      thread({ id: 'thread-2', body: 'Later comment', range: { start: 6, end: 8 }, quote: '内容', createdAt: '2026-06-21T00:00:00.000Z' }),
      thread({ id: 'thread-1', body: 'Earlier comment', range: { start: 3, end: 5 }, quote: '重点', createdAt: '2026-06-21T00:01:00.000Z' }),
    ]
    renderMarkdown()

    await act(async () => undefined)

    const text = document.body.textContent ?? ''
    expect(text.indexOf('Earlier comment')).toBeLessThan(text.indexOf('Later comment'))
  })

  it('shows orphaned anchor status in the comment rail after resolving current markdown', async () => {
    annotationsMock.threads = [
      thread({ body: 'Lost comment', range: { start: 0, end: 2 }, quote: '缺失' }),
    ]
    renderMarkdown()

    await act(async () => undefined)

    expect(elementWithText('Lost comment').textContent).toContain('位置已变化')
  })
})

function renderMarkdown({
  currentItem = current(),
  previewData = preview(),
  annotationContext = { context: 'owner' as const, itemId: 'item-1' },
}: {
  readonly currentItem?: ReturnType<typeof current>
  readonly previewData?: ReturnType<typeof preview>
  readonly annotationContext?: ComponentProps<typeof DriveMarkdownRenderer>['annotationContext']
} = {}) {
  host = document.createElement('div')
  host.style.overflow = 'auto'
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 100 })
  Object.defineProperty(host, 'scrollTo', {
    configurable: true,
    value: vi.fn(function scrollTo(this: HTMLDivElement, options?: ScrollToOptions) {
      scrollContainerScrollToMock(options)
      if (typeof options?.top === 'number') this.scrollTop = options.top
    }),
  })
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <DriveRendererToolbarProvider>
        <ToolbarHost />
        <DriveMarkdownRenderer
          current={currentItem}
          preview={previewData}
          annotationContext={annotationContext}
        />
      </DriveRendererToolbarProvider>
    )
  })
}

function ToolbarHost() {
  const toolbar = useDriveRendererToolbar()
  return (
    <div data-testid='toolbar'>
      {toolbar.items.map((item) => <DrivePreviewToolbarItemView key={item.id} item={item} />)}
    </div>
  )
}

function current({ name = 'notes.md' }: { readonly name?: string } = {}) {
  return {
    id: 'item-1',
    name,
    type: 'file',
    size: '12',
    mimeType: 'text/markdown',
    updatedAt: '2026-06-21T00:00:00.000Z',
    previewKind: 'markdown',
    browserUrl: '/drive/items/item-1',
    downloadUrl: '/drive/items/item-1/download',
  }
}

function preview({
  outline = [],
  html = '<p>这是 <strong>重点</strong> 内容</p>',
  text = '这是 重点 内容',
}: {
  readonly outline?: ReturnType<typeof outlineItem>[]
  readonly html?: string
  readonly text?: string
} = {}) {
  return {
    kind: 'markdown' as const,
    text,
    html,
    outline,
    truncated: false,
    imageUrl: null,
    visitUrl: null,
  }
}

function outlineItem() {
  return {
    id: 'heading-1',
    text: '标题',
    depth: 1,
    children: [],
  }
}

function thread({
  id = 'thread-1',
  body = 'Comment body',
  range = { start: 3, end: 5 },
  quote = '重点',
  createdAt = '2026-06-21T00:00:00.000Z',
}: {
  readonly id?: string
  readonly body?: string
  readonly range?: { readonly start: number; readonly end: number }
  readonly quote?: string
  readonly createdAt?: string
} = {}) {
  return {
    id,
    itemId: 'item-1',
    baseVersionId: 'version-1',
    targetKind: 'textRange' as const,
    target: {
      schemaVersion: 1 as const,
      kind: 'textRange' as const,
      surface: 'markdownRenderedText' as const,
      range,
      quote: { exact: quote, prefix: '这是 ', suffix: ' 内容' },
    },
    anchorStatus: 'attached' as const,
    author: { id: 'user-1', email: 'user@example.com', displayName: null },
    comments: [{
      id: `comment-${id}`,
      threadId: id,
      parentCommentId: null,
      body,
      author: { id: 'user-1', email: 'user@example.com', displayName: null },
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      deleted: false,
      permissions: { canEdit: true, canDelete: true },
    }],
    createdAt,
    updatedAt: createdAt,
    permissions: { canDelete: true },
  }
}

function createAnnotationsMock() {
  return {
    threads: [] as ReturnType<typeof thread>[],
    loading: false,
    error: null as string | null,
    refresh: vi.fn(async () => undefined),
    createThread: vi.fn(async () => thread()),
    creatingThread: false,
    reply: vi.fn(async () => undefined),
    replying: false,
    updateComment: vi.fn(async () => undefined),
    updatingComment: false,
    deleteComment: vi.fn(async () => undefined),
    deletingComment: false,
    deleteThread: vi.fn(async () => undefined),
    deletingThread: false,
  }
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
}

function buttonWithText(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === text)
  if (!button) throw new Error(`Missing button ${text}`)
  return button as HTMLButtonElement
}

function buttonByLabel(label: string) {
  const button = document.querySelector(`button[aria-label="${label}"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${label}`)
  return button
}

function toolbarButtonTexts() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="toolbar"] button'))
    .map((button) => button.textContent?.trim() ?? '')
}

function selectionAction() {
  return document.querySelector('[data-drive-annotation-selection-action]')
}

function elementWithText(text: string) {
  const element = Array.from(document.querySelectorAll('section, article, p')).find((item) => item.textContent?.includes(text))
  if (!element) throw new Error(`Missing element ${text}`)
  return element as HTMLElement
}

function commentRailShell() {
  return Array.from(document.querySelectorAll('aside'))
    .find((item) => item.textContent?.includes('Comment body')) as HTMLElement | undefined
}

function commentRailPanelGroup() {
  return commentRailShell()?.closest('[data-slot="resizable-panel"]') as HTMLElement | null
}

function commentRailPanel() {
  return document.querySelector<HTMLElement>('[data-markdown-comments-rail="true"]') ?? undefined
}

function commentRailTitle() {
  return document.querySelector<HTMLElement>('[data-markdown-comments-rail="true"] > div') ?? undefined
}

function commentRailScrollRegion() {
  return document.querySelector<HTMLElement>('[data-markdown-comments-rail="true"] > div + div') ?? undefined
}

function textarea() {
  const element = document.querySelector('textarea')
  if (!element) throw new Error('Missing textarea')
  return element as HTMLTextAreaElement
}

function pendingMarker() {
  return document.querySelector('[data-drive-annotation-pending="true"]')
}

function pendingOverlay() {
  return document.querySelector('[data-drive-annotation-overlay-kind="pending"]')
}

function threadOverlay(threadId: string) {
  return document.querySelector(`[data-drive-annotation-overlay-thread-id="${threadId}"]`)
}

function threadCommentCard(threadId: string) {
  return document.querySelector<HTMLElement>(`[data-markdown-comment-thread-id="${threadId}"]`)
}

function commentAnchorLayer() {
  return document.querySelector<HTMLElement>('[data-markdown-comments-anchored-layer="true"]')
}

function markdownDocumentScroller() {
  const element = document.querySelector<HTMLElement>('[data-testid="markdown-document-scroll"]')
  if (!element) throw new Error('Missing markdown document scroller')
  return element
}

function markdownBody() {
  const element = document.querySelector<HTMLElement>('[data-testid="markdown-body"]')
  if (!element) throw new Error('Missing markdown body')
  return element
}

function triggerMarkdownResize() {
  const observer = markdownResizeObserver()
  if (!observer) throw new Error('Missing ResizeObserver')
  observer.callback([], observer as unknown as ResizeObserver)
}

function markdownResizeObserver() {
  const body = document.querySelector('[data-testid="markdown-body"]')
  return resizeObservers.find((observer) => body ? observer.observedElements.includes(body) : false) ?? null
}

async function flushAnimationFrames() {
  await act(async () => {
    while (animationFrameCallbacks.length > 0) {
      const callbacks = animationFrameCallbacks
      animationFrameCallbacks = []
      callbacks.forEach((item) => item.callback(performance.now()))
    }
  })
}

function domRect({
  left = 80,
  top = 120,
  width = 48,
  height = 20,
}: {
  readonly left?: number
  readonly top?: number
  readonly width?: number
  readonly height?: number
} = {}): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    top,
    right: left + width,
    bottom: top + height,
    left,
    toJSON: () => ({}),
  } as DOMRect
}

function selectStrongText() {
  const strongText = document.querySelector('strong')?.firstChild
  if (!strongText) throw new Error('missing strong text')
  const range = document.createRange()
  range.setStart(strongText, 0)
  range.setEnd(strongText, 2)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

type TestResizeObserver = {
  readonly callback: ResizeObserverCallback
  readonly observe: ReturnType<typeof vi.fn>
  readonly disconnect: ReturnType<typeof vi.fn>
  readonly observedElements: Element[]
}

async function inputValue(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
