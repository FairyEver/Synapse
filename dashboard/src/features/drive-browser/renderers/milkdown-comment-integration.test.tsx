// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  DriveAnnotationThreadDto,
  DriveBrowserEditDto,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
} from '@synapse/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { driveAnnotationApi } from '@/lib/api'
import { DriveMilkdownRenderer } from './milkdown-renderer'
import { DrivePreviewToolbarItemView } from './drive-preview-header'
import {
  DriveRendererToolbarProvider,
  useDriveRendererToolbar,
} from './drive-renderer-toolbar-context'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const layoutMode = vi.hoisted(() => ({ value: 'regular' as 'regular' | 'compact' }))

vi.mock('@/features/file-browser/preview/file-preview-layout', () => ({
  useFilePreviewLayoutMode: () => layoutMode.value,
}))

let root: Root | null = null
let host: HTMLDivElement | null = null
let queryClient: QueryClient | null = null

beforeEach(() => {
  layoutMode.value = 'regular'
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: vi.fn(function (this: Range) {
      const top = this.toString() === 'First' ? 120 : this.toString() === 'Second' ? 360 : 0
      return top > 0 ? [new DOMRect(16, top, 80, 20)] : []
    }),
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: vi.fn(() => new DOMRect()),
  })
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('IntersectionObserver', class IntersectionObserver {
    readonly root = null
    readonly rootMargin = '0px'
    readonly thresholds = [0]
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  })
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
      await Promise.resolve()
    })
  }
  queryClient?.clear()
  host?.remove()
  root = null
  host = null
  queryClient = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DriveMilkdownRenderer comment integration', () => {
  it('opens a resizable wide comment rail and navigates positioned Milkdown comments', async () => {
    vi.spyOn(driveAnnotationApi, 'listOwner').mockResolvedValue([
      commentThread('thread-first', 'First', { start: 0, end: 5 }, 'First comment'),
      commentThread('thread-second', 'Second', { start: 5, end: 11 }, 'Second comment'),
      commentThread('thread-unavailable', 'Missing', { start: 40, end: 47 }, 'Unlocated comment'),
    ])
    renderRenderer()

    await waitFor(() => {
      expect(driveAnnotationApi.listOwner).toHaveBeenCalledWith('file')
      expect(document.querySelector('[data-milkdown-resizable-panel="comments"]')).not.toBeNull()
      expect(document.querySelector('[data-markdown-comments-mode="anchored"]')).not.toBeNull()
    })

    expect(document.querySelector('[data-slot="resizable-panel-group"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="resizable-handle"]')).not.toBeNull()
    expect(buttonWithText('评论 3').getAttribute('aria-pressed')).toBe('true')
    expect(document.body.textContent).toContain('编辑中暂未定位')

    const scroller = milkdownScroller()
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo

    await click(buttonByLabel('下一条评论'))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 96, behavior: 'instant' })
    expect(buttonByLabel('查看评论：First').getAttribute('aria-current')).toBe('true')

    await click(buttonByLabel('下一条评论'))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 336, behavior: 'instant' })
    expect(buttonByLabel('查看评论：Second').getAttribute('aria-current')).toBe('true')

    await click(buttonByLabel('上一条评论'))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 96, behavior: 'instant' })

    await click(buttonByLabel('查看评论：Second'))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 336, behavior: 'instant' })
  })

  it('opens existing comments in a compact list Sheet without mounting the wide rail', async () => {
    layoutMode.value = 'compact'
    vi.spyOn(driveAnnotationApi, 'listOwner').mockResolvedValue([
      commentThread('thread-first', 'First', { start: 0, end: 5 }, 'First comment'),
      commentThread('thread-second', 'Second', { start: 5, end: 11 }, 'Second comment'),
    ])
    renderRenderer()

    await waitFor(() => {
      expect(document.querySelector('[data-milkdown-sheet="comments"]')).not.toBeNull()
      expect(document.querySelector('[data-markdown-comments-mode="list"]')).not.toBeNull()
    })

    expect(document.querySelector('[data-milkdown-resizable-panel="comments"]')).toBeNull()
    expect(buttonWithText('评论 2').getAttribute('aria-pressed')).toBe('true')
    expect(document.body.textContent).toContain('First comment')
    expect(document.body.textContent).toContain('Second comment')
  })

  it('keeps source fallback comments in list mode without guessing anchor navigation', async () => {
    vi.spyOn(driveAnnotationApi, 'listOwner').mockResolvedValue([
      commentThread('thread-first', 'First', { start: 0, end: 5 }, 'First comment'),
      commentThread('thread-second', 'Second', { start: 5, end: 11 }, 'Second comment'),
    ])
    renderRenderer({
      preview: preview('---\ntitle: Notes\n---\nFirst Second'),
    })

    await waitFor(() => {
      expect(document.querySelector('textarea[aria-label="Markdown 源码"]')).not.toBeNull()
      expect(document.querySelector('[data-milkdown-resizable-panel="comments"]')).not.toBeNull()
      expect(document.querySelector('[data-markdown-comments-mode="list"]')).not.toBeNull()
    })

    expect(document.querySelector('[data-markdown-comments-mode="anchored"]')).toBeNull()
    expect(document.querySelector('[data-drive-milkdown-comment-overlay="true"]')).toBeNull()
    expect(buttonByLabel('上一条评论').disabled).toBe(true)
    expect(buttonByLabel('下一条评论').disabled).toBe(true)
    expect(document.body.textContent).toContain('First comment')
    expect(document.body.textContent).toContain('Second comment')
    expect(document.body.textContent).toContain('编辑中暂未定位')
  })
})

