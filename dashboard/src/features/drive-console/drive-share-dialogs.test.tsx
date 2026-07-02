// @vitest-environment jsdom

import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveShareListItemDto } from '@synapse/shared'
import { toast } from 'sonner'
import { driveApi } from '@/lib/api'
import {
  DriveShareSettingsDialog,
  DriveSharesDialog,
  mergeDriveShareEditorEmails,
  prepareDriveShareSettingsForSubmit,
} from './drive-share-dialogs'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  driveApi: {
    listShares: vi.fn(),
    disableShare: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: vi.fn(),
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('DriveShareSettingsDialog', () => {
  it('submits desktop-compatible share settings', async () => {
    const onConfirm = vi.fn(async () => undefined)
    render(<DriveShareSettingsDialog open itemName='notes.md' submitting={false} onOpenChange={() => undefined} onConfirm={onConfirm} />)

    await click(textButton('创建分享'))

    expect(onConfirm).toHaveBeenCalledWith({
      passwordEnabled: true,
      expiresIn: '3d',
      accessMode: 'link_read',
      editorEmails: [],
    })
  })

  it('normalizes editor emails for specified user shares', () => {
    expect(prepareDriveShareSettingsForSubmit({
      passwordEnabled: true,
      expiresIn: '3d',
      accessMode: 'specified_users_edit',
      editorEmails: ['OWNER@example.com'],
    }, 'owner@example.com, user@example.com')).toEqual({
      settings: {
        passwordEnabled: true,
        expiresIn: '3d',
        accessMode: 'specified_users_edit',
        editorEmails: ['owner@example.com', 'user@example.com'],
      },
      error: null,
    })
  })

  it('requires editor emails for specified user shares', () => {
    expect(prepareDriveShareSettingsForSubmit({
      passwordEnabled: true,
      expiresIn: '3d',
      accessMode: 'specified_users_edit',
      editorEmails: [],
    }, '')).toEqual({
      settings: null,
      error: '请至少添加一个可编辑用户。',
    })
  })

  it('rejects invalid editor email input', () => {
    expect(mergeDriveShareEditorEmails([], 'not-an-email')).toEqual({
      emails: [],
      error: '邮箱格式无效。',
    })
  })
})

describe('DriveSharesDialog', () => {
  it('lists shares and cancels a share', async () => {
    vi.mocked(driveApi.listShares).mockResolvedValue({
      items: [{
        id: 'share-db-id',
        shareId: 'shr_1',
        itemId: 'item-1',
        itemName: 'notes.md',
        itemType: 'file',
        sourceDeleted: false,
        url: 'https://example.com/share/shr_1',
        urlWithPassword: 'https://example.com/share/shr_1?p=abc',
        passwordEnabled: true,
        password: 'abc',
        expiresAt: null,
        accessMode: 'link_read',
        editorEmails: [],
        createdAt: '2026-06-29T00:00:00.000Z',
      }],
      page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.disableShare).mockResolvedValue({ ok: true })
    render(<DriveSharesDialog open onOpenChange={() => undefined} onChanged={async () => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('notes.md')
    await click(textButton('取消分享'))
    expect(driveApi.disableShare).toHaveBeenCalledWith('share-db-id')
  })

  it('shows feedback when canceling a share fails', async () => {
    vi.mocked(driveApi.listShares).mockResolvedValue({
      items: [{
        id: 'share-db-id',
        shareId: 'shr_1',
        itemId: 'item-1',
        itemName: 'notes.md',
        itemType: 'file',
        sourceDeleted: false,
        url: 'https://example.com/share/shr_1',
        urlWithPassword: 'https://example.com/share/shr_1?p=abc',
        passwordEnabled: true,
        password: 'abc',
        expiresAt: null,
        accessMode: 'link_read',
        editorEmails: [],
        createdAt: '2026-06-29T00:00:00.000Z',
      }],
      page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.disableShare).mockRejectedValue(new Error('取消失败'))
    render(<DriveSharesDialog open onOpenChange={() => undefined} onChanged={async () => undefined} />)
    await flush()

    await click(textButton('取消分享'))
    await flush()

    expect(toast).toHaveBeenCalledWith('取消失败')
  })

  it('loads more share pages before showing an empty filtered tab', async () => {
    vi.mocked(driveApi.listShares)
      .mockResolvedValueOnce({
        items: [shareItem({ id: 'share-folder', itemName: '资料夹', itemType: 'folder' })],
        page: { offset: 0, limit: 50, hasMore: true, nextOffset: 50 },
      })
      .mockResolvedValueOnce({
        items: [shareItem({ id: 'share-file', itemName: '后续文件.md', itemType: 'file' })],
        page: { offset: 50, limit: 50, hasMore: false, nextOffset: null },
      })

    render(<DriveSharesDialog open onOpenChange={() => undefined} onChanged={async () => undefined} />)
    await flush()

    expect(document.body.textContent).not.toContain('暂无分享')
    expect(document.body.textContent).toContain('加载更多')

    await click(textButton('加载更多'))
    await flush()

    expect(driveApi.listShares).toHaveBeenNthCalledWith(1, { offset: 0, limit: 50 })
    expect(driveApi.listShares).toHaveBeenNthCalledWith(2, { offset: 50, limit: 50 })
    expect(document.body.textContent).toContain('后续文件.md')
    expect(document.body.textContent).not.toContain('加载更多')
  })
})

function render(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(element))
}

async function flush() {
  await act(async () => undefined)
}

function textButton(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`missing button ${text}`)
  return button
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function shareItem(overrides: Partial<DriveShareListItemDto> = {}): DriveShareListItemDto {
  return {
    id: 'share-db-id',
    shareId: 'shr_1',
    itemId: 'item-1',
    itemName: 'notes.md',
    itemType: 'file',
    sourceDeleted: false,
    url: 'https://example.com/share/shr_1',
    urlWithPassword: 'https://example.com/share/shr_1?p=abc',
    passwordEnabled: true,
    password: 'abc',
    expiresAt: null,
    accessMode: 'link_read',
    editorEmails: [],
    createdAt: '2026-06-29T00:00:00.000Z',
    ...overrides,
  }
}
