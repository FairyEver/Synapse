// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi, type AdminDrivePublicAssetRow } from '@/lib/api'
import { AdminPublicAssetDetailsDialog } from './admin-public-assets'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  adminApi: {
    downloadDrivePublicAssetRevisionUrl: vi.fn((assetId: string, revisionId: string) => (
      `/api/admin/drive/public-assets/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/download`
    )),
    listDrivePublicAssetAccessLogs: vi.fn(),
    listDrivePublicAssetRevisions: vi.fn(),
  },
}))

const mockedAdminApi = vi.mocked(adminApi)

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  mockedAdminApi.listDrivePublicAssetAccessLogs.mockResolvedValue({
    data: [],
    page: 1,
    pageSize: 20,
    total: 0,
  })
  mockedAdminApi.listDrivePublicAssetRevisions.mockImplementation(async (_assetId, query) => ({
    data: [{
      id: query.page === 2 ? 'revision/page-2' : 'revision/page-1',
      mimeType: 'image/png',
      name: query.page === 2 ? 'logo-older.png' : 'logo-old.png',
      replacedAt: query.page === 2 ? '2026-06-16T10:00:00.000Z' : '2026-06-17T10:00:00.000Z',
      size: query.page === 2 ? '128' : '256',
    }],
    page: query.page,
    pageSize: query.pageSize,
    total: 25,
  }))
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

describe('AdminPublicAssetDetailsDialog', () => {
  it('loads later public asset revision pages', async () => {
    renderDialog()

    await clickButtonText('历史版本')
    await waitForText('logo-old.png')
    expect(document.body.textContent).toContain('1 / 3')

    await clickLastEnabledButtonContainingText('第 2 页')

    await waitFor(() => {
      expect(mockedAdminApi.listDrivePublicAssetRevisions).toHaveBeenLastCalledWith('asset/id', {
        page: 2,
        pageSize: 10,
        sortBy: 'replacedAt',
        sortOrder: 'desc',
      })
    })
    await waitForText('logo-older.png')
  })
})

function renderDialog() {
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
        <AdminPublicAssetDetailsDialog asset={createPublicAsset()} onOpenChange={vi.fn()} />
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
  await clickButton(button)
}

async function clickLastEnabledButtonText(text: string) {
  const button = await waitFor(() => {
    const root = document.querySelector('[role="tabpanel"][data-state="active"]') ?? document
    const matches = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
      .filter((item) => item.textContent?.trim() === text && !item.disabled)
    const match = matches.at(-1)
    if (!match) throw new Error(`enabled button not found: ${text}`)
    return match
  })
  await clickButton(button)
}

async function clickLastEnabledButtonContainingText(text: string) {
  const button = await waitFor(() => {
    const root = document.querySelector('[role="tabpanel"][data-state="active"]') ?? document
    const matches = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
      .filter((item) => item.textContent?.includes(text) && !item.disabled)
    const match = matches.at(-1)
    if (!match) throw new Error(`enabled button not found: ${text}`)
    return match
  })
  await clickButton(button)
}

async function clickButton(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    button.click()
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

function createPublicAsset(): AdminDrivePublicAssetRow {
  return {
    accessCount: '3',
    assetId: 'asset/id',
    createdAt: '2026-06-18T09:00:00.000Z',
    itemId: 'item-1',
    lastAccessedAt: '2026-06-18T10:00:00.000Z',
    lifecycleStatus: 'active',
    mimeType: 'image/png',
    name: 'logo.png',
    owner: {
      email: 'owner@example.com',
      userId: 'user-1',
    },
    responseBytes: '1536',
    size: '1024',
    updatedAt: '2026-06-18T09:30:00.000Z',
    url: 'https://assets.example/files/asset_1',
  }
}
