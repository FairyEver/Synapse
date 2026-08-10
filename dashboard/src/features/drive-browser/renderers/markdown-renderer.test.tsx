// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveDocumentImageImportResult, DriveDocumentImageSource, DriveDocumentImageSourcesDto, DriveMarkdownOutlineItemDto } from '@synapse/shared'
import { DriveMarkdownRenderer } from './markdown-renderer'
import { useAuthStore } from '@/stores/auth-store'
import { FilePreviewLayout } from '@/features/file-browser/preview/file-preview-layout'
import { driveBrowserApi } from '@/lib/api'
import { DrivePreviewToolbarItemView } from './drive-preview-header'
import { DriveRendererToolbarProvider, useDriveRendererToolbar } from './drive-renderer-toolbar-context'
import type { DriveRendererEditContext } from './drive-renderer-shell'

vi.mock('../use-drive-annotations', () => ({
  useDriveAnnotations: () => annotationsMock,
}));

vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    default: ({
      value,
      onChange,
      options,
    }: {
      readonly value?: string
      readonly onChange?: (value?: string) => void
      readonly options?: { readonly readOnly?: boolean }
    }) => React.createElement('textarea', {
      'data-monaco-editor': 'true',
      readOnly: options?.readOnly,
      value: value ?? '',
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(event.currentTarget.value)
      },
    }),
  }
});

