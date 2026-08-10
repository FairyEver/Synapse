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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MarkdownCommentsRail', () => {
  it('renders plain text comments and orphaned position messages', () => {
    renderRail()

    expect(document.body.textContent).toContain('评论')
    expect(document.body.textContent).toContain('1')
    expect(document.body.textContent).toContain('First line')
    expect(document.body.textContent).toContain('Second line')
    expect(document.body.textContent).toContain('未定位 1')
    expect(document.body.textContent).toContain('原文已修改或删除')
    expect(document.body.textContent).toContain('“Note”')
    expect(document.body.innerHTML).not.toContain('<strong>unsafe</strong>')
  })

  it('orders unlocated comments by latest activity before attached comments in compact mode', () => {
    renderRail({
      mode: 'list',
      threads: [
        thread({ id: 'attached', body: 'Attached', anchorStatus: 'attached', anchorTop: 10 }),
        thread({ id: 'older', body: 'Older lost', updatedAt: '2026-06-21T00:01:00.000Z' }),
        thread({ id: 'newer', body: 'Newer lost', updatedAt: '2026-06-21T00:02:00.000Z' }),
      ],
    })

    const text = document.body.textContent ?? ''
    expect(text.indexOf('Newer lost')).toBeLessThan(text.indexOf('Older lost'))
    expect(text.indexOf('Older lost')).toBeLessThan(text.indexOf('Attached'))
  })

  it('keeps the unlocated section visible when its comments are collapsed', async () => {
    renderRail()

    await click(buttonWithText('未定位 1'))

    expect(document.body.textContent).toContain('未定位 1')
    expect(document.body.textContent).not.toContain('First line')
  })

  it('renders a compact empty state when no comments are present', () => {
    renderRail({ threads: [] })

    expect(document.body.textContent).toContain('评论')
    expect(document.body.textContent).toContain('0')
    expect(document.body.textContent).toContain('暂无评论')
  })

  it('submits replies from an inline composer in the active thread card', async () => {
    const onReply = vi.fn(async () => undefined)
    renderRail({ onReply })

    await click(buttonWithText('回复'))
    expect(replyComposer('thread-1')).not.toBeNull()
    expect(optionalDialogContent()).toBeNull()
    expect(threadCard('thread-1').querySelector('textarea')).not.toBeNull()
    expect(threadCard('thread-1').querySelector('.bg-amber-400')).not.toBeNull()
    await inputValue(textarea(), 'Reply body')
    await click(buttonWithText('发送'))

    expect(onReply).toHaveBeenCalledWith({ threadId: 'thread-1', parentCommentId: 'comment-1', body: 'Reply body' })
    expect(replyComposer('thread-1')).toBeNull()
  })

  it('shows inline reply failures and keeps the typed body', async () => {
    const onReply = vi.fn(async () => {
      throw new Error('回复失败')
    })
    renderRail({ onReply })

    await click(buttonWithText('回复'))
    await inputValue(textarea(), 'Reply body')
    await click(buttonWithText('发送'))

    expect(replyComposer('thread-1')).not.toBeNull()
    expect(document.body.textContent).toContain('回复失败')
    expect(textarea().value).toBe('Reply body')
  })

  it('cancels inline replies without submitting', async () => {
    const onReply = vi.fn(async () => undefined)
    renderRail({ onReply })

    await click(buttonWithText('回复'))
    await inputValue(textarea(), 'Draft reply')
    await click(buttonWithText('取消'))

    expect(onReply).not.toHaveBeenCalled()
    expect(replyComposer('thread-1')).toBeNull()
  })

  it('keeps one reply composer per thread and switches its target', async () => {
    const source = thread({ anchorStatus: 'attached' })
    const firstComment = source.thread.comments[0]
    const secondComment = {
      ...firstComment,
      id: 'comment-2',
      parentCommentId: 'comment-1',
      body: 'Second comment',
      author: { id: 'user-2', email: null, handle: 'reviewer' },
    }
    renderRail({ threads: [{ ...source, thread: { ...source.thread, comments: [firstComment, secondComment] } }] })

    const replyButtons = commentReplyButtons('thread-1')
    await click(replyButtons[0])
    await inputValue(textarea(), 'First draft')
    await click(replyButtons[1])

    expect(document.querySelectorAll('[data-markdown-comment-reply-composer="true"]')).toHaveLength(1)
    expect(replyComposer('thread-1')?.textContent).toContain('回复 reviewer')
    expect(textarea().value).toBe('')
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
    expect(document.body.textContent).not.toContain('删除评论')
    expect(document.body.textContent).not.toContain('删除讨论')
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

    expect(threadCard('thread-1').className).toContain('border-amber-400/70')
    expect(threadCard('thread-1').className).not.toContain('border-foreground')
    expect(threadCard('thread-1').textContent).toContain('“Note”')
    expect(threadCard('thread-1').querySelector('[data-slot="avatar"]')).not.toBeNull()
    expect(threadCard('thread-1').querySelector('time')).not.toBeNull()
    expect(threadCard('thread-1').querySelector('.bg-amber-400')).not.toBeNull()
    expect(buttonWithText('回复').className).toContain('text-xs')
    expect(buttonWithText('回复').className).toContain('h-7')
  })

  it('renders reply input inline and marks async errors as status text', async () => {
    const onReply = vi.fn(async () => {
      throw new Error('回复失败')
    })
    renderRail({ onReply })

    await click(buttonWithText('回复'))
    expect(optionalDialogContent()).toBeNull()
    expect(replyComposer('thread-1')).not.toBeNull()
    await inputValue(textarea(), 'Reply body')
    await click(buttonWithText('发送'))

    expect(document.querySelector('[role="status"]')?.textContent).toBe('回复失败')
  })

  it('shows pending state while an inline reply is being submitted', async () => {
    let resolveReply: (() => void) | null = null
    const onReply = vi.fn(() => new Promise<void>((resolve) => {
      resolveReply = resolve
    }))
    renderRail({ onReply })

    await click(buttonWithText('回复'))
    await inputValue(textarea(), 'Reply body')
    await click(buttonWithText('发送'))

    expect(buttonWithText('发送中').disabled).toBe(true)
    expect(textarea().disabled).toBe(true)
    await act(async () => resolveReply?.())
    expect(replyComposer('thread-1')).toBeNull()
  })

  it('positions attached comments by their markdown anchor', () => {
    renderRail({ threads: [thread({ anchorStatus: 'attached', anchorTop: 48 })] })

    expect(threadSection('thread-1').getAttribute('style')).toContain('top: 8px')
  })

  it('offsets attached comments by the markdown content position', () => {
    renderRail({ anchorBaseOffset: 24, threads: [thread({ anchorStatus: 'attached', anchorTop: 48 })] })

    expect(threadSection('thread-1').getAttribute('style')).toContain('top: 32px')
  })

  it('keeps the rail frame fixed and clips the translated anchored layer', () => {
    renderRail({ threads: [thread({ anchorStatus: 'attached', anchorTop: 0 })] })

    expect(commentRail().className).toContain('h-full')
    expect(commentRail().className).toContain('min-h-0')
    expect(commentRail().className).toContain('overflow-hidden')
    expect(commentRail().className).not.toContain('max-h-screen')
    expect(railTitle().className).toContain('shrink-0')
    expect(railScrollRegion().className).toContain('min-h-0')
    expect(railScrollRegion().className).toContain('flex-1')
    expect(anchoredRegion().className).toContain('overflow-hidden')
    expect(anchoredLayer().className).toContain('will-change-transform')
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

  it('reports the anchored document height for markdown bottom compensation', () => {
    const onAnchoredHeightChange = vi.fn()
    renderRail({
      threads: [thread({ anchorStatus: 'attached', anchorTop: 80 })],
      onAnchoredHeightChange,
    })

    expect(onAnchoredHeightChange).toHaveBeenLastCalledWith(208)
  })

  it('repositions anchored comments from the measured rail header height', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => frames.delete(frameId))
    TestResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', TestResizeObserver)

    renderRail({
      threads: [
        thread({ id: 'thread-1', anchorStatus: 'attached', anchorTop: 100 }),
        thread({ id: 'thread-2', anchorStatus: 'attached', anchorTop: 110 }),
      ],
    })
    const observer = TestResizeObserver.instances[0]
    if (!observer) throw new Error('Missing resize observer')

    observer.emit([
      resizeEntry(railTitle(), 56),
      resizeEntry(threadSection('thread-1'), 80),
      resizeEntry(threadSection('thread-2'), 40),
    ])
    await flushAnimationFrames(frames)

    expect(threadTop('thread-1')).toBe(44)
    expect(threadTop('thread-2')).toBe(136)
  })

  it('reflows anchored comments from live card sizes and batches resize work by frame', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frameId: number) => frames.delete(frameId)))
    TestResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', TestResizeObserver)

    renderRail({
      threads: [
        thread({ id: 'thread-1', body: 'First', anchorStatus: 'attached', anchorTop: 10 }),
        thread({ id: 'thread-2', body: 'Second', anchorStatus: 'attached', anchorTop: 20 }),
      ],
    })

    expect(TestResizeObserver.instances).toHaveLength(1)
    const observer = TestResizeObserver.instances[0]
    if (!observer) throw new Error('Missing resize observer')
    expect(observer.observed).toEqual(new Set([railTitle(), threadSection('thread-1'), threadSection('thread-2')]))

    observer.emit([
      resizeEntry(threadSection('thread-1'), 80),
      resizeEntry(threadSection('thread-2'), 40),
    ])
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    await flushAnimationFrames(frames)
    expect(threadTop('thread-2')).toBe(92)

    observer.emit([resizeEntry(threadSection('thread-1'), 180)])
    observer.emit([resizeEntry(threadSection('thread-1'), 200)])
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2)
    expect(threadTop('thread-2')).toBe(92)

    await flushAnimationFrames(frames)
    expect(threadTop('thread-2')).toBe(212)

    observer.emit([resizeEntry(threadSection('thread-1'), 240)])
    expect(frames.size).toBe(1)
    act(() => root?.unmount())
    root = null
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('reflows following anchored comments when the inline reply composer expands a card', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => frames.delete(frameId))
    TestResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    renderRail({
      threads: [
        thread({ id: 'thread-1', anchorStatus: 'attached', anchorTop: 10 }),
        thread({ id: 'thread-2', anchorStatus: 'attached', anchorTop: 20 }),
      ],
    })
    const observer = TestResizeObserver.instances[0]
    if (!observer) throw new Error('Missing resize observer')
    observer.emit([
      resizeEntry(threadSection('thread-1'), 80),
      resizeEntry(threadSection('thread-2'), 40),
    ])
    await flushAnimationFrames(frames)
    expect(threadTop('thread-2')).toBe(92)

    await click(commentReplyButtons('thread-1')[0])
    observer.emit([resizeEntry(threadSection('thread-1'), 180)])
    await flushAnimationFrames(frames)

    expect(replyComposer('thread-1')).not.toBeNull()
    expect(threadTop('thread-2')).toBe(192)
  })

  it('keeps the last measured card sizes while anchored cards are temporarily detached', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => frames.delete(frameId))
    TestResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const threads = [
      thread({ id: 'thread-1', body: 'First', anchorStatus: 'attached', anchorTop: 10 }),
      thread({ id: 'thread-2', body: 'Second', anchorStatus: 'attached', anchorTop: 20 }),
    ]

    renderRail({ threads })
    const observer = TestResizeObserver.instances[0]
    if (!observer) throw new Error('Missing resize observer')
    observer.emit([
      resizeEntry(threadSection('thread-1'), 80),
      resizeEntry(threadSection('thread-2'), 40),
    ])
    await flushAnimationFrames(frames)
    expect(threadTop('thread-2')).toBe(92)

    rerenderRail({ mode: 'list', threads })
    await flushAnimationFrames(frames)
    rerenderRail({ threads })

    expect(threadTop('thread-2')).toBe(92)
  })

  it('drops cached card sizes after a thread is actually removed', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => frames.delete(frameId))
    TestResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const first = thread({ id: 'thread-1', body: 'First', anchorStatus: 'attached', anchorTop: 10 })
    const second = thread({ id: 'thread-2', body: 'Second', anchorStatus: 'attached', anchorTop: 20 })

    renderRail({ threads: [first, second] })
    const observer = TestResizeObserver.instances[0]
    if (!observer) throw new Error('Missing resize observer')
    observer.emit([
      resizeEntry(threadSection('thread-1'), 200),
      resizeEntry(threadSection('thread-2'), 40),
    ])
    await flushAnimationFrames(frames)
    expect(threadTop('thread-2')).toBe(212)

    rerenderRail({ threads: [second] })
    rerenderRail({ threads: [first, second] })

    expect(threadTop('thread-2')).toBe(140)
  })

  it('keeps own comment deletion in the comment action menu and confirms before deleting', async () => {
    const onDeleteComment = vi.fn(async () => undefined)
    renderRail({
      onDeleteComment,
      threads: [thread({ canEdit: true, canDelete: true, canDeleteThread: true })],
    })

    expect(document.body.textContent).toContain('编辑')
    expect(document.body.textContent).not.toContain('删除评论')

    await click(requiredButtonWithLabel('更多评论操作'))

    expect(document.body.textContent).not.toContain('删除讨论')
    await click(actionElementWithText('删除评论'))

    expect(document.body.textContent).toContain('删除评论？')
    expect(onDeleteComment).not.toHaveBeenCalled()

    await click(buttonWithText('删除评论'))

    expect(onDeleteComment).toHaveBeenCalledWith('comment-1')
  })

  it('does not expose discussion deletion when only thread delete permission is allowed', () => {
    renderRail({
      threads: [thread({ canEdit: false, canDelete: false, canDeleteThread: true })],
    })

    expect(document.body.textContent).not.toContain('编辑')
    expect(document.body.textContent).not.toContain('删除评论')
    expect(document.body.textContent).not.toContain('删除讨论')
    expect(buttonWithLabel('更多评论操作')).toBeNull()
    expect(buttonWithLabel('讨论操作')).toBeNull()
  })

  it('deletes the selected reply from its own action menu', async () => {
    const onDeleteComment = vi.fn(async () => undefined)
    const source = thread({ canDeleteThread: true })
    const firstComment = source.thread.comments[0]
    const reply = {
      ...firstComment,
      id: 'comment-2',
      parentCommentId: 'comment-1',
      body: 'Reply body',
    }
    renderRail({
      onDeleteComment,
      threads: [{ ...source, thread: { ...source.thread, comments: [firstComment, reply] } }],
    })

    const actionButtons = document.querySelectorAll<HTMLButtonElement>('button[aria-label="更多评论操作"]')
    expect(actionButtons).toHaveLength(2)
    expect(buttonWithLabel('讨论操作')).toBeNull()
    const replyActionButton = actionButtons[1]
    if (!replyActionButton) throw new Error('Missing reply action button')

    await click(replyActionButton)

    expect(document.body.textContent).toContain('删除评论')
    expect(document.body.textContent).not.toContain('删除讨论')

    await click(actionElementWithText('删除评论'))
    await click(buttonWithText('删除评论'))

    expect(onDeleteComment).toHaveBeenCalledWith('comment-2')
  })
})

