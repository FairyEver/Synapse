// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownCommentsRail } from './markdown-comments-rail'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
})

describe('MarkdownCommentsRail', () => {
  it('renders plain text comments and orphaned position messages', () => {
    renderRail()

    expect(document.body.textContent).toContain('评论')
    expect(document.body.textContent).toContain('1')
    expect(document.body.textContent).toContain('First line')
    expect(document.body.textContent).toContain('Second line')
    expect(document.body.textContent).toContain('位置已变化')
    expect(document.body.innerHTML).not.toContain('<strong>unsafe</strong>')
  })

  it('renders a compact empty state when no comments are present', () => {
    renderRail({ threads: [] })

    expect(document.body.textContent).toContain('评论')
    expect(document.body.textContent).toContain('0')
    expect(document.body.textContent).toContain('暂无评论')
  })

  it('submits replies from a dialog without adding an inline composer to the rail', async () => {
    const onReply = vi.fn(async () => undefined)
    renderRail({ onReply })

    await click(buttonWithText('回复'))
    expect(document.body.textContent).toContain('回复评论')
    expect(threadCard('thread-1').querySelector('textarea')).toBeNull()
    await inputValue(textarea(), 'Reply body')
    await click(buttonWithText('发送'))

    expect(onReply).toHaveBeenCalledWith({ threadId: 'thread-1', parentCommentId: 'comment-1', body: 'Reply body' })
    expect(document.body.textContent).not.toContain('回复评论')
  })

  it('shows reply failures in the dialog and keeps the typed body', async () => {
    const onReply = vi.fn(async () => {
      throw new Error('回复失败')
    })
    renderRail({ onReply })

    await click(buttonWithText('回复'))
    await inputValue(textarea(), 'Reply body')
    await click(buttonWithText('发送'))

    expect(document.body.textContent).toContain('回复评论')
    expect(document.body.textContent).toContain('回复失败')
    expect(textarea().value).toBe('Reply body')
  })

  it('does not focus the thread when reply actions are clicked', async () => {
    const onFocusThread = vi.fn()
    const onReply = vi.fn(async () => undefined)
    renderRail({ onFocusThread, onReply })

    await click(buttonWithText('回复'))
    await inputValue(textarea(), 'Reply body')
    await click(buttonWithText('发送'))

    expect(onReply).toHaveBeenCalled()
    expect(onFocusThread).not.toHaveBeenCalled()
  })

  it('opens edits in a dialog with the existing body and saves changes', async () => {
    const onUpdateComment = vi.fn(async () => undefined)
    renderRail({ onUpdateComment })

    await click(buttonWithText('编辑'))

    expect(document.body.textContent).toContain('编辑评论')
    expect(textarea().value).toBe('First line\nSecond line\n<strong>unsafe</strong>')
    expect(threadCard('thread-1').querySelector('textarea')).toBeNull()

    await inputValue(textarea(), 'Updated comment')
    await click(buttonWithText('保存'))

    expect(onUpdateComment).toHaveBeenCalledWith({ commentId: 'comment-1', body: 'Updated comment' })
    expect(document.body.textContent).not.toContain('编辑评论')
  })

  it('cancels edit dialogs without updating the comment', async () => {
    const onUpdateComment = vi.fn(async () => undefined)
    renderRail({ onUpdateComment })

    await click(buttonWithText('编辑'))
    await inputValue(textarea(), 'Updated comment')
    await click(buttonWithText('取消'))

    expect(onUpdateComment).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('编辑评论')
    expect(document.body.textContent).toContain('First line')
  })

  it('hides edit and delete actions when permissions are false', () => {
    renderRail({ threads: [thread({ canEdit: false, canDelete: false, canDeleteThread: false })] })

    expect(document.body.textContent).toContain('回复')
    expect(document.body.textContent).not.toContain('编辑')
    expect(document.body.textContent).not.toContain('删除')
    expect(buttonWithLabel('更多评论操作')).toBeNull()
    expect(buttonWithLabel('讨论操作')).toBeNull()
  })

  it('hides reply actions when commenting is not allowed', () => {
    renderRail({ canReply: false })

    expect(document.body.textContent).not.toContain('回复')
  })

  it('does not render account email as an author fallback', () => {
    renderRail({ threads: [thread({ handle: null, email: null })] })

    expect(document.body.textContent).toContain('评论者')
    expect(document.body.textContent).not.toContain('user@example.com')
  })

  it('uses restrained product styling for active cards and comment actions', () => {
    renderRail({ activeThreadId: 'thread-1' })

    expect(threadCard('thread-1').className).toContain('border-ring')
    expect(threadCard('thread-1').className).not.toContain('border-foreground')
    expect(buttonWithText('回复').className).toContain('text-xs')
    expect(buttonWithText('回复').className).toContain('h-7')
  })

  it('renders comment text input in a dialog and marks async errors as status text', async () => {
    const onReply = vi.fn(async () => {
      throw new Error('回复失败')
    })
    renderRail({ onReply })

    await click(buttonWithText('回复'))
    expect(dialogContent()).not.toBeNull()
    expect(textarea().className).toContain('min-h-24')
    await inputValue(textarea(), 'Reply body')
    await click(buttonWithText('发送'))

    expect(document.querySelector('[role="status"]')?.textContent).toBe('回复失败')
  })

  it('positions attached comments by their markdown anchor', () => {
    renderRail({ threads: [thread({ anchorStatus: 'attached', anchorTop: 48 })] })

    expect(threadSection('thread-1').getAttribute('style')).toContain('top: 8px')
  })

  it('offsets attached comments by the markdown content position', () => {
    renderRail({ anchorBaseOffset: 24, threads: [thread({ anchorStatus: 'attached', anchorTop: 48 })] })

    expect(threadSection('thread-1').getAttribute('style')).toContain('top: 32px')
  })

  it('keeps the rail title sticky without an internal scrolling comment list', () => {
    renderRail({ threads: [thread({ anchorStatus: 'attached', anchorTop: 0 })] })

    expect(commentRail().className).toContain('min-h-full')
    expect(commentRail().className).not.toContain('max-h-screen')
    expect(railTitle().className).toContain('sticky')
    expect(railTitle().className).toContain('top-0')
    expect(railTitle().className).toContain('z-10')
    expect(railTitle().className).toContain('shrink-0')
    expect(railScrollRegion().className).not.toContain('overflow-y-auto')
  })

  it('keeps nearby anchored comments from overlapping', () => {
    renderRail({
      threads: [
        thread({ id: 'thread-1', body: 'First', anchorStatus: 'attached', anchorTop: 10 }),
        thread({ id: 'thread-2', body: 'Second', anchorStatus: 'attached', anchorTop: 20 }),
      ],
    })

    expect(threadTop('thread-2')).toBeGreaterThan(threadTop('thread-1') + 12)
  })

  it('keeps own comment deletion in the comment action menu and confirms before deleting', async () => {
    const onDeleteComment = vi.fn(async () => undefined)
    renderRail({
      onDeleteComment,
      threads: [thread({ canEdit: true, canDelete: true, canDeleteThread: false })],
    })

    expect(document.body.textContent).toContain('编辑')
    expect(document.body.textContent).not.toContain('删除评论')

    await click(requiredButtonWithLabel('更多评论操作'))
    await click(actionElementWithText('删除评论'))

    expect(document.body.textContent).toContain('删除评论？')
    expect(onDeleteComment).not.toHaveBeenCalled()

    await click(buttonWithText('删除评论'))

    expect(onDeleteComment).toHaveBeenCalledWith('comment-1')
  })

  it('keeps discussion deletion separate when only thread delete is allowed', async () => {
    const onDeleteThread = vi.fn(async () => undefined)
    renderRail({
      onDeleteThread,
      threads: [thread({ canEdit: false, canDelete: false, canDeleteThread: true })],
    })

    expect(document.body.textContent).not.toContain('编辑')
    expect(document.body.textContent).not.toContain('删除评论')

    await click(requiredButtonWithLabel('更多评论操作'))

    expect(document.body.textContent).not.toContain('删除评论')
    expect(document.body.textContent).toContain('删除讨论')

    await click(actionElementWithText('删除讨论'))
    expect(document.body.textContent).toContain('删除讨论？')
    expect(onDeleteThread).not.toHaveBeenCalled()

    await click(buttonWithText('删除讨论'))

    expect(onDeleteThread).toHaveBeenCalledWith('thread-1')
  })

  it('offers comment and discussion deletion separately when both delete permissions are allowed', async () => {
    const onDeleteComment = vi.fn(async () => undefined)
    const onDeleteThread = vi.fn(async () => undefined)
    renderRail({
      onDeleteComment,
      onDeleteThread,
      threads: [thread({ canEdit: true, canDelete: true, canDeleteThread: true })],
    })

    expect(document.querySelectorAll('button[aria-label="更多评论操作"]')).toHaveLength(1)
    expect(buttonWithLabel('讨论操作')).toBeNull()

    await click(requiredButtonWithLabel('更多评论操作'))

    expect(document.body.textContent).toContain('删除评论')
    expect(document.body.textContent).toContain('删除讨论')

    await click(actionElementWithText('删除评论'))
    await click(buttonWithText('删除评论'))

    expect(onDeleteComment).toHaveBeenCalledWith('comment-1')
    expect(onDeleteThread).not.toHaveBeenCalled()

    await click(requiredButtonWithLabel('更多评论操作'))
    await click(actionElementWithText('删除讨论'))
    expect(document.body.textContent).toContain('删除讨论？')
    await click(buttonWithText('删除讨论'))

    expect(onDeleteThread).toHaveBeenCalledWith('thread-1')
  })
})

