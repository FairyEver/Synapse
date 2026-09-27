// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi } from '@/lib/api'
import WebhooksPage from './index'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  dashboardApi: { listWebhooks: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}))

vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/components/data-table', () => ({
  DEFAULT_DASHBOARD_PAGE_SIZE: 10,
  ServerDataTable: ({
    page,
    onPageChange,
  }: {
    page: number
    onPageChange: (page: number) => void
  }) => (
    <div data-page={page}>
      <button onClick={() => onPageChange(3)}>第三页</button>
    </div>
  ),
}))

vi.mock('./webhook-columns', () => ({ buildWebhookColumns: () => [] }))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  host?.remove()
  root = null
  host = null
  vi.clearAllMocks()
})

describe('WebhooksPage pagination', () => {
  it('keeps a later page while its request is pending', async () => {
    vi.mocked(dashboardApi.listWebhooks).mockImplementation(({ page }) => {
      if (page === 1) return Promise.resolve({ data: [], total: 30 })
      return new Promise(() => undefined)
    })

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <WebhooksPage />
        </QueryClientProvider>
      )
    })

    const nextPageButton = host.querySelector('button')
    expect(nextPageButton).not.toBeNull()
    await act(async () => {
      nextPageButton?.click()
    })

    expect(dashboardApi.listWebhooks).toHaveBeenCalledWith({ page: 3, pageSize: 10 })
    expect(host.querySelector('[data-page]')?.getAttribute('data-page')).toBe('3')
  })
})
