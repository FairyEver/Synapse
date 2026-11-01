// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi, type AdminUserRow, type TelemetryStats } from '@/lib/api'
import TelemetryPage from './index'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  adminApi: { getTelemetryStats: vi.fn(), listUsers: vi.fn() },
}))

const mockedApi = vi.mocked(adminApi)
const user: AdminUserRow = {
  id: 'user-1', email: 'alice@example.com', handle: 'alice', nickname: 'Alice',
  adminNote: null, status: 'active', teams: [],
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
}
const stats: TelemetryStats = {
  range: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', timezoneOffsetMinutes: 480, interval: 'day' },
  summary: { events: 0, authenticatedUsers: 0, anonymousClients: 0, sessions: 0, failures: 0, failureRate: 0, p95DurationMs: null },
  trend: [],
  dimensions: { modules: [], events: [], actions: [], outcomes: [], versions: [], platforms: [], browserNames: [], browserVersions: [], osNames: [], osVersions: [], windowTypes: [] },
  insights: {
    active: { dau: 0, wau: 0, mau: 0, stickiness: 0 },
    sessions: { averageDurationMs: null, p95DurationMs: null },
    identities: { new: 0, returning: 0 }, adoption: [], funnels: [], retention: [],
  },
  filterOptions: { modules: [], events: [], versions: [], platforms: [], browserNames: [], browserVersions: [], osNames: [], osVersions: [], windowTypes: [] },
}

let root: Root | null = null
let client: QueryClient | null = null

beforeEach(() => {
  mockedApi.getTelemetryStats.mockResolvedValue(stats)
  mockedApi.listUsers.mockResolvedValue({ data: [user], total: 1 })
})

afterEach(() => {
  act(() => root?.unmount())
  client?.clear()
  root = null
  client = null
  document.body.innerHTML = ''
  vi.resetAllMocks()
})

describe('Telemetry user filter', () => {
  it('applies a clicked user to the statistics query and closes the picker', async () => {
    renderPage()
    await selectUser()

    await waitFor(() => {
      expect(mockedApi.getTelemetryStats).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'user-1', identity: 'authenticated' }))
      expect(userFilter().textContent).toContain('alice')
      expect(userFilter().getAttribute('aria-expanded')).toBe('false')
    })
  })

  it('clears the selected user when clicking all users', async () => {
    renderPage()
    await selectUser()
    await waitFor(() => expect(userFilter().textContent).toContain('alice'))
    await click(userFilter())
    await click(option('__all__'))

    await waitFor(() => {
      expect(mockedApi.getTelemetryStats).toHaveBeenLastCalledWith(expect.objectContaining({ userId: undefined }))
      expect(userFilter().textContent).toContain('全部用户')
      expect(userFilter().getAttribute('aria-expanded')).toBe('false')
    })
  })

  it.each(['__all__', 'user-1'])('closes the picker when clicking the current selection (%s)', async (key) => {
    renderPage()
    if (key === 'user-1') {
      await selectUser()
      await waitFor(() => expect(userFilter().getAttribute('aria-expanded')).toBe('false'))
    }
    await click(userFilter())
    await waitFor(() => expect(option(key)).toBeTruthy())
    await click(option(key))

    await waitFor(() => expect(userFilter().getAttribute('aria-expanded')).toBe('false'))
    expect(userFilter().textContent).toContain(key === '__all__' ? '全部用户' : 'alice')
  })
})

function renderPage() {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => root?.render(<QueryClientProvider client={client!}><TelemetryPage /></QueryClientProvider>))
}

async function selectUser() {
  await click(userFilter())
  await waitFor(() => expect(option('user-1')).toBeTruthy())
  await click(option('user-1'))
}

function userFilter(): HTMLButtonElement {
  const button = document.querySelector('button[aria-label="用户筛选"]')
  if (!(button instanceof HTMLButtonElement)) throw new Error('User filter not found')
  return button
}

function option(key: string): HTMLElement {
  const item = document.querySelector(`[role="option"][data-key="${key}"]`)
  if (!(item instanceof HTMLElement)) throw new Error(`User option not found: ${key}`)
  return item
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

async function waitFor(read: () => void) {
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt++) {
    try { read(); return } catch (error) { lastError = error }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  throw lastError
}