function renderRail(overrides: Partial<Parameters<typeof MarkdownCommentsRail>[0]> = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <MarkdownCommentsRail
        threads={[thread()]}
        activeThreadId={null}
        canReply
        onFocusThread={vi.fn()}
        onReply={vi.fn(async () => undefined)}
        onUpdateComment={vi.fn(async () => undefined)}
        onDeleteComment={vi.fn(async () => undefined)}
        onDeleteThread={vi.fn(async () => undefined)}
        {...overrides}
      />
    )
  })
}

const canReply = true

function thread(input: {
  readonly id?: string
  readonly body?: string
  readonly anchorStatus?: 'attached' | 'shifted' | 'orphaned'
  readonly anchorTop?: number | null
  readonly canEdit?: boolean
  readonly canDelete?: boolean
  readonly canDeleteThread?: boolean
  readonly handle?: string | null
  readonly email?: string | null
} = {}) {
  const handle = 'handle' in input ? input.handle : 'user'
  const email = 'email' in input ? input.email : 'user@example.com'
  const id = input.id ?? 'thread-1'
  return {
    thread: {
      id,
      itemId: 'item-1',
      baseVersionId: 'version-1',
      targetKind: 'textRange' as const,
      target: {
        schemaVersion: 1 as const,
        kind: 'textRange' as const,
        surface: 'markdownRenderedText' as const,
        range: { start: 0, end: 4 },
        quote: { exact: 'Note', prefix: '', suffix: '' },
      },
      anchorStatus: input.anchorStatus ?? 'orphaned' as const,
      author: { id: 'user-1', email, handle },
      comments: [{
        id: 'comment-1',
        threadId: id,
        parentCommentId: null,
        body: input.body ?? 'First line\nSecond line\n<strong>unsafe</strong>',
        author: { id: 'user-1', email, handle },
        createdAt: '2026-06-21T00:00:00.000Z',
        updatedAt: '2026-06-21T00:00:00.000Z',
        editedAt: null,
        deletedAt: null,
        deleted: false,
        permissions: { canEdit: input.canEdit ?? true, canDelete: input.canDelete ?? true },
      }],
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:00.000Z',
      permissions: { canDelete: input.canDeleteThread ?? true },
    },
    anchorTop: input.anchorTop ?? null,
  }
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
    element.click()
  })
}

