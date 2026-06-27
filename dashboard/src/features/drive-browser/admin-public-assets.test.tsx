// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi, type AdminDrivePublicAssetRow } from '@/lib/api'
import { AdminPublicAssets } from './admin-public-assets'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  adminApi: {
    downloadDrivePublicAssetRevisionUrl: vi.fn((assetId: string, revisionId: string) => (
      `/api/admin/drive/public-assets/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/download`
    )),
    listDrivePublicAssetAccessLogs: vi.fn(),
    listDrivePublicAssetRevisions: vi.fn(),
    listDrivePublicAssets: vi.fn(),
  },
}))

const mockedAdminApi = vi.mocked(adminApi)

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  mockedAdminApi.listDrivePublicAssets.mockResolvedValue({
    data: [createPublicAsset({ assetId: 'asset/id', name: 'logo.png' })],
    page: 1,
    pageSize: 20,
    total: 1,
  })
  mockedAdminApi.listDrivePublicAssetAccessLogs.mockResolvedValue({
    data: [{
      accessedAt: '2026-06-18T10:00:00.000Z',
      bytes: '512',
      id: 'log-1',
      ip: '127.0.0.1',
      method: 'GET',
      referer: 'https://example.test/page',
      statusCode: 200,
      userAgent: 'Vitest',
    }],
    page: 1,
    pageSize: 20,
    total: 1,
  })
  mockedAdminApi.listDrivePublicAssetRevisions.mockResolvedValue({
    data: [{
      id: 'revision/id',
      mimeType: 'image/png',
      name: 'logo-old.png',
      replacedAt: '2026-06-17T10:00:00.000Z',
      size: '256',
    }],
    page: 1,
    pageSize: 20,
    total: 1,
  })
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('AdminPublicAssets', () => {
  it('searches assets and opens detail tabs with revision download links', async () => {
    renderView()

    await waitForText('logo.png')
    expect(mockedAdminApi.listDrivePublicAssets).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      search: undefined,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })

    await changeInput('搜索', ' owner@example.com ')
    await waitFor(() => {
      expect(mockedAdminApi.listDrivePublicAssets).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 10,
        search: 'owner@example.com',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })
    })

    await clickButtonText('详情')
    await waitForText('资源 ID')
    expect(mockedAdminApi.listDrivePublicAssetAccessLogs).toHaveBeenCalledWith('asset/id', {
      page: 1,
      pageSize: 10,
      sortBy: 'accessedAt',
      sortOrder: 'desc',
    })
    expect(mockedAdminApi.listDrivePublicAssetRevisions).toHaveBeenCalledWith('asset/id', {
      page: 1,
      pageSize: 10,
      sortBy: 'replacedAt',
      sortOrder: 'desc',
    })

    await clickButtonText('访问日志')
    await waitForText('https://example.test/page')

    await clickButtonText('历史版本')
    await waitForText('logo-old.png')
    const downloadLink = document.querySelector<HTMLAnchorElement>('a[href*="/revisions/"]')
    expect(downloadLink?.getAttribute('href')).toBe('/api/admin/drive/public-assets/asset%2Fid/revisions/revision%2Fid/download')
  })

  it('shows detail table fetch errors instead of empty states', async () => {
    mockedAdminApi.listDrivePublicAssetAccessLogs.mockRejectedValueOnce(new Error('访问日志加载失败'))
    mockedAdminApi.listDrivePublicAssetRevisions.mockRejectedValueOnce(new Error('历史版本加载失败'))
    renderView()

    await waitForText('logo.png')
    await clickButtonText('详情')

    await clickButtonText('访问日志')
    await waitForText('访问日志加载失败')
    expect(document.body.textContent).not.toContain('暂无访问日志')
    expect(document.body.textContent).toContain('重试')

    await clickButtonText('历史版本')
    await waitForText('历史版本加载失败')
    expect(document.body.textContent).not.toContain('暂无历史版本')
    expect(document.body.textContent).toContain('重试')
  })

  it('does not render public open links for inactive public assets', async () => {
    mockedAdminApi.listDrivePublicAssets.mockResolvedValueOnce({
      data: [
        createPublicAsset({ assetId: 'active-asset', name: 'active.png', url: 'https://assets.example/files/active-asset' }),
        createPublicAsset({
          assetId: 'trashed-asset',
          lifecycleStatus: 'trashed',
          name: 'trashed.png',
          url: 'https://assets.example/files/trashed-asset',
        }),
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    })
    renderView()

    await waitForText('trashed.png')

    const openLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
      .filter((item) => item.textContent?.trim() === '打开')
    expect(openLinks).toHaveLength(1)
    expect(openLinks[0]?.getAttribute('href')).toBe('https://assets.example/files/active-asset')
    const disabledOpenButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button:disabled'))
      .filter((item) => item.textContent?.trim() === '打开')
    expect(disabledOpenButtons).toHaveLength(1)
  })
})

function renderView() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <AdminPublicAssets />
      </QueryClientProvider>
    )
  })
}

async function clickButtonText(text: string) {
  const button = await waitFor(() => {
    const match = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((item) => item.textContent?.trim() === text)
    if (!match) throw new Error(`button not found: ${text}`)
    return match
  })
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    button.click()
    await flush()
  })
}

async function changeInput(placeholder: string, value: string) {
  const input = await waitFor(() => {
    const match = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
    if (!match) throw new Error(`input not found: ${placeholder}`)
    return match
  })
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
  })
}

async function waitForText(text: string) {
  await waitFor(() => {
    if (!document.body.textContent?.includes(text)) throw new Error(`text not found: ${text}`)
  })
}

async function waitFor<T>(read: () => T): Promise<T> {
  let lastError: unknown
  for (let index = 0; index < 20; index += 1) {
    try {
      return read()
    } catch (error) {
      lastError = error
      await act(async () => {
        await flush()
      })
    }
  }
  throw lastError
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createPublicAsset(overrides: Partial<AdminDrivePublicAssetRow> = {}): AdminDrivePublicAssetRow {
  return {
    accessCount: '3',
    assetId: 'asset_1',
    createdAt: '2026-06-18T09:00:00.000Z',
    itemId: 'item-1',
    lastAccessedAt: '2026-06-18T10:00:00.000Z',
    lifecycleStatus: 'active',
    mimeType: 'image/png',
    name: 'asset.png',
    owner: {
      displayName: 'Owner',
      email: 'owner@example.com',
      userId: 'user-1',
    },
    responseBytes: '1536',
    size: '1024',
    updatedAt: '2026-06-18T09:30:00.000Z',
    url: 'https://assets.example/files/asset_1',
    ...overrides,
  }
}
