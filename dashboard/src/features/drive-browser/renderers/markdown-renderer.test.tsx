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

let root: Root | null = null
let host: HTMLDivElement | null = null
let annotationsMock: ReturnType<typeof createAnnotationsMock>
let scrollIntoViewMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  annotationsMock = createAnnotationsMock()
  scrollIntoViewMock = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoViewMock
  useAuthStore.getState().auth.reset()
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
})

describe('DriveMarkdownRenderer', () => {
  it('opens the comment rail by default when comments exist', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown()

    await act(async () => undefined)

    expect(document.body.textContent).toContain('评论 1')
    expect(document.body.textContent).toContain('Comment body')
  })

  it('creates a comment from selected rendered text', async () => {
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
  })

  it('does not open the composer for logged-out share viewers', async () => {
    renderMarkdown({ annotationContext: { context: 'share', shareId: 'share-1' } })
    selectStrongText()

    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(document.querySelector('textarea')).toBeNull()
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
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('scrolls to the rendered marker when a thread is focused from the rail', async () => {
    annotationsMock.threads = [thread()]
    renderMarkdown()

    await act(async () => undefined)
    await click(elementWithText('Comment body'))

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
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
  annotationContext = { context: 'owner' as const, itemId: 'item-1' },
}: {
  readonly currentItem?: ReturnType<typeof current>
  readonly annotationContext?: ComponentProps<typeof DriveMarkdownRenderer>['annotationContext']
} = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <DriveRendererToolbarProvider>
        <ToolbarHost />
        <DriveMarkdownRenderer
          current={currentItem}
          preview={preview()}
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

function preview() {
  return {
    kind: 'markdown' as const,
    text: '这是 重点 内容',
    html: '<p>这是 <strong>重点</strong> 内容</p>',
    outline: [],
    truncated: false,
    imageUrl: null,
    visitUrl: null,
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

function elementWithText(text: string) {
  const element = Array.from(document.querySelectorAll('section, article, p')).find((item) => item.textContent?.includes(text))
  if (!element) throw new Error(`Missing element ${text}`)
  return element as HTMLElement
}

function textarea() {
  const element = document.querySelector('textarea')
  if (!element) throw new Error('Missing textarea')
  return element as HTMLTextAreaElement
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

async function inputValue(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
