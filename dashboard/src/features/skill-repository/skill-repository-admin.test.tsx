// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi, type AdminSkillRepositoryRow } from '@/lib/api'
import SkillRepositoryAdminPage from './skill-repository-admin'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    Link: ({ children, params }: { readonly children: ReactNode; readonly params?: Record<string, string> }) => (
      <a href={`/skills/${params?.ownerHandle ?? ''}/${params?.repositoryName ?? ''}`}>
        {children}
      </a>
    ),
  }
})

vi.mock('@/lib/api', () => ({
  adminApi: {
    listSkillRepositories: vi.fn(),
    restoreSkillRepository: vi.fn(),
    setSkillRepositoryRemoved: vi.fn(),
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
  ServerDataTable: ({
    columns,
    data,
    toolbar,
  }: {
    readonly columns: Array<{ id?: string; accessorKey?: string; cell?: (context: unknown) => ReactNode }>
    readonly data: AdminSkillRepositoryRow[]
    readonly toolbar?: ReactNode
  }) => (
    <div>
      {toolbar}
      {data.map((item) => (
        <div key={item.id}>
          <span>{item.title}</span>
          <span>{item.name}</span>
          {columns
            .filter((column) => column.id === 'actions' && column.cell)
            .map((column) => (
              <div key={column.id}>{column.cell?.({ row: { original: item } })}</div>
            ))}
        </div>
      ))}
    </div>
  ),
  getServerTableSortQuery: () => ({ sortBy: 'updatedAt', sortOrder: 'desc' }),
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

describe('SkillRepositoryAdminPage', () => {
  it('lists repositories and opens public repository links', async () => {
    mockedAdminApi.listSkillRepositories.mockResolvedValue({
      data: [repositoryRow()],
      page: 1,
      pageSize: 10,
      total: 1,
    })

    renderPage()

    await waitForText('Deploy Helper')
    expect(mockedAdminApi.listSkillRepositories).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      status: 'active',
      query: undefined,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    })
    expect(document.querySelector('a[href="/skills/alice/deploy-helper"]')?.textContent).toContain('打开')
  })

  it('requires confirmation before removing a repository', async () => {
    mockedAdminApi.listSkillRepositories.mockResolvedValue({
      data: [repositoryRow()],
      page: 1,
      pageSize: 10,
      total: 1,
    })
    mockedAdminApi.setSkillRepositoryRemoved.mockResolvedValue(repositoryRow({ status: 'removed' }))

    renderPage()
    await click(await waitForButton('移除'))

    expect(mockedAdminApi.setSkillRepositoryRemoved).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Deploy Helper 将从公开列表移除。')

    await click(lastButtonByText('移除'))

    expect(mockedAdminApi.setSkillRepositoryRemoved).toHaveBeenCalledWith('repo-1')
  })

  it('restores removed repositories without a confirmation dialog', async () => {
    mockedAdminApi.listSkillRepositories.mockResolvedValue({
      data: [repositoryRow({ status: 'removed' })],
      page: 1,
      pageSize: 10,
      total: 1,
    })
    mockedAdminApi.restoreSkillRepository.mockResolvedValue(repositoryRow())

    renderPage({ search: { status: 'removed' } })
    await click(await waitForButton('恢复'))

    expect(mockedAdminApi.restoreSkillRepository).toHaveBeenCalledWith('repo-1')
  })
})

function renderPage(props: { readonly search?: Record<string, unknown> } = {}) {
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
        <SkillRepositoryAdminPage search={props.search} />
      </QueryClientProvider>
    )
  })
}

function repositoryRow(overrides: Partial<AdminSkillRepositoryRow> = {}): AdminSkillRepositoryRow {
  return {
    id: 'repo-1',
    name: 'deploy-helper',
    title: 'Deploy Helper',
    visibility: 'public',
    status: 'active',
    owner: { id: 'user-1', handle: 'alice' },
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

async function waitForText(text: string): Promise<void> {
  await waitFor(() => {
    expect(document.body.textContent).toContain(text)
  })
}

async function waitForButton(text: string): Promise<HTMLButtonElement> {
  return waitFor(() => buttonByText(text))
}

async function waitFor<T>(read: () => T): Promise<T> {
  let lastError: unknown
  for (let index = 0; index < 20; index += 1) {
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
    .find((item) => item.textContent?.trim() === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}

function lastButtonByText(text: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll('button'))
    .filter((item) => item.textContent?.trim() === text)
  const button = buttons.at(-1)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}