function renderRail(overrides: Partial<Parameters<typeof MarkdownCommentsRail>[0]> = {}) {
  host = document.createElement('div')
  document.body.append(host)
  const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.hasAttribute('data-markdown-comments-header')) return rectWithHeight(40)
    return getBoundingClientRect.call(this)
  })
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
        {...overrides}
      />
    )
  })
}

function rerenderRail(overrides: Partial<Parameters<typeof MarkdownCommentsRail>[0]> = {}) {
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
  readonly quote?: string
  readonly updatedAt?: string
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
        quote: { exact: input.quote ?? 'Note', prefix: '', suffix: '' },
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
      updatedAt: input.updatedAt ?? '2026-06-21T00:00:00.000Z',
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

function optionalDialogContent() {
  return document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
}

function replyComposer(threadId: string) {
  return threadCard(threadId).querySelector<HTMLElement>('[data-markdown-comment-reply-composer="true"]')
}

function commentReplyButtons(threadId: string) {
  const buttons = Array.from(threadCard(threadId).querySelectorAll<HTMLButtonElement>('button'))
    .filter((button) => button.textContent === '回复')
  if (buttons.length === 0) throw new Error(`Missing reply buttons for ${threadId}`)
  return buttons
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

function anchoredRegion() {
  const element = anchoredLayer().parentElement
  if (!(element instanceof HTMLElement)) throw new Error('Missing anchored region')
  return element
}

function anchoredLayer() {
  const element = document.querySelector('[data-markdown-comments-anchored-layer="true"]')
  if (!(element instanceof HTMLElement)) throw new Error('Missing anchored layer')
  return element
}

async function inputValue(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = []

  readonly observed = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this)
  }

  observe(target: Element) {
    this.observed.add(target)
  }

  readonly unobserve = vi.fn((target: Element) => {
    this.observed.delete(target)
  })

  readonly disconnect = vi.fn(() => {
    this.observed.clear()
  })

  emit(entries: ResizeObserverEntry[]) {
    this.callback(entries, this)
  }
}

function resizeEntry(target: Element, blockSize: number): ResizeObserverEntry {
  return {
    target,
    borderBoxSize: [{ blockSize, inlineSize: 0 }],
    contentBoxSize: [{ blockSize, inlineSize: 0 }],
    devicePixelContentBoxSize: [],
    contentRect: { height: blockSize } as DOMRectReadOnly,
  }
}

function rectWithHeight(height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 0,
    height,
    top: 0,
    right: 0,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  }
}

async function flushAnimationFrames(frames: Map<number, FrameRequestCallback>) {
  await act(async () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(performance.now()))
  })
}