function buttonWithText(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`Missing button ${text}`)
  return button as HTMLButtonElement
}

function actionElementWithText(text: string) {
  const element = Array.from(document.querySelectorAll<HTMLElement>('button, [role="menuitem"]'))
    .find((item) => item.textContent?.includes(text))
  if (!element) throw new Error(`Missing action ${text}`)
  return element
}

function buttonWithLabel(label: string) {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function requiredButtonWithLabel(label: string) {
  const button = buttonWithLabel(label)
  if (!button) throw new Error(`Missing button ${label}`)
  return button
}

function textarea() {
  const element = document.querySelector('textarea')
  if (!element) throw new Error('Missing textarea')
  return element as HTMLTextAreaElement
}

function dialogContent() {
  const element = document.querySelector('[data-slot="dialog-content"]')
  if (!(element instanceof HTMLElement)) throw new Error('Missing dialog content')
  return element
}

function threadSection(threadId: string) {
  const element = document.querySelector(`[data-markdown-comment-thread-id="${threadId}"]`)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing thread ${threadId}`)
  return element
}

function threadCard(threadId: string) {
  const element = threadSection(threadId).querySelector('section')
  if (!(element instanceof HTMLElement)) throw new Error(`Missing thread card ${threadId}`)
  return element
}

function threadTop(threadId: string): number {
  const top = threadSection(threadId).style.top
  return Number(top.replace('px', ''))
}

function railTitle() {
  const element = document.querySelector('[data-markdown-comments-rail="true"] > div')
  if (!(element instanceof HTMLElement)) throw new Error('Missing rail title')
  return element
}

function commentRail() {
  const element = document.querySelector('[data-markdown-comments-rail="true"]')
  if (!(element instanceof HTMLElement)) throw new Error('Missing rail')
  return element
}

function railScrollRegion() {
  const element = document.querySelector('[data-markdown-comments-rail="true"] > div + div')
  if (!(element instanceof HTMLElement)) throw new Error('Missing rail scroll region')
  return element
}

async function inputValue(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