vi.mock('y-monaco', () => ({
  MonacoBinding: class {
    destroy(): void {}
  },
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
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
    return this.hasAttribute('data-markdown-comments-header') ? 40 : 0
  })
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
  it('switches from the empty code fallback to rendered markdown without changing hook order', () => {
    const { rerender } = renderMarkdown({ previewData: preview({ html: '', text: '' }) })

    expect(document.querySelector('[data-monaco-editor="true"]')).not.toBeNull()
    expect(() => rerender({ previewData: preview() })).not.toThrow()
    expect(document.querySelector('[data-testid="markdown-body"]')).not.toBeNull()
    expect(() => rerender({ previewData: preview({ html: '', text: '' }) })).not.toThrow()
    expect(document.querySelector('[data-monaco-editor="true"]')).not.toBeNull()
  })

  it('aligns the outline rail with the markdown content top padding', () => {
    renderMarkdown({ previewData: preview({ outline: [outlineItem()] }) })

    const outlineNav = document.querySelector('nav[aria-label="目录"]')
    expect(outlineNav?.closest('aside')?.className).toContain('py-6')
    expect(outlineNav?.className).toContain('overflow-y-auto')
    expect(outlineNav?.className).toContain('px-4')
    expect(outlineNav?.className).toContain('md:px-6')
  })

  it('keeps the rails fixed while only the markdown document scrolls', () => {
    renderMarkdown({ previewData: preview({ outline: [outlineItem()] }) })

    const layout = document.querySelector('[data-testid="markdown-layout"]')
    const outlineRail = document.querySelector('nav[aria-label="目录"]')?.closest('[data-slot="resizable-panel"]')
    const outlineRailContent = outlineRail?.firstElementChild
    const outlineAside = document.querySelector('nav[aria-label="目录"]')?.closest('aside')
    const documentColumn = document.querySelector('[data-testid="markdown-body"]')?.parentElement
    const documentScroller = document.querySelector('[data-testid="markdown-document-scroll"]')

    expect(layout?.className).toContain('h-full')
    expect(layout?.className).toContain('overflow-hidden')
    expect(layout?.className).not.toContain('overflow-auto')
    expect(layout?.className).toContain('w-full')
    expect(layout?.className).not.toContain('min-h-full')
    expect(layout?.className).not.toContain('px-4')
    expect(layout?.className).not.toContain('py-6')
    expect(layout?.className).not.toContain('md:px-6')
    expect(layout?.className).not.toContain('mx-auto')
    expect(layout?.className).not.toContain('max-w-7xl')
    expect(layout?.className).not.toContain('gap-6')
    const panelGroup = document.querySelector('[data-slot="resizable-panel-group"]')
    expect(panelGroup).not.toBeNull()
    expect(panelGroup?.className).toContain('h-full')
    expect(panelGroup?.className).toContain('min-h-0')
    expect(panelGroup?.className).toContain('overflow-hidden')
    expect(outlineRail?.getAttribute('data-slot')).toBe('resizable-panel')
    expect(outlineRailContent?.className).toContain('h-full')
    expect(outlineRailContent?.className).toContain('min-h-0')
    expect(outlineRail?.getAttribute('data-panel-size')).toBe('16%')
    expect(outlineRail?.getAttribute('data-panel-min-size')).toBe('12%')
    expect(outlineRail?.getAttribute('data-panel-max-size')).toBe('22%')
    expect(outlineAside?.className).not.toContain('px-4')
    expect(outlineAside?.className).not.toContain('md:px-6')
    expect(outlineAside?.className).toContain('py-6')
    expect(outlineAside?.className).toContain('overflow-hidden')
    expect(outlineAside?.className).toContain('h-full')
    expect(outlineAside?.className).toContain('min-h-0')
    expect(outlineAside?.className.split(/\s+/u)).not.toContain('hidden')
    expect(outlineAside?.className).not.toContain('xl:block')
    expect(documentScroller?.className).toContain('h-full')
    expect(documentScroller?.className).toContain('min-h-0')
    expect(documentScroller?.className).toContain('overflow-y-auto')
    expect(documentScroller?.className).toContain('overscroll-contain')
    expect(documentScroller?.firstElementChild?.className).toContain('px-4')
    expect(documentScroller?.firstElementChild?.className).toContain('py-6')
    expect(documentColumn?.className).toContain('mx-auto')
    expect(documentColumn?.className).not.toContain('ml-auto')
    expect(documentColumn?.className).toContain('max-w-3xl')
    expect(documentColumn?.getAttribute('data-markdown-width-mode')).toBe('reading')
  })

  it('activates the current outline item and reveals it inside the independent outline scroller', async () => {
    renderMarkdown({
      previewData: preview({
        html: '<h1 id="heading-1">First</h1><h2 id="heading-2">Second</h2>',
        text: 'FirstSecond',
        outline: [
          { id: 'heading-1', text: 'First', depth: 1, children: [] },
          { id: 'heading-2', text: 'Second', depth: 2, children: [] },
        ],
      }),
    })

    const scroller = markdownDocumentScroller()
    const outlineScroller = document.querySelector<HTMLElement>('nav[aria-label="目录"]')
    const firstHeading = document.getElementById('heading-1')
    const secondHeading = document.getElementById('heading-2')
    const secondLink = document.querySelector<HTMLElement>('[data-markdown-outline-id="heading-2"]')
    if (!outlineScroller || !firstHeading || !secondHeading || !secondLink) throw new Error('Missing outline fixtures')
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 })
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(domRect({ top: 0, height: 100 }))
    vi.spyOn(firstHeading, 'getBoundingClientRect').mockReturnValue(domRect({ top: -20, height: 20 }))
    vi.spyOn(secondHeading, 'getBoundingClientRect').mockReturnValue(domRect({ top: 10, height: 20 }))
    vi.spyOn(outlineScroller, 'getBoundingClientRect').mockReturnValue(domRect({ top: 0, height: 100 }))
    vi.spyOn(secondLink, 'getBoundingClientRect').mockReturnValue(domRect({ top: 120, height: 20 }))
    scrollIntoViewMock.mockClear()

    scroller.dispatchEvent(new Event('scroll'))
    await flushAnimationFrames()

    expect(secondLink.getAttribute('aria-current')).toBe('location')
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('scrolls the markdown document instead of the page when an outline item is selected', async () => {
    renderMarkdown({
      previewData: preview({
        html: '<h1 id="heading-1">First</h1>',
        text: 'First',
        outline: [outlineItem()],
      }),
    })
    const scroller = markdownDocumentScroller()
    const heading = document.getElementById('heading-1')
    const link = document.querySelector<HTMLElement>('[data-markdown-outline-id="heading-1"]')
    if (!heading || !link) throw new Error('Missing outline fixtures')
    scroller.scrollTop = 50
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(domRect({ top: 0, height: 100 }))
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue(domRect({ top: 200, height: 20 }))
    scrollContainerScrollToMock.mockClear()

    await click(link)

    expect(scrollContainerScrollToMock).toHaveBeenCalledWith({ top: 226, behavior: 'smooth' })
    expect(host?.scrollTop).toBe(0)
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

  it('enables comments for markdown extensions and markdown mime types', () => {
    const cases = [
      current({ name: 'notes.md', mimeType: null }),
      current({ name: 'notes.markdown', mimeType: null }),
      current({ name: 'component.mdx', mimeType: null }),
      current({ name: 'upload.bin', mimeType: 'text/markdown' }),
    ]

    for (const currentItem of cases) {
      renderMarkdown({ currentItem })
      expect(buttonWithText('评论 0')).not.toBeNull()
      root?.unmount()
      host?.remove()
      root = null
      host = null
      document.body.innerHTML = ''
    }
  })

  it('does not enable comments for non-markdown files', () => {
    renderMarkdown({ currentItem: current({ name: 'notes.txt', mimeType: 'text/plain' }) })

    expect(queryButtonWithText('评论 0')).toBeNull()
  })

  it('keeps empty markdown code fallback editable', () => {
    renderMarkdown({
      previewData: preview({ html: '   ', text: '' }),
      editContext: {
        reload: vi.fn(async () => ({} as never)),
        reloading: false,
        saveText: vi.fn(async () => undefined),
        savingText: false,
      },
    })

    const editor = document.querySelector('[data-monaco-editor="true"]')
    expect(editor).toBeInstanceOf(HTMLTextAreaElement)
    expect((editor as HTMLTextAreaElement).readOnly).toBe(false)
    expect(buttonWithText('重新加载')).not.toBeNull()
    expect(buttonWithText('保存')).not.toBeNull()
  })

  it('wraps long inline markdown content inside the reader column', () => {
    const path = 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/sys/impl/PushMessageApiImpl.java'
    renderMarkdown({
      previewData: preview({
        text: path,
        html: `<p>文件路径：<code>${path}</code></p>`,
      }),
    })

    const body = document.querySelector<HTMLElement>('[data-testid="markdown-body"]')
    expect(body?.className.split(/\s+/u)).toContain('break-words')
    expect(body?.querySelector('code')?.textContent).toBe(path)
    expect(body?.className).toContain('[&_pre]:overflow-x-auto')
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
    expect(commentRailPanel()?.className).toContain('min-h-0')
    expect(commentRailPanel()?.className).toContain('h-full')
    expect(commentRailPanel()?.className).not.toContain('max-h-screen')
    expect(commentRailTitle()?.className).toContain('shrink-0')
    expect(commentRailScrollRegion()?.className).toContain('overflow-hidden')
    expect(windowAddEventListener).not.toHaveBeenCalledWith('resize', expect.any(Function))
    expect(document.querySelector('[data-testid="markdown-body"]')?.parentElement?.className).toContain('mx-auto')
    expect(document.querySelector('[data-testid="markdown-body"]')?.parentElement?.className).not.toContain('ml-auto')

    windowAddEventListener.mockRestore()
  })

  it('uses mutually exclusive outline and comment sheets in compact preview layouts', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown({ previewData: preview({ outline: [outlineItem()] }) })

    await act(async () => undefined)
    await setPreviewWidth(390)

    expect(document.querySelector('[data-slot="resizable-panel-group"]')).toBeNull()
    expect(document.querySelector('[data-markdown-sheet]')).toBeNull()

    await click(buttonWithText('目录'))
    expect(document.querySelector('[data-markdown-sheet="outline"]')).not.toBeNull()
    expect(document.querySelector('[data-markdown-sheet="comments"]')).toBeNull()

    await click(buttonWithText('评论 1'))
    expect(document.querySelector('[data-markdown-sheet="outline"]')).toBeNull()
    expect(document.querySelector('[data-markdown-sheet="comments"]')).not.toBeNull()
    expect(document.querySelector('[data-markdown-comments-mode="list"]')).not.toBeNull()
    expect(commentAnchorLayer()).toBeNull()
  })

  it('switches the shared markdown layout at the preview container width boundary', async () => {
    renderMarkdown({ previewData: preview({ outline: [outlineItem()] }) })

    await setPreviewWidth(1023)
    expect(document.querySelector('[data-slot="resizable-panel-group"]')).toBeNull()

    await setPreviewWidth(1024)
    expect(document.querySelector('[data-slot="resizable-panel-group"]')).not.toBeNull()
  })

  it('closes compact sheets after selecting outline and comment targets', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown({ previewData: preview({ outline: [outlineItem()] }) })

    await act(async () => undefined)
    await setPreviewWidth(390)

    await click(buttonWithText('目录'))
    const outlineLink = document.querySelector<HTMLAnchorElement>('a[href="#heading-1"]')
    if (!outlineLink) throw new Error('Missing compact outline link')
    await click(outlineLink)
    expect(document.querySelector('[data-markdown-sheet="outline"]')).toBeNull()

    await click(buttonWithText('评论 1'))
    await click(elementWithText('Comment body'))
    expect(document.querySelector('[data-markdown-sheet="comments"]')).toBeNull()
    expect(scrollContainerScrollToMock).toHaveBeenCalled()
  })

  it('keeps compact comments open when an unlocated thread is selected', async () => {
    annotationsMock.threads = [thread({ body: 'Lost comment', range: { start: 0, end: 2 }, quote: '缺失' })]
    renderMarkdown()

    await act(async () => undefined)
    await setPreviewWidth(390)
    await click(buttonWithText('评论 1'))
    await click(elementWithText('Lost comment'))

    expect(document.querySelector('[data-markdown-sheet="comments"]')).not.toBeNull()
    expect(scrollContainerScrollToMock).not.toHaveBeenCalled()
  })

  it('preserves regular outline preferences across compact mode changes', async () => {
    renderMarkdown({ previewData: preview({ outline: [outlineItem()] }) })

    await click(buttonWithText('目录'))
    expect(document.querySelector('[data-markdown-resizable-panel="outline"]')).toBeNull()

    await setPreviewWidth(834)
    await click(buttonWithText('目录'))
    expect(document.querySelector('[data-markdown-sheet="outline"]')).not.toBeNull()

    await setPreviewWidth(1280)
    expect(document.querySelector('[data-markdown-sheet="outline"]')).toBeNull()
    expect(document.querySelector('[data-markdown-resizable-panel="outline"]')).toBeNull()
  })

  it('keeps compact comment interactions separate from regular panel preferences', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown()

    await act(async () => undefined)
    await click(buttonWithText('评论 1'))
    expect(document.querySelector('[data-markdown-resizable-panel="comments"]')).toBeNull()

    await setPreviewWidth(390)
    await click(buttonWithText('评论 1'))
    expect(document.querySelector('[data-markdown-sheet="comments"]')).not.toBeNull()
    await click(buttonWithText('评论 1'))
    expect(document.querySelector('[data-markdown-sheet="comments"]')).toBeNull()

    await setPreviewWidth(1280)
    expect(document.querySelector('[data-markdown-resizable-panel="comments"]')).toBeNull()
  })

  it('counts replies in the toolbar comments total', async () => {
    const baseThread = thread()
    annotationsMock.threads = [{
      ...baseThread,
      comments: [
        ...baseThread.comments,
        {
          ...baseThread.comments[0],
          id: 'comment-reply-1',
          parentCommentId: baseThread.comments[0].id,
          body: 'Reply body',
        },
      ],
    }]

    renderMarkdown()

    await act(async () => undefined)

    expect(toolbarButtonTexts()).toEqual(['宽屏', '评论 2'])
    expect(document.body.textContent).toContain('Reply body')
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
      dispatchPointerUpOnMarkdownBody()
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
      baseVersionId: 'version-1',
      targetKind: 'textRange',
      body: 'New comment',
      target: expect.objectContaining({
        range: { start: 3, end: 5 },
        quote: expect.objectContaining({ exact: '重点' }),
      }),
    }))
    expect(pendingOverlay()).toBeNull()
  })

  it('waits for pointer completion before creating a selection anchor', async () => {
    renderMarkdown()
    selectStrongText()

    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    await flushAnimationFrames()

    expect(queryButtonWithText('添加评论')).toBeNull()
    expect(pendingOverlay()).toBeNull()

    await act(async () => {
      dispatchPointerUpOnMarkdownBody()
    })

    expect(buttonWithText('添加评论')).not.toBeNull()
    expect(pendingOverlay()).not.toBeNull()
  })

  it('preserves the native text selection while syncing the comment action', async () => {
    renderMarkdown()
    selectStrongText()

    await act(async () => {
      dispatchPointerUpOnMarkdownBody()
    })

    expect(window.getSelection()?.toString()).toBe('重点')
    expect(buttonWithText('添加评论')).not.toBeNull()
    expect(pendingOverlay()).not.toBeNull()
  })

  it('creates one selection anchor for the pointer release event sequence', async () => {
    renderMarkdown()
    selectStrongText()
    const cloneContents = vi.spyOn(Range.prototype, 'cloneContents')

    await act(async () => {
      dispatchPointerUpOnMarkdownBody()
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(cloneContents).toHaveBeenCalledTimes(2)
    expect(buttonWithText('添加评论')).not.toBeNull()
  })

  it('updates only the selection action position while the document scrolls', async () => {
    renderMarkdown()
    selectStrongText()
    await act(async () => {
      dispatchPointerUpOnMarkdownBody()
    })
    const cloneContents = vi.spyOn(Range.prototype, 'cloneContents')
    rangeRects = [domRect({ left: 160, top: 240, width: 80, height: 20 })]

    markdownDocumentScroller().dispatchEvent(new Event('scroll'))
    await flushAnimationFrames()

    expect(cloneContents).not.toHaveBeenCalled()
    expect(selectionAction()?.style.top).toBe('200px')
    expect(selectionAction()?.style.left).toBe('200px')
  })

  it('shows an error when creating a comment fails', async () => {
    annotationsMock.createThread.mockRejectedValueOnce(new Error('文件已有新内容。'))
    renderMarkdown()
    selectStrongText()
    await act(async () => {
      dispatchPointerUpOnMarkdownBody()
    })

    await click(buttonWithText('添加评论'))
    await inputValue(textarea(), 'New comment')
    await click(buttonWithText('评论'))

    expect(document.body.textContent).toContain('文件已有新内容。')
    expect(pendingOverlay()).not.toBeNull()
    expect(textarea()).not.toBeNull()
  })

  it('clears pending comment state when the current markdown file changes', async () => {
    const { rerender } = renderMarkdown()
    selectStrongText()
    await act(async () => {
      dispatchPointerUpOnMarkdownBody()
    })
    await click(buttonWithText('添加评论'))
    await inputValue(textarea(), 'Old file comment')

    rerender({
      currentItem: current({ id: 'item-2', name: 'other.md' }),
      annotationContext: { context: 'owner', itemId: 'item-2' },
      edit: editable({ currentVersionId: 'version-2' }),
    })
    await act(async () => undefined)

    expect(document.querySelector('textarea')).toBeNull()
    expect(document.body.textContent).not.toContain('添加评论')
    expect(pendingOverlay()).toBeNull()
    expect(annotationsMock.createThread).not.toHaveBeenCalled()
  })

  it('clears the pending marker when the add comment dialog is cancelled', async () => {
    renderMarkdown()
    selectStrongText()

    await act(async () => {
      dispatchPointerUpOnMarkdownBody()
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
      dispatchPointerUpOnMarkdownBody()
    })

    expect(document.querySelector('textarea')).toBeNull()
    expect(document.body.textContent).not.toContain('添加评论')
    expect(pendingOverlay()).toBeNull()
  })

  it('opens the composer for logged-in share viewers even when editing is unavailable', async () => {
    useAuthStore.getState().auth.setUser({
      email: 'reader@example.com',
      handle: null,
      sessionId: 'session-1',
    })
    renderMarkdown({
      edit: { ...editable(), canEdit: false, reason: 'permission_denied' },
      annotationContext: { context: 'share', shareId: 'share-1', canComment: true },
    })
    selectStrongText()

    await act(async () => {
      dispatchPointerUpOnMarkdownBody()
    })

    expect(buttonWithText('添加评论')).not.toBeNull()
    expect(pendingOverlay()).not.toBeNull()
  })

  it('hides reply actions for logged-out share viewers', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown({ annotationContext: { context: 'share', shareId: 'share-1' } })

    await act(async () => undefined)

    expect(document.body.textContent).toContain('Comment body')
    expect(document.body.textContent).not.toContain('回复')
  })

  it('does not show comment controls for non-markdown previews', async () => {
    renderMarkdown({ currentItem: current({ name: 'notes.txt', mimeType: 'text/plain' }) })
    selectStrongText()

    await act(async () => {
      dispatchPointerUpOnMarkdownBody()
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
    expect(markdownDocumentScroller().scrollTop).toBe(80)
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

  it('does not walk the rendered text once per comment overlay', async () => {
    annotationsMock.threads = [
      thread({ id: 'thread-1', range: { start: 3, end: 5 }, quote: '重点' }),
      thread({ id: 'thread-2', range: { start: 6, end: 8 }, quote: '内容' }),
      thread({ id: 'thread-3', range: { start: 0, end: 2 }, quote: '这是' }),
    ]
    const threadCount = annotationsMock.threads.length
    const createTreeWalker = vi.spyOn(document, 'createTreeWalker')
    renderMarkdown()

    await act(async () => undefined)
    createTreeWalker.mockClear()
    triggerMarkdownResize()

    await flushAnimationFrames()

    expect(createTreeWalker.mock.calls.length).toBeLessThan(threadCount)
  })

  it('translates anchored comments with the document scroller while keeping the rails fixed', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown()

    await act(async () => undefined)

    const layout = document.querySelector<HTMLElement>('[data-testid="markdown-layout"]')
    const documentContent = markdownDocumentScroller()
    const commentShell = commentRailShell()
    const anchorLayer = commentAnchorLayer()

    expect(layout?.className).toContain('overflow-hidden')
    expect(documentContent.className).toContain('overflow-y-auto')
    expect(commentShell?.className).toContain('overflow-hidden')
    expect(anchorLayer?.parentElement?.className).toContain('overflow-hidden')
    expect(anchorLayer?.className).toContain('will-change-transform')
    expect(threadCommentCard('thread-1')?.getAttribute('style')).toContain('top: 80px')
    expect(anchorLayer?.style.transform).toBe('translate3d(0, 0px, 0)')

    documentContent.scrollTop = 50
    await act(async () => {
      documentContent.dispatchEvent(new Event('scroll'))
    })

    expect(animationFrameCallbacks).toHaveLength(1)
    await flushAnimationFrames()
    expect(threadCommentCard('thread-1')?.getAttribute('style')).toContain('top: 80px')
    expect(anchorLayer?.style.transform).toBe('translate3d(0, -50px, 0)')
  })

  it('forwards anchored comment wheel input to the markdown document scroller', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown()
    await act(async () => undefined)
    const scroller = markdownDocumentScroller()
    const commentRegion = document.querySelector<HTMLElement>('[data-markdown-comments-scroll-region="true"]')
    if (!commentRegion) throw new Error('Missing anchored comment region')
    scroller.scrollTop = 10
    animationFrameCallbacks = []
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 30 })
    Object.defineProperty(wheel, 'deltaY', { configurable: true, value: 30 })

    await act(async () => {
      commentRegion.dispatchEvent(wheel)
    })

    expect(wheel.defaultPrevented).toBe(true)
    expect(scroller.scrollTop).toBe(40)
    expect(animationFrameCallbacks).toHaveLength(1)
    await flushAnimationFrames()
    expect(commentAnchorLayer()?.style.transform).toBe('translate3d(0, -40px, 0)')
  })

  it('adds document bottom compensation when stacked comments extend beyond the markdown content', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown()

    await act(async () => undefined)

    const compensation = document.querySelector<HTMLElement>('[data-markdown-comment-bottom-compensation="true"]')
    expect(Number.parseFloat(compensation?.style.height ?? '0')).toBeGreaterThan(0)
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
      dispatchPointerUpOnMarkdownBody()
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
      dispatchPointerUpOnMarkdownBody()
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

    expect(elementWithText('Lost comment').textContent).toContain('原文已修改或删除')
    expect(elementWithText('Lost comment').textContent).toContain('“缺失”')
  })

  it('registers image source action and imports owner markdown images', async () => {
    const reload = vi.fn(async () => ({} as never))
    const scanImages = vi.spyOn(driveBrowserApi, 'scanOwnerImageSources').mockResolvedValue(imageSources({
      canImport: true,
      sources: [
        imageSource({
          src: 'https://example.test/external.png',
          canImport: true,
          kind: 'external',
        }),
      ],
    }))
    vi.spyOn(driveBrowserApi, 'importOwnerImageSources').mockResolvedValue(imageImportResult())

    renderMarkdown({ editContext: { reload, reloading: false, saveText: vi.fn(), savingText: false } })

    expect(scanImages).not.toHaveBeenCalled()

    await click(buttonWithText('图片来源'))

    expect(scanImages).toHaveBeenCalledWith('item-1')
    await click(buttonWithText('转存全部'))

    expect(driveBrowserApi.importOwnerImageSources).toHaveBeenCalledWith('item-1', {
      baseVersionId: 'version-1',
      sources: [{ src: 'https://example.test/external.png' }],
    })
    expect(reload).toHaveBeenCalled()
  })

  it('keeps image source dialog open when image import partially fails', async () => {
    const reload = vi.fn(async () => ({} as never))
    const scanImages = vi.spyOn(driveBrowserApi, 'scanOwnerImageSources').mockResolvedValue(imageSources({
      canImport: true,
      sources: [
        imageSource({
          id: 'source-ok',
          src: 'https://example.test/ok.png',
          canImport: true,
          kind: 'external',
        }),
        imageSource({
          id: 'source-failed',
          src: 'https://example.test/missing.png',
          canImport: true,
          kind: 'external',
        }),
      ],
    }))
    vi.spyOn(driveBrowserApi, 'importOwnerImageSources').mockResolvedValue(imageImportResult({
      imported: [{
        previousSrc: 'https://example.test/ok.png',
        nextSrc: 'https://synapse.test/files/asset',
        assetId: 'asset-1',
        size: '10',
      }],
      failed: [{
        src: 'https://example.test/missing.png',
        reason: 'unreachable',
        message: '图片无法访问。',
      }],
      summary: {
        importedCount: 1,
        failedCount: 1,
        replacedOccurrenceCount: 1,
      },
    }))

    renderMarkdown({ editContext: { reload, reloading: false, saveText: vi.fn(), savingText: false } })

    expect(scanImages).not.toHaveBeenCalled()

    await click(buttonWithText('图片来源'))
    expect(scanImages).toHaveBeenCalledWith('item-1')
    await click(buttonWithText('转存全部'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(reload).toHaveBeenCalled()
    expect(document.body.textContent).toContain('部分图片转存失败：1')
    expect(document.body.textContent).toContain('https://example.test/missing.png')
    expect(document.body.textContent).toContain('图片无法访问。')
    expect(buttonWithText('转存全部')).not.toBeNull()
  })

  it('rescans image sources after the markdown version changes', async () => {
    const editContext = { reload: vi.fn(async () => ({} as never)), reloading: false, saveText: vi.fn(), savingText: false }
    const scanImages = vi.spyOn(driveBrowserApi, 'scanOwnerImageSources')
      .mockResolvedValueOnce(imageSources({
        canImport: true,
        sources: [imageSource({ id: 'source-v1', src: 'https://example.test/v1.png', kind: 'external' })],
      }))
      .mockResolvedValueOnce(imageSources({
        canImport: true,
        sources: [imageSource({ id: 'source-v2', src: 'https://example.test/v2.png', kind: 'external' })],
      }))
    const { rerender } = renderMarkdown({ edit: editable({ currentVersionId: 'version-1' }), editContext })

    await click(imageSourceToolbarButton())
    expect(scanImages).toHaveBeenCalledTimes(1)
    await click(dialogCloseButton())

    rerender({ edit: editable({ currentVersionId: 'version-2' }) })
    await click(imageSourceToolbarButton())

    expect(scanImages).toHaveBeenCalledTimes(2)
  })
})

