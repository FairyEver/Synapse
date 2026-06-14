// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ContentStoreItemDto } from '@synapse/shared'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/lib/api'
import ContentStoreAdminPage from './content-store-admin'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  adminApi: {
    getContentStoreDetail: vi.fn(),
    listContentStoreItems: vi.fn(),
    setContentStoreFeatured: vi.fn(),
    setContentStoreRemoved: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}))

vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/components/data-table', () => ({
  DEFAULT_DASHBOARD_PAGE_SIZE: 10,
  DataTableColumnHeader: ({ title }: { title: string }) => <span>{title}</span>,
  ServerDataTable: ({ columns, data }: { columns: Array<{ id?: string; cell?: (context: unknown) => ReactNode }>; data: ContentStoreItemDto[] }) => (
    <div>
      {data.map((item) => (
        <div key={item.id}>
          {columns
            .filter((column) => column.id === 'actions' && column.cell)
            .map((column) => (
              <div key={column.id}>{column.cell?.({ row: { original: item } })}</div>
            ))}
        </div>
      ))}
    </div>
  ),
  getServerTableSortQuery: () => ({}),
}))

const mockedAdminApi = vi.mocked(adminApi)

let root: Root | null = null
let host: HTMLDivElement | null = null

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

describe('ContentStoreAdminPage remove action', () => {
  it('requires confirmation before removing public content', async () => {
    mockedAdminApi.listContentStoreItems.mockResolvedValue({
      data: [contentItem()],
      total: 1,
    })
    mockedAdminApi.setContentStoreRemoved.mockResolvedValue(contentItem({
      moderationStatus: 'removed',
    }))

    renderPage()
    const removeButton = await waitFor(() => buttonByText('下架'))

    await click(removeButton)

    expect(mockedAdminApi.setContentStoreRemoved).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Deploy Helper 将从公开内容商店移除。')

    await click(lastButtonByText('下架'))

    expect(mockedAdminApi.setContentStoreRemoved).toHaveBeenCalledWith('content-1', true)
  })
})

function renderPage() {
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
        <ContentStoreAdminPage />
      </QueryClientProvider>
    )
  })
}

function contentItem(overrides: Partial<ContentStoreItemDto> = {}): ContentStoreItemDto {
  return {
    id: 'content-1',
    type: 'skill',
    title: 'Deploy Helper',
    description: 'Deploy helper',
    visibility: 'public',
    moderationStatus: 'normal',
    featured: false,
    owner: { id: 'owner-1', displayName: 'Ada' },
    latestVersionId: 'version-1',
    latestVersionNumber: 1,
    installCount: 0,
    copiedFromContentId: null,
    copiedFromVersionId: null,
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  }
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

async function waitFor<T>(read: () => T): Promise<T> {
  let lastError: unknown
  for (let index = 0; index < 10; index += 1) {
    try {
      return read()
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
  throw lastError
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}

function lastButtonByText(text: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll('button'))
    .filter((item) => item.textContent === text)
  const button = buttons.at(-1)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}
