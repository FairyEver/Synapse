// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriveMarkdownRenderer } from './markdown-renderer'

vi.mock('../use-drive-annotations', () => ({
  useDriveAnnotations: () => annotationsMock,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
let annotationsMock: ReturnType<typeof createAnnotationsMock>

beforeEach(() => {
  annotationsMock = createAnnotationsMock()
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

    expect(document.body.textContent).toContain('notes.md')
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
})

function renderMarkdown() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <DriveMarkdownRenderer
        current={current()}
        preview={preview()}
        annotationContext={{ context: 'owner', itemId: 'item-1' }}
      />
    )
  })
}

function current() {
  return {
    id: 'item-1',
    name: 'notes.md',
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

function thread() {
  return {
    id: 'thread-1',
    itemId: 'item-1',
    baseVersionId: 'version-1',
    targetKind: 'textRange' as const,
    target: {
      schemaVersion: 1 as const,
      kind: 'textRange' as const,
      surface: 'markdownRenderedText' as const,
      range: { start: 3, end: 5 },
      quote: { exact: '重点', prefix: '这是 ', suffix: ' 内容' },
    },
    anchorStatus: 'attached' as const,
    author: { id: 'user-1', email: 'user@example.com', displayName: null },
    comments: [{
      id: 'comment-1',
      threadId: 'thread-1',
      parentCommentId: null,
      body: 'Comment body',
      author: { id: 'user-1', email: 'user@example.com', displayName: null },
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      deleted: false,
      permissions: { canEdit: true, canDelete: true },
    }],
    createdAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:00.000Z',
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

function textarea() {
  const element = document.querySelector('textarea')
  if (!element) throw new Error('Missing textarea')
  return element as HTMLTextAreaElement
}

async function inputValue(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