function renderMarkdown({
  currentItem = current(),
  previewData = preview(),
  edit = editable(),
  annotationContext = { context: 'owner' as const, itemId: 'item-1' },
  editContext,
}: {
  readonly currentItem?: ReturnType<typeof current>
  readonly previewData?: ReturnType<typeof preview>
  readonly edit?: ComponentProps<typeof DriveMarkdownRenderer>['edit']
  readonly annotationContext?: ComponentProps<typeof DriveMarkdownRenderer>['annotationContext']
  readonly editContext?: DriveRendererEditContext
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
  const initialInput = { currentItem, previewData, edit, annotationContext, editContext }
  const render = (input: typeof initialInput) => {
    root?.render(
      <DriveRendererToolbarProvider>
        <ToolbarHost />
        <FilePreviewLayout>
          <DriveMarkdownRenderer
            current={input.currentItem}
            preview={input.previewData}
            edit={input.edit}
            annotationContext={input.annotationContext}
            editContext={input.editContext}
          />
        </FilePreviewLayout>
      </DriveRendererToolbarProvider>
    )
  }
  act(() => {
    render(initialInput)
  })
  configureMarkdownDocumentScroller()
  return {
    rerender: (overrides: Partial<typeof initialInput>) => {
      act(() => {
        render({ ...initialInput, ...overrides })
      })
      configureMarkdownDocumentScroller()
    },
  }
}

function configureMarkdownDocumentScroller() {
  const scroller = document.querySelector<HTMLElement>('[data-testid="markdown-document-scroll"]')
  if (!scroller) return
  scroller.style.overflow = 'auto'
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 })
  Object.defineProperty(scroller, 'scrollTo', {
    configurable: true,
    value: vi.fn(function scrollTo(this: HTMLElement, options?: ScrollToOptions) {
      scrollContainerScrollToMock(options)
      if (typeof options?.top === 'number') this.scrollTop = options.top
    }),
  })
}

