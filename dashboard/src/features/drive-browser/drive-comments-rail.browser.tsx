import './reader.css'
import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import {
  DriveCommentsRail,
  type DriveCommentsRailItem,
} from './drive-comments-rail'

// 超过评论卡片可用宽度（约 33 个汉字）的引文：会按 min-content 撑宽 滚动内容列
const LONG_QUOTE =
  '额度怎么扣？返回多少实际调用时，选择断言时，服务商断时，服务商规则说明部服务商与个人额度户／人工或流速。企业模型供根据某个人申请能／用量单次词元单次上量。'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('未定位评论弹窗横向布局', () => {
  it('引文超长时不撑宽弹窗，回复框和发送按钮保持在弹窗可见区内', async () => {
    await render(
      <DriveCommentsRail
        mode='anchored'
        threads={[orphanedThread(LONG_QUOTE)]}
        activeThreadId='thread-1'
        canReply
        onFocusThread={vi.fn()}
        onReply={vi.fn(async () => undefined)}
        onUpdateComment={vi.fn(async () => undefined)}
        onUpdateThreadStatus={vi.fn(async () => undefined)}
        onDeleteComment={vi.fn(async () => undefined)}
      />
    )

    await userEvent.click(
      await waitForElement('[data-markdown-comments-unlocated] button')
    )

    const dialog = await waitForElement(
      '[data-markdown-comments-unlocated-dialog]'
    )
    const viewport = await waitForElement(
      '[data-markdown-comments-unlocated-dialog] [data-drive-comments-dialog-scroll]'
    )
    const card = await waitForElement(
      '[data-markdown-comments-unlocated-dialog] [data-markdown-comment-thread-id]'
    )
    const composer = await waitForElement(
      '[data-markdown-comments-unlocated-dialog] [data-markdown-comment-reply-composer]'
    )
    const sendButton = [...composer.querySelectorAll('button')].find(
      (button) => button.textContent === '发送'
    )
    if (!sendButton) throw new Error('缺少回复框的发送按钮')

    // 同一帧内测量，避免弹窗入场动画期间两次取值不一致
    const dialogRight = dialog.getBoundingClientRect().right
    const measurements = {
      horizontalOverflow: viewport.scrollWidth - viewport.clientWidth,
      cardRight: card.getBoundingClientRect().right,
      composerRight: composer.getBoundingClientRect().right,
      sendRight: sendButton.getBoundingClientRect().right,
    }

    // soft 断言：引文撑宽弹窗时，把四项症状（溢出、卡片、回复框、发送按钮）一次报全
    expect.soft(measurements.horizontalOverflow).toBeLessThanOrEqual(1)
    expect.soft(measurements.cardRight).toBeLessThanOrEqual(dialogRight + 0.5)
    expect
      .soft(measurements.composerRight)
      .toBeLessThanOrEqual(dialogRight + 0.5)
    expect.soft(measurements.sendRight).toBeLessThanOrEqual(dialogRight + 0.5)
  })
})


