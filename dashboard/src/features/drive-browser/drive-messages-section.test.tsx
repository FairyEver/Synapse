// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveMessageDto } from '@synapse/shared'
import { DriveMessagesSection } from './drive-messages-section'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const author = { id: 'reader', handle: 'reader', email: null }
const message: DriveMessageDto = {
  id: 'message', itemId: 'doc', body: '原留言', author,
  createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', editedAt: null,
  permissions: { canEdit: false, canDelete: true },
  comments: [
    { id: 'one', messageId: 'message', parentCommentId: null, body: '第一层', author, createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', editedAt: null, permissions: { canEdit: true, canDelete: true } },
    { id: 'two', messageId: 'message', parentCommentId: 'one', body: '第二层', author, createdAt: '2026-09-30T00:00:01.000Z', updatedAt: '2026-09-30T00:00:01.000Z', editedAt: null, permissions: { canEdit: false, canDelete: false } },
  ],
}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
})

async function renderSection(overrides: Record<string, unknown> = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const methods = {
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

describe('DriveMessagesSection', () => {
  it('shows nested replies with capped indentation and owner deletion without edit', async () => {
    const methods = await renderSection()
    expect(document.querySelector('[data-drive-message-comment-id="two"]')?.textContent).toContain('回复 reader')
    expect(document.querySelector('[data-drive-message-id="message"]')?.textContent).toContain('原留言')
    expect([...document.querySelectorAll('[data-drive-message-id="message"] button')].some((item) => item.textContent === '编辑')).toBe(true) // own reply
    await act(async () => button('删除').click())
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