function dispatchPointerUpOnMarkdownBody() {
  document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new Event('pointerup', { bubbles: true }))
}

function ToolbarHost() {
  const toolbar = useDriveRendererToolbar()
  return (
    <div data-testid='toolbar'>
      {toolbar.items.map((item) => <DrivePreviewToolbarItemView key={item.id} item={item} />)}
    </div>
  )
}

function editable(overrides: Partial<DriveBrowserEditDto> = {}) {
  return {
    canEdit: true,
    editorKind: 'text' as const,
    currentVersionId: 'version-1',
    maxInlineEditBytes: '1024',
    reason: null,
    ...overrides,
  }
}

function current({ name = 'notes.md', mimeType = 'text/markdown' }: { readonly name?: string; readonly mimeType?: string | null } = {}) {
  return {
    id: 'item-1',
    name,
    type: 'file',
    size: '12',
    mimeType,
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
  readonly outline?: DriveMarkdownOutlineItemDto[]
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
    relativeImages: [],
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
    author: { id: 'user-1', email: 'user@example.com', handle: null },
    comments: [{
      id: `comment-${id}`,
      threadId: id,
      parentCommentId: null,
      body,
      author: { id: 'user-1', email: 'user@example.com', handle: null },
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
  }
}

function imageSources(overrides: Partial<DriveDocumentImageSourcesDto> = {}): DriveDocumentImageSourcesDto {
  const sources = overrides.sources ?? []
  return {
    itemId: 'item-1',
    versionId: 'version-1',
    canImport: false,
    sources,
    summary: {
      total: sources.length,
      ownerAsset: sources.filter((source) => source.kind === 'owner_asset').length,
      collaboratorAsset: sources.filter((source) => source.kind === 'collaborator_asset').length,
      external: sources.filter((source) => source.kind === 'external').length,
      invalid: sources.filter((source) => source.kind === 'invalid').length,
      unsupported: sources.filter((source) => source.kind === 'unsupported').length,
      importable: sources.filter((source) => source.canImport).length,
    },
    ...overrides,
  }
}

function imageSource(overrides: Partial<DriveDocumentImageSource> = {}): DriveDocumentImageSource {
  return {
    id: 'source-1',
    imageKey: 'source-1',
    src: 'https://example.test/image.png',
    kind: 'external',
    occurrenceCount: 1,
    canImport: true,
    status: 'ready',
    ...overrides,
  }
}

function imageImportResult(overrides: Partial<DriveDocumentImageImportResult> = {}): DriveDocumentImageImportResult {
  const result: DriveDocumentImageImportResult = {
    itemId: 'item-1',
    versionId: 'version-2',
    imported: [{
      previousSrc: 'https://example.test/external.png',
      nextSrc: 'https://synapse.test/files/asset',
      assetId: 'asset-1',
      size: '10',
    }],
    failed: [],
    summary: {
      importedCount: 1,
      failedCount: 0,
      replacedOccurrenceCount: 1,
    },
  }
  return {
    ...result,
    ...overrides,
    summary: {
      ...result.summary,
      ...overrides.summary,
    },
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

function queryButtonWithText(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === text)
  return button instanceof HTMLButtonElement ? button : null
}

function buttonByLabel(label: string) {
  const button = document.querySelector(`button[aria-label="${label}"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${label}`)
  return button
}

function dialogCloseButton() {
  const button = document.querySelector('[data-slot="dialog-close"]')
  if (!(button instanceof HTMLButtonElement)) throw new Error('Missing dialog close button')
  return button
}

function imageSourceToolbarButton() {
  const button = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="toolbar"] button'))
    .find((item) => item.textContent?.trim().startsWith('图片来源'))
  if (!(button instanceof HTMLButtonElement)) throw new Error('Missing image source toolbar button')
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
  const element = ['p', 'article', 'section']
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .find((item) => item.textContent?.includes(text))
  if (!element) throw new Error(`Missing element ${text}`)
  const commentThread = element.closest('[data-markdown-comment-thread-id]')?.querySelector('section')
  return (commentThread ?? element) as HTMLElement
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
  return document.querySelector<HTMLElement>('[data-markdown-comments-scroll-region="true"]') ?? undefined
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

async function setPreviewWidth(width: number) {
  const observer = previewLayoutResizeObserver()
  if (!observer) throw new Error('Missing preview layout ResizeObserver')
  await act(async () => {
    observer.callback([
      {
        contentRect: domRect({ left: 0, top: 0, width, height: 844 }),
      } as ResizeObserverEntry,
    ], observer as unknown as ResizeObserver)
  })
}

function markdownResizeObserver() {
  const body = document.querySelector('[data-testid="markdown-body"]')
  return resizeObservers.find((observer) => body ? observer.observedElements.includes(body) : false) ?? null
}

function previewLayoutResizeObserver() {
  const layout = document.querySelector('[data-file-preview-layout]')
  return resizeObservers.find((observer) => layout ? observer.observedElements.includes(layout) : false) ?? null
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
