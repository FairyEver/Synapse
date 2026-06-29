// @vitest-environment jsdom

import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { driveApi } from '@/lib/api'
import { DrivePublicAssetsView } from './drive-public-assets-view'
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
  },
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
    expect(driveApi.deleteTrashItem).toHaveBeenCalledWith('item-1')
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
    expect(driveApi.trashPublicAsset).toHaveBeenCalledWith('asset-1')
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
