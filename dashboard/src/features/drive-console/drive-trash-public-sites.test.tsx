// @vitest-environment jsdom

import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { driveApi } from '@/lib/api'
import { DrivePublicAssetsView } from './drive-public-assets-view'
import { DriveSiteCreateDialog, DriveSitesDialog } from './drive-sites-dialogs'
import { DriveTrashView } from './drive-trash-view'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  driveApi: {
    listTrash: vi.fn(),
    restoreItem: vi.fn(),
    deleteTrashItem: vi.fn(),
    listPublicAssets: vi.fn(),
    preparePublicAssetUpload: vi.fn(),
    completePublicAssetUpload: vi.fn(),
    cancelPublicAssetUpload: vi.fn(),
    preparePublicAssetReplace: vi.fn(),
    completePublicAssetReplace: vi.fn(),
    cancelPublicAssetReplace: vi.fn(),
    renamePublicAsset: vi.fn(),
    trashPublicAsset: vi.fn(),
    restorePublicAsset: vi.fn(),
    publicAssetDownloadUrl: vi.fn((assetId: string) => `/api/drive/public-assets/${assetId}/download`),
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
  vi.clearAllMocks()
})

describe('DriveTrashView', () => {
  it('restores and removes trash items', async () => {
    vi.mocked(driveApi.listTrash).mockResolvedValue({
      items: [{ id: 'item-1', kind: 'normal', name: 'old.md', type: 'file', size: '10', mimeType: 'text/markdown', originalPath: '/old.md', trashedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.restoreItem).mockResolvedValue({} as never)
    vi.mocked(driveApi.deleteTrashItem).mockResolvedValue({ ok: true })
    render(<DriveTrashView onChanged={async () => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('old.md')
    await click(textButton('恢复'))
    expect(driveApi.restoreItem).toHaveBeenCalledWith('item-1')
    await click(textButton('删除'))
    expect(driveApi.deleteTrashItem).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('删除old.md')
    await click(lastTextButton('删除'))
    expect(driveApi.deleteTrashItem).toHaveBeenCalledWith('item-1')
  })

  it('restores public asset trash items through the public asset endpoint', async () => {
    vi.mocked(driveApi.listTrash).mockResolvedValue({
      items: [{ id: 'item-1', kind: 'public_asset', assetId: 'asset-1', name: 'logo.png', type: 'file', size: '10', mimeType: 'image/png', originalPath: '/logo.png', trashedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.restorePublicAsset).mockResolvedValue({} as never)
    render(<DriveTrashView onChanged={async () => undefined} />)
    await flush()

    await click(textButton('恢复'))
    expect(driveApi.restorePublicAsset).toHaveBeenCalledWith('asset-1')
    expect(driveApi.restoreItem).not.toHaveBeenCalled()
  })
})

describe('DrivePublicAssetsView', () => {
  it('lists public assets and moves one to trash', async () => {
    vi.mocked(driveApi.listPublicAssets).mockResolvedValue({
      items: [{ assetId: 'asset-1', itemId: 'item-1', name: 'logo.png', size: '10', mimeType: 'image/png', url: '/files/asset-1', lifecycleStatus: 'active', accessCount: '0', responseBytes: '0', lastAccessedAt: null, createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.trashPublicAsset).mockResolvedValue({} as never)
    render(<DrivePublicAssetsView onChanged={async () => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('logo.png')
    await click(textButton('删除'))
    expect(driveApi.trashPublicAsset).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('删除logo.png')
    await click(lastTextButton('删除'))
    expect(driveApi.trashPublicAsset).toHaveBeenCalledWith('asset-1')
  })

  it('cancels a public asset upload and shows feedback when transfer fails', async () => {
    vi.mocked(driveApi.listPublicAssets).mockResolvedValue({
      items: [],
      total: 0,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.preparePublicAssetUpload).mockResolvedValue({
      sessionId: 'upload-1',
      item: {} as never,
      upload: { method: 'PUT', url: 'https://upload.example/new', expiresAt: '', headers: {} },
    })
    vi.mocked(driveApi.cancelPublicAssetUpload).mockResolvedValue({ ok: true })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500, statusText: 'Bad Gateway' }))
    render(<DrivePublicAssetsView onChanged={async () => undefined} />)
    await flush()

    const uploadInput = document.querySelector('input[aria-label="上传公开素材"]')
    if (!(uploadInput instanceof HTMLInputElement)) throw new Error('missing upload input')
    const file = new File(['new'], 'first.png', { type: 'image/png' })
    Object.defineProperty(uploadInput, 'files', { value: [file], configurable: true })
    await act(async () => uploadInput.dispatchEvent(new Event('change', { bubbles: true })))
    await flush()

    expect(driveApi.cancelPublicAssetUpload).toHaveBeenCalledWith('upload-1')
    expect(toast).toHaveBeenCalledWith('Bad Gateway')
  })

  it('uploads the first public asset from the empty state', async () => {
    vi.mocked(driveApi.listPublicAssets).mockResolvedValue({
      items: [],
      total: 0,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.preparePublicAssetUpload).mockResolvedValue({
      sessionId: 'upload-1',
      item: {} as never,
      upload: { method: 'PUT', url: 'https://upload.example/new', expiresAt: '', headers: {} },
    })
    vi.mocked(driveApi.completePublicAssetUpload).mockResolvedValue({} as never)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    render(<DrivePublicAssetsView onChanged={async () => undefined} />)
    await flush()

    const uploadInput = document.querySelector('input[aria-label="上传公开素材"]')
    if (!(uploadInput instanceof HTMLInputElement)) throw new Error('missing upload input')
    const file = new File(['new'], 'first.png', { type: 'image/png' })
    Object.defineProperty(uploadInput, 'files', { value: [file], configurable: true })
    await act(async () => uploadInput.dispatchEvent(new Event('change', { bubbles: true })))

    expect(driveApi.preparePublicAssetUpload).toHaveBeenCalledWith({ name: 'first.png', size: String(file.size), mimeType: 'image/png' })
    expect(driveApi.completePublicAssetUpload).toHaveBeenCalledWith('upload-1')
  })

  it('does not cancel a completed public asset upload when refresh fails', async () => {
    vi.mocked(driveApi.listPublicAssets).mockResolvedValue({
      items: [],
      total: 0,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.preparePublicAssetUpload).mockResolvedValue({
      sessionId: 'upload-1',
      item: {} as never,
      upload: { method: 'PUT', url: 'https://upload.example/new', expiresAt: '', headers: {} },
    })
    vi.mocked(driveApi.completePublicAssetUpload).mockResolvedValue({} as never)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    render(<DrivePublicAssetsView onChanged={async () => { throw new Error('刷新失败') }} />)
    await flush()

    const uploadInput = document.querySelector('input[aria-label="上传公开素材"]')
    if (!(uploadInput instanceof HTMLInputElement)) throw new Error('missing upload input')
    const file = new File(['new'], 'first.png', { type: 'image/png' })
    Object.defineProperty(uploadInput, 'files', { value: [file], configurable: true })
    await act(async () => uploadInput.dispatchEvent(new Event('change', { bubbles: true })))
    await flush()

    expect(driveApi.completePublicAssetUpload).toHaveBeenCalledWith('upload-1')
    expect(driveApi.cancelPublicAssetUpload).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('刷新失败')
  })

  it('uploads, renames, and replaces public assets', async () => {
    vi.mocked(driveApi.listPublicAssets).mockResolvedValue({
      items: [{ assetId: 'asset-1', itemId: 'item-1', name: 'logo.png', size: '10', mimeType: 'image/png', url: '/files/asset-1', lifecycleStatus: 'active', accessCount: '0', responseBytes: '0', lastAccessedAt: null, createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.preparePublicAssetUpload).mockResolvedValue({ sessionId: 'upload-1', item: {} as never, upload: { method: 'PUT', url: 'https://upload.example/new', expiresAt: '', headers: {} } })
    vi.mocked(driveApi.preparePublicAssetReplace).mockResolvedValue({ sessionId: 'replace-1', item: {} as never, upload: { method: 'PUT', url: 'https://upload.example/replace', expiresAt: '', headers: {} } })
    vi.mocked(driveApi.completePublicAssetUpload).mockResolvedValue({} as never)
    vi.mocked(driveApi.completePublicAssetReplace).mockResolvedValue({} as never)
    vi.mocked(driveApi.renamePublicAsset).mockResolvedValue({} as never)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    render(<DrivePublicAssetsView onChanged={async () => undefined} />)
    await flush()

    const uploadInput = document.querySelector('input[aria-label="上传公开素材"]')
    if (!(uploadInput instanceof HTMLInputElement)) throw new Error('missing upload input')
    const nextFile = new File(['new'], 'new-logo.png', { type: 'image/png' })
    Object.defineProperty(uploadInput, 'files', { value: [nextFile], configurable: true })
    await act(async () => uploadInput.dispatchEvent(new Event('change', { bubbles: true })))
    expect(driveApi.preparePublicAssetUpload).toHaveBeenCalledWith({ name: 'new-logo.png', size: String(nextFile.size), mimeType: 'image/png' })
    expect(driveApi.completePublicAssetUpload).toHaveBeenCalledWith('upload-1')

    await click(textButton('重命名'))
    await input('素材名称', 'renamed.png')
    await click(textButton('保存'))
    expect(driveApi.renamePublicAsset).toHaveBeenCalledWith('asset-1', 'renamed.png')

    await click(textButton('替换'))
    const replaceInput = document.querySelector('input[aria-label="替换公开素材"]')
    if (!(replaceInput instanceof HTMLInputElement)) throw new Error('missing replace input')
    const replaceFile = new File(['replace'], 'replace.png', { type: 'image/png' })
    Object.defineProperty(replaceInput, 'files', { value: [replaceFile], configurable: true })
    await act(async () => replaceInput.dispatchEvent(new Event('change', { bubbles: true })))
    expect(driveApi.preparePublicAssetReplace).toHaveBeenCalledWith('asset-1', { name: 'replace.png', size: String(replaceFile.size), mimeType: 'image/png' })
    expect(driveApi.completePublicAssetReplace).toHaveBeenCalledWith('asset-1', 'replace-1')
  })
})

describe('Drive site dialogs', () => {
  it('creates a site from a folder', async () => {
    vi.mocked(driveApi.preflightSite).mockResolvedValue({
      sourceFolderItemId: 'folder-1',
      sourceFolderName: '站点',
      htmlFiles: ['index.html'],
      defaultEntryPath: 'index.html',
      fileCount: 1,
      totalBytes: '10',
      includesJavaScript: false,
    })
    vi.mocked(driveApi.createSite).mockResolvedValue({} as never)
    render(<DriveSiteCreateDialog folder={{ id: 'folder-1', name: '站点' } as never} open onOpenChange={() => undefined} onCreated={async () => undefined} />)
    await flush()

    await click(textButton('发布'))
    expect(driveApi.createSite).toHaveBeenCalledWith({
      sourceFolderItemId: 'folder-1',
      name: '站点',
      entryPath: 'index.html',
      accessMode: 'public',
      expiresIn: 'forever',
    })
  })

  it('creates a site with a selected non-default entry page', async () => {
    vi.mocked(driveApi.preflightSite).mockResolvedValue({
      sourceFolderItemId: 'folder-1',
      sourceFolderName: '站点',
      htmlFiles: ['home.html', 'docs/start.html'],
      defaultEntryPath: null,
      fileCount: 2,
      totalBytes: '20',
      includesJavaScript: false,
    })
    vi.mocked(driveApi.createSite).mockResolvedValue({} as never)
    render(<DriveSiteCreateDialog folder={{ id: 'folder-1', name: '站点' } as never} open onOpenChange={() => undefined} onCreated={async () => undefined} />)
    await flush()

    expect(textButton('发布')).toHaveProperty('disabled', true)
    await selectOption('docs/start.html')
    await click(textButton('发布'))

    expect(driveApi.createSite).toHaveBeenCalledWith({
      sourceFolderItemId: 'folder-1',
      name: '站点',
      entryPath: 'docs/start.html',
      accessMode: 'public',
      expiresIn: 'forever',
    })
  })

  it('lists sites and disables one', async () => {
    vi.mocked(driveApi.listSites).mockResolvedValue({
      items: [{ id: 'db-1', siteId: 'site-1', name: 'Docs', status: 'active', accessMode: 'public', url: '/sites/site-1', urlWithPassword: '/sites/site-1', passwordEnabled: false, password: null, expiresAt: null, sourceFolderItemId: 'folder-1', sourceFolderName: '站点', entryPath: 'index.html', fileCount: 1, totalBytes: '10', createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z', lastPublishedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.disableSite).mockResolvedValue({} as never)
    render(<DriveSitesDialog open onOpenChange={() => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('Docs')
    await click(textButton('停用'))
    expect(driveApi.disableSite).toHaveBeenCalledWith('site-1')
    await click(textButton('访问设置'))
    await click(textButton('保存访问'))
    expect(driveApi.updateSiteAccess).toHaveBeenCalledWith('site-1', {
      accessMode: 'public',
      expiresIn: 'forever',
    })
    await click(textButton('删除'))
    expect(driveApi.deleteSite).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('删除Docs')
    await click(lastTextButton('删除'))
    expect(driveApi.deleteSite).toHaveBeenCalledWith('site-1')
  })

  it('loads more sites from the next page', async () => {
    vi.mocked(driveApi.listSites)
      .mockResolvedValueOnce({
        items: [{ id: 'db-1', siteId: 'site-1', name: 'Docs 1', status: 'active', accessMode: 'public', url: '/sites/site-1', urlWithPassword: '/sites/site-1', passwordEnabled: false, password: null, expiresAt: null, sourceFolderItemId: 'folder-1', sourceFolderName: '站点', entryPath: 'index.html', fileCount: 1, totalBytes: '10', createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z', lastPublishedAt: '2026-06-29T00:00:00.000Z' }],
        total: 51,
        page: { offset: 0, limit: 50, hasMore: true, nextOffset: 50 },
      })
      .mockResolvedValueOnce({
        items: [{ id: 'db-51', siteId: 'site-51', name: 'Docs 51', status: 'active', accessMode: 'public', url: '/sites/site-51', urlWithPassword: '/sites/site-51', passwordEnabled: false, password: null, expiresAt: null, sourceFolderItemId: 'folder-1', sourceFolderName: '站点', entryPath: 'index.html', fileCount: 1, totalBytes: '10', createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z', lastPublishedAt: '2026-06-29T00:00:00.000Z' }],
        total: 51,
        page: { offset: 50, limit: 50, hasMore: false, nextOffset: null },
      })
    render(<DriveSitesDialog open onOpenChange={() => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('Docs 1')
    expect(document.body.textContent).not.toContain('Docs 51')
    await click(textButton('加载更多'))

    expect(driveApi.listSites).toHaveBeenLastCalledWith({ offset: 50, limit: 50 })
    expect(document.body.textContent).toContain('Docs 51')
    expect(() => textButton('加载更多')).toThrow()
  })

  it('does not offer enable for failed sites without a deployment', async () => {
    vi.mocked(driveApi.listSites).mockResolvedValue({
      items: [{ id: 'db-1', siteId: 'site-failed', name: 'Broken', status: 'failed', accessMode: 'public', url: '/sites/site-failed', urlWithPassword: '/sites/site-failed', passwordEnabled: false, password: null, expiresAt: null, sourceFolderItemId: 'folder-1', sourceFolderName: '站点', entryPath: null, fileCount: 0, totalBytes: '0', createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z', lastPublishedAt: null }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    render(<DriveSitesDialog open onOpenChange={() => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('Broken')
    expect(() => textButton('启用')).toThrow()
    await click(textButton('重发'))
    expect(driveApi.enableSite).not.toHaveBeenCalled()
    expect(driveApi.republishSite).toHaveBeenCalledWith('site-failed', { entryPath: null })
  })

  it('shows password site links with access credentials', async () => {
    vi.mocked(driveApi.listSites).mockResolvedValue({
      items: [{ id: 'db-1', siteId: 'site-1', name: 'Docs', status: 'active', accessMode: 'password', url: '/sites/site-1', urlWithPassword: '/sites/site-1?password=SitePw1', passwordEnabled: true, password: 'SitePw1', expiresAt: null, sourceFolderItemId: 'folder-1', sourceFolderName: '站点', entryPath: 'index.html', fileCount: 1, totalBytes: '10', createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z', lastPublishedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })

    render(<DriveSitesDialog open onOpenChange={() => undefined} />)
    await flush()

    const linkInput = document.querySelector('input')
    expect(linkInput).toBeInstanceOf(HTMLInputElement)
    expect((linkInput as HTMLInputElement | null)?.value).toBe('/sites/site-1?password=SitePw1')
  })

  it('does not reuse stale preflight when the target folder changes', async () => {
    const pendingPreflight = new Promise<never>(() => undefined)
    vi.mocked(driveApi.preflightSite)
      .mockResolvedValueOnce({
        sourceFolderItemId: 'folder-1',
        sourceFolderName: '旧站点',
        htmlFiles: ['index.html'],
        defaultEntryPath: 'index.html',
        fileCount: 1,
        totalBytes: '10',
        includesJavaScript: false,
      })
      .mockReturnValueOnce(pendingPreflight)
    render(<DriveSiteCreateDialog folder={{ id: 'folder-1', name: '旧站点' } as never} open onOpenChange={() => undefined} onCreated={async () => undefined} />)
    await flush()

    rerender(<DriveSiteCreateDialog folder={{ id: 'folder-2', name: '新站点' } as never} open onOpenChange={() => undefined} onCreated={async () => undefined} />)
    await click(textButton('发布'))

    expect(driveApi.createSite).not.toHaveBeenCalled()
  })
})

function render(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(element))
}

function rerender(element: ReactElement) {
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

function lastTextButton(text: string) {
  const button = Array.from(document.querySelectorAll('button')).filter((item) => item.textContent?.includes(text)).at(-1)
  if (!button) throw new Error(`missing button ${text}`)
  return button
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function selectOption(text: string) {
  const elementPrototype = HTMLElement.prototype as HTMLElement['__proto__'] & {
    hasPointerCapture?: () => boolean
    setPointerCapture?: () => void
    releasePointerCapture?: () => void
    scrollIntoView?: () => void
  }
  elementPrototype.hasPointerCapture ??= () => false
  elementPrototype.setPointerCapture ??= () => undefined
  elementPrototype.releasePointerCapture ??= () => undefined
  elementPrototype.scrollIntoView ??= () => undefined
  const trigger = document.querySelector('button[role="combobox"]')
  if (!(trigger instanceof HTMLElement)) throw new Error('missing select trigger')
  await act(async () => {
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
  })
  await flush()
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((item) => item.textContent?.includes(text))
  if (!(option instanceof HTMLElement)) throw new Error(`missing option ${text}`)
  await act(async () => {
    option.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function input(labelText: string, value: string) {
  const label = Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.includes(labelText))
  const id = label?.getAttribute('for')
  const field = id ? document.getElementById(id) : null
  if (!(field instanceof HTMLInputElement)) throw new Error(`missing input ${labelText}`)
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
