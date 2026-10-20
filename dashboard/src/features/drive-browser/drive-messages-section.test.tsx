// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveMessageDto } from '@synapse/shared'
import { DriveMessagesSection } from './drive-messages-section'
import { driveBrowserApi } from '@/lib/api'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const author = { id: 'reader', handle: 'reader', email: null }
const message: DriveMessageDto = {
  id: 'message', itemId: 'doc', body: '原留言', bodyHtml: '<p>原留言</p>', author,
  createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', editedAt: null,
  permissions: { canEdit: false, canDelete: true },
  comments: [
    { id: 'one', messageId: 'message', parentCommentId: null, body: '第一层', bodyHtml: '<p>第一层</p>', author, createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', editedAt: null, permissions: { canEdit: true, canDelete: true } },
    { id: 'two', messageId: 'message', parentCommentId: 'one', body: '第二层', bodyHtml: '<p>第二层</p>', author, createdAt: '2026-09-30T00:00:01.000Z', updatedAt: '2026-09-30T00:00:01.000Z', editedAt: null, permissions: { canEdit: false, canDelete: false } },
  ],
}

let root: Root | null = null
let host: HTMLDivElement | null = null
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => this.onload?.()) }
  })
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderSection(overrides: Record<string, unknown> = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const methods = {
    imageUploadContext: { kind: 'owner', itemId: 'doc', purpose: 'message' },
    messages: [message], canPost: true, loading: false, error: null,
    create: vi.fn(async () => message), update: vi.fn(async () => message), delete: vi.fn(async () => ({ ok: true })),
    reply: vi.fn(async () => message.comments[0]), updateComment: vi.fn(async () => message.comments[0]),
    deleteComment: vi.fn(async () => ({ ok: true })), refresh: vi.fn(), ...overrides,
  }
  await act(async () => root?.render(<DriveMessagesSection messages={methods as never} />))
  return methods
}

function button(label: string) {
  const result = [...document.querySelectorAll('button')].find((item) => item.textContent === label)
  if (!result) throw new Error(`Missing button: ${label}`)
  return result as HTMLButtonElement
}

