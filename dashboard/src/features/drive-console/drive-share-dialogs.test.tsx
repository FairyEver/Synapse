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
    createShare: vi.fn(),
    listShares: vi.fn(),
    disableShare: vi.fn(),
    preflightSite: vi.fn(),
    createSite: vi.fn(),
    listSites: vi.fn(),
    updateSiteAccess: vi.fn(),
    disableSite: vi.fn(),
    enableSite: vi.fn(),
    republishSite: vi.fn(),
    deleteSite: vi.fn(),
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
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.clearAllMocks()
})

describe('DriveShareSettingsDialog', () => {
  it('submits desktop-compatible share settings', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.mocked(driveApi.createShare).mockResolvedValue({
      password: 'abc',
      url: 'https://example.com/share/shr_1',
      urlWithPassword: 'https://example.com/share/shr_1?p=abc',
    } as never)
    const onCreated = vi.fn(async () => undefined)
    render(<DriveShareSettingsDialog open item={{ id: 'file-1', name: 'notes.md', type: 'file' }} onOpenChange={() => undefined} onCreated={onCreated} />)

    await click(textButton('创建分享'))

    expect(driveApi.createShare).toHaveBeenCalledWith('file-1', {
      passwordEnabled: true,
      expiresIn: '3d',
      accessMode: 'link_read',
      editorEmails: [],
    })
    expect(onCreated).toHaveBeenCalled()
    expect(document.body.textContent).toContain('分享已创建')
    expect((document.querySelector('input') as HTMLInputElement | null)?.value).toBe('https://example.com/share/shr_1?p=abc')
    await click(textButton('复制链接'))
    expect(writeText).toHaveBeenCalledWith('https://example.com/share/shr_1?p=abc')
  })

  it('offers webpage sharing only for folders and uses protected three-day defaults', async () => {
    vi.mocked(driveApi.preflightSite).mockResolvedValue({
      sourceFolderItemId: 'folder-1',
      sourceFolderName: '网页',
      htmlFiles: ['index.html'],
      defaultEntryPath: 'index.html',
      fileCount: 4,
      totalBytes: '1024',
      includesJavaScript: true,
    })
    vi.mocked(driveApi.createSite).mockResolvedValue({
      password: 'secret',
      url: 'https://example.com/sites/site_1',
      urlWithPassword: 'https://example.com/sites/site_1?password=secret',
    } as never)
    render(<DriveShareSettingsDialog open item={{ id: 'folder-1', name: '网页', type: 'folder' }} onOpenChange={() => undefined} onCreated={async () => undefined} />)

    await click(textButton('网页分享'))
    await flush()

    expect(driveApi.preflightSite).toHaveBeenCalledWith('folder-1')
    expect(document.body.textContent).toContain('4 个文件')
    expect(document.body.textContent).toContain('包含 JavaScript')
    await click(textButton('创建分享'))
    expect(driveApi.createSite).toHaveBeenCalledWith({
      sourceFolderItemId: 'folder-1',
      name: '网页',
      entryPath: 'index.html',
      accessMode: 'password',
      expiresIn: '3d',
    })
  })

  it('keeps standalone HTML in ordinary file sharing', () => {
    render(<DriveShareSettingsDialog open item={{ id: 'html-1', name: 'index.html', type: 'file' }} onOpenChange={() => undefined} onCreated={async () => undefined} />)

    expect(document.body.textContent).not.toContain('网页分享')
    expect(document.body.textContent).toContain('权限')
  })

  it('blocks webpage sharing when a folder has no HTML entry', async () => {
    vi.mocked(driveApi.preflightSite).mockResolvedValue({
      sourceFolderItemId: 'folder-1',
      sourceFolderName: '资料',
      htmlFiles: [],
      defaultEntryPath: null,
      fileCount: 2,
      totalBytes: '20',
      includesJavaScript: false,
    })
    render(<DriveShareSettingsDialog open item={{ id: 'folder-1', name: '资料', type: 'folder' }} onOpenChange={() => undefined} onCreated={async () => undefined} />)

    await click(textButton('网页分享'))
    await flush()

    expect(document.body.textContent).toContain('文件夹中没有 HTML 文件')
    expect(textButton('创建分享')).toHaveProperty('disabled', true)
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

  it('preserves the current expiry when saving access settings without changing it', async () => {
    vi.mocked(driveApi.listShares).mockResolvedValue({
      items: [shareItem({ expiresAt: '2026-07-29T00:00:00.000Z' })],
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.createShare).mockResolvedValue({} as never)
    render(<DriveSharesDialog open onOpenChange={() => undefined} onChanged={async () => undefined} />)
    await flush()

    await click(textButton('访问设置'))
    expect(document.body.textContent).toContain('保持当前有效期')
    await click(textButton('保存'))

    expect(driveApi.createShare).toHaveBeenCalledWith('item-1', {
      accessMode: 'link_read',
      editorEmails: [],
    })
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

  it('opens webpage shares from the unified management dialog', async () => {
    vi.mocked(driveApi.listShares).mockResolvedValue({
      items: [],
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.listSites).mockResolvedValue({
      items: [{
        id: 'db-1',
        siteId: 'site-1',
        name: '产品网页',
        status: 'active',
        accessMode: 'password',
        url: '/sites/site-1',
        urlWithPassword: '/sites/site-1?password=abc',
        passwordEnabled: true,
        password: 'abc',
        expiresIn: '3d',
        expiresAt: null,
        sourceFolderItemId: 'folder-1',
        sourceFolderName: '网页',
        entryPath: 'index.html',
        fileCount: 4,
        totalBytes: '1024',
        createdAt: '2026-06-29T00:00:00.000Z',
        updatedAt: '2026-06-29T00:00:00.000Z',
        lastPublishedAt: '2026-06-29T00:00:00.000Z',
      }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    render(<DriveSharesDialog open onOpenChange={() => undefined} onChanged={async () => undefined} />)
    await flush()

    await click(textButton('网页'))
    await flush()

    expect(driveApi.listSites).toHaveBeenCalledWith({ offset: 0, limit: 50 })
    expect(document.body.textContent).toContain('产品网页')
    expect(document.body.textContent).toContain('更新网页')
    expect(document.body.textContent).toContain('停止分享')
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
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    element.click()
    await Promise.resolve()
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
