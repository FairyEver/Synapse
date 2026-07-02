// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi } from '@/lib/api'
import MyContentListPage from './my-content-list'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

vi.mock('@/lib/api', () => ({
  dashboardApi: {
    migrateLegacyContentStoreSkills: vi.fn(),
  },
}))

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}))

vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

const mockedDashboardApi = vi.mocked(dashboardApi)

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

describe('MyContentListPage legacy migration action', () => {
  it('migrates legacy Skills and shows the migration summary', async () => {
    mockedDashboardApi.migrateLegacyContentStoreSkills.mockResolvedValue({
      scanned: 3,
      migrated: 1,
      alreadyMigrated: 1,
      skipped: [],
      warnings: [],
    })

    renderPage()
    await click(buttonByText('迁移旧 Skill'))

    expect(mockedDashboardApi.migrateLegacyContentStoreSkills).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(document.body.textContent).toContain('已扫描 3 项，迁移 1 项，已迁移 1 项。')
    })
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
        <MyContentListPage />
      </QueryClientProvider>
    )
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

async function waitFor(read: () => void): Promise<void> {
  let lastError: unknown
  for (let index = 0; index < 10; index += 1) {
    try {
      read()
      return
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