for (const width of [390, 1280]) {
  it(`dismisses comment and status menus inside a dialog at ${width}px`, async () => {
    await page.viewport(width, 900)
    const data = orphanedThread('评论引文')
    await openDialog([{ ...data, thread: { ...data.thread, status: 'resolved' } }])
    const dialog = document.querySelector<HTMLElement>('[data-markdown-comments-unlocated-dialog]')!
    const triggers = [
      dialog.querySelector<HTMLButtonElement>('button[aria-label="已解决"]')!,
      dialog.querySelector<HTMLButtonElement>('button[aria-label^="评论操作："]')!,
    ]
    for (const trigger of triggers) {
      await userEvent.click(trigger)
      await waitForElement('[role="menu"]')
      await userEvent.click(trigger, { force: true })
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
      expect(document.contains(dialog)).toBe(true)
      await userEvent.click(trigger)
      await waitForElement('[role="menu"]')
      await userEvent.click(dialog.querySelector<HTMLElement>('[data-slot="modal-heading"]')!, { force: true })
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
      expect(document.contains(dialog)).toBe(true)
    }
  })

  describe(`未定位评论弹窗几何 ${width}px`, () => {
    it('标题保留内边距且少量评论按内容收缩', async () => {
      await page.viewport(width, 900)
      await openDialog([orphanedThread('内部子工作流')])
      const dialog = await waitForElement('[data-markdown-comments-unlocated-dialog]')
      const header = dialog.querySelector('[data-slot="modal-header"]') as HTMLElement
      const close = dialog.querySelector('[data-slot="modal-close-trigger"]') as HTMLElement
      const card = dialog.querySelector('[data-markdown-comment-thread-id]') as HTMLElement
      await vi.waitFor(() => expect(dialog.getAnimations().some((animation) => animation.playState === 'running')).toBe(false))
      const bounds = dialog.getBoundingClientRect()
      const title = header.getBoundingClientRect()
      expect.soft(title.left - bounds.left).toBeGreaterThanOrEqual(20)
      expect.soft(title.top - bounds.top).toBeGreaterThanOrEqual(20)
      expect.soft(bounds.bottom - card.getBoundingClientRect().bottom).toBeLessThan(80)
      expect.soft(close.getBoundingClientRect().right).toBeLessThan(bounds.right)
      expect.soft(bounds.right).toBeLessThanOrEqual(width)
      await page.screenshot({ path: `/tmp/synapse-unlocated-${width}.png` })
    })

    it('长评论只在正文区域滚动，标题和关闭按钮保持可见', async () => {
      await page.viewport(width, 600)
      const items = Array.from({ length: 12 }, (_, index) => {
        const item = orphanedThread(LONG_QUOTE)
        return { ...item, thread: { ...item.thread, id: `thread-${index}`, comments: item.thread.comments.map((comment) => ({ ...comment, id: `comment-${index}`, threadId: `thread-${index}` })) } }
      })
      await openDialog(items)
      const dialog = await waitForElement('[data-markdown-comments-unlocated-dialog]')
      const scroll = await waitForElement('[data-drive-comments-dialog-scroll]')
      expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight)
      const header = dialog.querySelector('[data-slot="modal-header"]')!
      const headerTop = header.getBoundingClientRect().top
      scroll.scrollTop = scroll.scrollHeight
      expect(header.getBoundingClientRect().top).toBe(headerTop)
      expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(600)
      expect(scroll.getBoundingClientRect().bottom).toBeLessThanOrEqual(dialog.getBoundingClientRect().bottom)
    })
  })
}

async function openDialog(threads: readonly DriveCommentsRailItem[]) {
  await render(<DriveCommentsRail mode='anchored' threads={threads} activeThreadId={null} canReply={false}
    onFocusThread={vi.fn()} onReply={vi.fn(async () => undefined)} onUpdateComment={vi.fn(async () => undefined)}
    onUpdateThreadStatus={vi.fn(async () => undefined)} onDeleteComment={vi.fn(async () => undefined)} />)
  await userEvent.click(await waitForElement('[data-markdown-comments-unlocated] button'))
  const dialog = await waitForElement('[data-markdown-comments-unlocated-dialog]')
  const backdrop = dialog.closest('[data-slot="modal-backdrop"]')!
  await vi.waitFor(() => expect(backdrop.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')).toBe(false))
}

async function waitForElement(selector: string): Promise<HTMLElement> {
  let found: HTMLElement | null = null
  await vi.waitFor(() => {
    const element = document.querySelector(selector)
    if (!(element instanceof HTMLElement))
      throw new Error(`缺少元素：${selector}`)
    found = element
  })
  if (!found) throw new Error(`缺少元素：${selector}`)
  return found
}

function orphanedThread(quote: string): DriveCommentsRailItem {
  return {
    thread: {
      id: 'thread-1',
      itemId: 'item-1',
      baseVersionId: 'version-1',
      targetKind: 'textRange',
      target: {
        schemaVersion: 1,
        kind: 'textRange',
        surface: 'markdownRenderedText',
        range: { start: 0, end: 4 },
        quote: { exact: quote, prefix: '', suffix: '' },
      },
      anchorStatus: 'orphaned',
      status: 'open',
      anchor: null,
      author: { id: 'user-1', email: 'user@example.com', handle: 'user' },
      comments: [
        {
          id: 'comment-1',
          threadId: 'thread-1',
          parentCommentId: null,
          body: '这块是什么逻辑？一个人填写更新整个公司的配置？',
          author: { id: 'user-1', email: 'user@example.com', handle: 'user' },
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
          editedAt: null,
          deletedAt: null,
          deleted: false,
          permissions: { canEdit: true, canDelete: true },
        },
      ],
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:00.000Z',
      permissions: { canDelete: true, canChangeStatus: true },
    },
    placement: { status: 'unavailable' },
  }
}
