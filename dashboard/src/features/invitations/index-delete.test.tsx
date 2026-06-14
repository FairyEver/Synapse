// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/lib/api'
import InvitationsPage from './index'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  adminApi: {
    createInvitation: vi.fn(),
    deleteInvitation: vi.fn(),
    listInvitations: vi.fn(),
    listTeams: vi.fn(),
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

describe('InvitationsPage delete confirmation', () => {
  it('requires confirmation before deleting an invitation', async () => {
    mockedAdminApi.listInvitations.mockResolvedValue({
      data: [{
        id: 'inv-1',
        type: 'team_join',
        expiresAt: '2026-06-15T00:00:00.000Z',
        usedAt: null,
        createdByAdmin: { email: 'admin@example.com' },
        createdByUser: null,
        team: { name: 'Core Team' },
        acceptedByUser: null,
        createdAt: '2026-06-14T00:00:00.000Z',
      }],
      total: 1,
    })
    mockedAdminApi.deleteInvitation.mockResolvedValue(undefined)

    renderPage()
    const deleteButton = await waitFor(invitationDeleteButton)

    await click(deleteButton)

    expect(mockedAdminApi.deleteInvitation).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('删除邀请')

    await click(confirmDeleteButton())

    expect(mockedAdminApi.deleteInvitation).toHaveBeenCalled()
    expect(mockedAdminApi.deleteInvitation.mock.calls[0]?.[0]).toBe('inv-1')
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
        <InvitationsPage />
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

function invitationDeleteButton(): HTMLButtonElement {
  const button = document.querySelector('button[aria-label="删除 Core Team"]')
  if (!(button instanceof HTMLButtonElement)) throw new Error('delete button not found')
  return button
}

function confirmDeleteButton(): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll('button'))
  const button = buttons.find((item) => item.textContent === '删除' && !item.hasAttribute('aria-label'))
  if (!(button instanceof HTMLButtonElement)) throw new Error('confirm button not found')
  return button
}