function renderRenderer({
  preview: nextPreview = preview('# First\n\nSecond'),
}: {
  readonly preview?: DriveBrowserPreviewDto
} = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient as QueryClient}>
        <DriveRendererToolbarProvider>
          <ToolbarHost />
          <DriveMilkdownRenderer
            current={current()}
            preview={nextPreview}
            edit={editable()}
            editContext={editContext()}
            annotationContext={{ context: 'owner', itemId: 'file' }}
          />
        </DriveRendererToolbarProvider>
      </QueryClientProvider>
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

function current(): DriveBrowserItemDto {
  return {
    id: 'file',
    name: 'notes.md',
    type: 'file',
    size: '20',
    mimeType: 'text/markdown',
    updatedAt: '2026-09-08T00:00:00.000Z',
    previewKind: 'markdown',
    browserUrl: '/drive/items/file',
    downloadUrl: '/drive/items/file/download',
  }
}

function preview(text: string): DriveBrowserPreviewDto {
  return {
    kind: 'markdown',
    text,
    html: '<h1>First</h1><p>Second</p>',
    outline: null,
    truncated: false,
    imageUrl: null,
    visitUrl: null,
    relativeImages: [],
  }
}

function editable(): DriveBrowserEditDto {
  return { canEdit: true, editorKind: 'text', currentVersionId: 'version-1', reason: null }
}

function editContext(): NonNullable<ComponentProps<typeof DriveMilkdownRenderer>['editContext']> {
  return {
    reload: vi.fn(async () => ({} as never)),
    reloading: false,
    saveText: vi.fn(async () => ({} as never)),
    savingText: false,
  }
}

function commentThread(
  id: string,
  exact: string,
  range: { readonly start: number; readonly end: number },
  body: string,
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
      quote: { exact, prefix: '', suffix: '' },
    },
    anchorStatus: 'attached',
    anchor: {
      schemaVersion: 2,
      baseVersionId: 'version-1',
      selectors: {
        schemaVersion: 2,
        kind: 'textRange',
        position: range,
        quote: { exact, prefix: '', suffix: '' },
        semantic: { blockId: `block-${id}`, blockLocalRange: range, headingPath: [] },
      },
      positionStatus: 'attached',
      quoteStatus: 'exact',
      resolvedSourceRange: range,
      resolvedRenderedRange: range,
      confidence: 1,
      lastResolvedVersionId: 'version-1',
    },
    author: { id: 'user-1', email: null, handle: 'author' },
    comments: [{
      id: `comment-${id}`,
      threadId: id,
      parentCommentId: null,
      body,
      author: { id: 'user-1', email: null, handle: 'author' },
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      deleted: false,
      permissions: { canEdit: true, canDelete: true },
    }],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    permissions: { canDelete: true },
  }
}

async function waitFor(assertion: () => void): Promise<void> {
  await act(async () => {
    await vi.waitFor(assertion, { timeout: 2_000 })
  })
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent?.trim() === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`)
  return button
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label="${label}"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return button
}

function milkdownScroller(): HTMLDivElement {
  const scroller = document.querySelector('[data-drive-milkdown-scroll="true"]')
  if (!(scroller instanceof HTMLDivElement)) throw new Error('Missing Milkdown scroller')
  return scroller
}