async function expandComposer() {
  const input = document.querySelector('textarea[aria-label="新建留言"]') as HTMLTextAreaElement | null
  if (input) {
    await act(async () => input.focus())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

async function openActions(selector: string) {
  const trigger = document.querySelector(`${selector} button[aria-label$="操作：reader"]`) as HTMLButtonElement
  if (!trigger) throw new Error(`Missing actions: ${selector}`)
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}

async function selectAction(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === label)
  if (!item) throw new Error(`Missing menu item: ${label}`)
  await act(async () => item.click())
}

async function pasteImages(files: readonly File[]) {
  await expandComposer()
  const paste = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(paste, 'clipboardData', { value: { items: files.map((file) => ({ type: file.type, getAsFile: () => file })) } })
  await act(async () => { document.querySelector('[data-drive-message-editor]')!.dispatchEvent(paste) })
}

function imageFile(name = '截图.png', size = 3) {
  return new File([new Uint8Array(size)], name, { type: 'image/png' })
}

describe('DriveMessagesSection', () => {
  it('expands the new-message editor on focus and returns to the compact input after publishing', async () => {
    const methods = await renderSection()
    expect(document.querySelector('textarea[aria-label="新建留言"]')).not.toBeNull()
    expect(document.querySelector('[role="toolbar"]')).toBeNull()
    expect(document.body.textContent).not.toContain('发布留言')
    await expandComposer()
    const editor = document.querySelector('[data-drive-message-editor] [contenteditable="true"]')!
    expect(editor.contains(window.getSelection()?.anchorNode ?? null)).toBe(true)
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue({ url: '/object/img_new' } as never)
    await pasteImages([imageFile()])
    await act(async () => button('发布留言').click())
    expect(methods.create).toHaveBeenCalledWith(expect.stringContaining('/object/img_new'))
    expect(document.querySelector('textarea[aria-label="新建留言"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('发布留言')
  })

  it('keeps permitted actions in menus and requires a cancellable deletion confirmation', async () => {
    const methods = await renderSection()
    expect(document.body.textContent).not.toContain('编辑')
    expect(document.body.textContent).not.toContain('删除')
    await openActions('[data-drive-message-id="message"]')
    expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(['删除'])
    await selectAction('删除')
    expect(methods.delete).not.toHaveBeenCalled()
    await act(async () => button('取消').click())
    expect(document.querySelector('[aria-label="删除留言确认"]')).toBeNull()
    await openActions('[data-drive-message-id="message"]')
    await selectAction('删除')
    await act(async () => button('确认删除（含下级回复）').click())
    expect(methods.delete).toHaveBeenCalledExactlyOnceWith('message')
  })

  it('expands and uploads when an image is dropped onto the compact input', async () => {
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue({ url: '/object/img_drop' } as never)
    await renderSection()
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [imageFile('drop.png')] } })
    await act(async () => { document.querySelector('textarea[aria-label="新建留言"]')!.dispatchEvent(drop) })
    expect(drop.defaultPrevented).toBe(true)
    expect(document.querySelector('[data-drive-message-editor] img')?.getAttribute('src')).toBe('/object/img_drop')
    expect(button('发布留言').disabled).toBe(false)
  })

  it('keeps a draft across replies and starts a clean editor after publishing it', async () => {
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue({ url: '/object/img_draft' } as never)
    const methods = await renderSection()
    await pasteImages([imageFile()])
    await act(async () => button('回复').click())
    await act(async () => button('取消').click())
    expect(document.querySelector('[data-drive-message-editor] img')?.getAttribute('src')).toBe('/object/img_draft')
    await act(async () => button('发布留言').click())
    expect(methods.create).toHaveBeenCalledWith(expect.stringContaining('/object/img_draft'))
    await expandComposer()
    expect(document.querySelector('[data-drive-message-editor] img')).toBeNull()
    expect(button('发布留言').disabled).toBe(true)
  })

  it('renders safe message Markdown and image replies instead of literal source', async () => {
    await renderSection({ canPost: false, messages: [{ ...message, body: '**重点**', bodyHtml: '<p><strong>重点</strong></p>', comments: [{ ...message.comments[0], body: '![截图](/object/img_test)', bodyHtml: '<p><img src="/object/img_test" alt="截图"></p>' }] }] })
    expect(document.querySelector('[data-drive-message-id="message"] strong')?.textContent).toBe('重点')
    expect(document.querySelector('[data-drive-message-comment-id="one"] img')?.getAttribute('src')).toBe('/object/img_test')
  })

  it('uploads pasted screenshots and blocks publication until upload finishes', async () => {
    let complete!: (value: never) => void
    const upload = vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    await renderSection()
    await expandComposer()
    const editor = document.querySelector('[data-drive-message-editor]') ?? document.querySelector('textarea')!
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { items: [{ type: 'image/png', getAsFile: () => new File(['png'], '截图.png', { type: 'image/png' }) }] } })
    await act(async () => { editor.dispatchEvent(paste) })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(button('发布留言').disabled).toBe(true)
    await act(async () => { complete({ url: '/object/img_test' } as never) })
    expect(document.querySelector('[data-drive-message-editor] img')?.getAttribute('src')).toBe('/object/img_test')
    expect(button('发布留言').disabled).toBe(false)
  })

  it('publishes image-only Markdown in clipboard order and retains it on submission failure', async () => {
    let index = 0
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockImplementation(async () => ({ url: `/object/img_${++index}` }) as never)
    const create = vi.fn().mockRejectedValue(new Error('保存失败'))
    await renderSection({ create })
    await pasteImages([imageFile('一.png'), imageFile('二.png')])
    await act(async () => button('发布留言').click())
    const body = create.mock.calls[0]?.[0] as string
    expect(body).toContain('![一](/object/img_1)')
    expect(body).toContain('![二](/object/img_2)')
    expect(body.indexOf('/object/img_1')).toBeLessThan(body.indexOf('/object/img_2'))
    expect(document.querySelectorAll('[data-drive-message-editor] img')).toHaveLength(2)
    expect(document.body.textContent).toContain('保存失败')
  })

  it('does not insert a late reply upload into the new-message draft after cancellation', async () => {
    let complete!: (value: never) => void
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    await renderSection()
    await act(async () => button('回复').click())
    await pasteImages([imageFile()])
    await act(async () => button('取消').click())
    await act(async () => { complete({ url: '/object/img_late' } as never) })
    expect(document.querySelector('textarea[aria-label="新建留言"]')).not.toBeNull()
    expect(document.querySelector('[data-drive-message-editor] img')).toBeNull()
    expect(document.body.textContent).not.toContain('发布留言')
  })

  it('keeps an edited reply intact when an upload fails and rejects oversize images before uploading', async () => {
    const upload = vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockRejectedValue(new Error('网络中断'))
    await renderSection()
    await openActions('[data-drive-message-comment-id="one"]')
    await selectAction('编辑')
    await pasteImages([imageFile()])
    expect(document.querySelector('[data-drive-message-editor]')?.textContent).toContain('第一层')
    expect(document.body.textContent).toContain('网络中断')
    await pasteImages([imageFile('large.png', 20 * 1024 * 1024 + 1)])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('20MB')
    expect(button('保存').disabled).toBe(false)
  })

  it('does not bubble save shortcuts to the document editor', async () => {
    const save = vi.fn()
    document.addEventListener('keydown', save)
    try {
      await renderSection()
      await expandComposer()
      const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
      document.querySelector('[data-drive-message-editor]')!.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(save).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', save)
    }
  })

  it('inserts uploaded images in source mode without losing the existing reply', async () => {
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue({ url: '/object/img_source' } as never)
    const methods = await renderSection()
    await openActions('[data-drive-message-comment-id="one"]')
    await selectAction('编辑')
    await act(async () => { (document.querySelector('[aria-label="源码模式"]') as HTMLButtonElement).click() })
    await pasteImages([imageFile()])
    await act(async () => button('保存').click())
    expect(methods.updateComment).toHaveBeenCalledWith({ commentId: 'one', body: expect.stringContaining('第一层') })
    expect(methods.updateComment.mock.calls[0]?.[0].body).toContain('/object/img_source')
  })

  it('supports both dropping and selecting image files', async () => {
    let index = 0
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockImplementation(async () => ({ url: `/object/img_file_${++index}` }) as never)
    await renderSection()
    await expandComposer()
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [imageFile('drop.png')] } })
    await act(async () => { document.querySelector('[data-drive-message-editor]')!.dispatchEvent(drop) })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [imageFile('select.png')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(document.querySelectorAll('[data-drive-message-editor] img')).toHaveLength(2)
    expect(button('发布留言').disabled).toBe(false)
  })

  it('preserves historical mixed task and plain lists through source editing', async () => {
    const body = '- plain\n- [x] task'
    const methods = await renderSection({ messages: [{ ...message, comments: [{ ...message.comments[0], body, bodyHtml: '<ul><li>plain</li><li>task</li></ul>' }] }] })
    await openActions('[data-drive-message-comment-id="one"]')
    await selectAction('编辑')
    const source = document.querySelector('textarea[aria-label="编辑回复"]') as HTMLTextAreaElement
    expect(source?.value).toBe(body)
    const changed = '- plain changed\n- [x] task'
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(source, changed)
      source.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('保存').click())
    expect(methods.updateComment).toHaveBeenCalledWith({ commentId: 'one', body: changed })
  })
  it('shows nested replies with capped indentation and owner deletion without edit', async () => {
    const methods = await renderSection()
    expect(document.querySelector('[data-drive-message-comment-id="two"]')?.textContent).toContain('回复 reader')
    expect(document.querySelector('[data-drive-message-id="message"]')?.textContent).toContain('原留言')
    const nestedReplyButton = [...document.querySelectorAll<HTMLButtonElement>('[data-drive-message-comment-id="one"] button')].find((item) => item.textContent === '回复')!
    await act(async () => nestedReplyButton.click())
    expect(document.querySelector('[data-drive-message-editor][aria-label="回复留言"]')).toBeTruthy()
    expect(document.querySelector('[data-drive-message-editor][aria-label="回复评论"]')).toBeNull()
    await act(async () => button('取消').click())
    await openActions('[data-drive-message-id="message"]')
    await selectAction('删除')
    expect(button('确认删除（含下级回复）')).toBeTruthy()
    await act(async () => button('确认删除（含下级回复）').click())
    expect(methods.delete).toHaveBeenCalledWith('message')
  })

  it('hides all mutation actions for anonymous readers', async () => {
    await renderSection({ canPost: false, messages: [{ ...message, permissions: { canEdit: false, canDelete: false }, comments: [] }] })
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.body.textContent).not.toContain('发布留言')
    expect(document.body.textContent).not.toContain('删除')
  })
})
