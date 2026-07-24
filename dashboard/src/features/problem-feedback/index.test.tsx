// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatExactDateTime } from '@/components/relative-time'
import { adminApi } from '@/lib/api'
import ProblemFeedbackPage from './index'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  adminApi: {
    deleteProblemFeedback: vi.fn(),
    listProblemFeedback: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}))

vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

const mockedAdminApi = vi.mocked(adminApi)
const content = [
  '场景：<script>synthetic()</script>',
  '实际情况：https://docs.example.invalid/plain-text',
].join('\n')
const id = '00112233-4455-4677-8899-aabbccddeeff'
let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('ProblemFeedbackPage', () => {
  it('uses the shared absolute time presentation for the received time', async () => {
    mockPage()
    renderPage()

    const time = await waitFor(() => {
      const candidate = document.querySelector('time')
      if (!(candidate instanceof HTMLTimeElement)) throw new Error('time not found')
      return candidate
    })

    expect(time.dateTime).toBe('2026-01-02T03:04:05.000Z')
    expect(time.textContent).toBe(
      formatExactDateTime(new Date('2026-01-02T03:04:05.000Z'))
    )
  })

  it('keeps the full body out of the table and renders it only as plain text in the Sheet', async () => {
    mockPage()
    renderPage()

    const view = await waitFor(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((candidate) => candidate.textContent === '查看')
      if (!(button instanceof HTMLButtonElement)) throw new Error('view button not found')
      return button
    })

    expect(document.body.textContent).not.toContain('plain-text')
    await click(view)
    expect(document.body.textContent).toContain(content)
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('a')).toBeNull()
  })

  it('requires explicit confirmation before one hard-delete request', async () => {
    mockPage()
    mockedAdminApi.deleteProblemFeedback.mockResolvedValue({ success: true })
    renderPage()
    const view = await waitFor(() => findButton('查看'))
    await click(view)
    await click(findButton('删除'))

    expect(mockedAdminApi.deleteProblemFeedback).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('删除后不可恢复。')

    const deleteButtons = Array.from(document.querySelectorAll('button'))
      .filter((candidate) => candidate.textContent === '删除')
    await click(deleteButtons.at(-1) as HTMLButtonElement)
    expect(mockedAdminApi.deleteProblemFeedback).toHaveBeenCalledOnce()
    expect(mockedAdminApi.deleteProblemFeedback.mock.calls[0]?.[0]).toBe(id)
  })
})

function mockPage() {
  mockedAdminApi.listProblemFeedback.mockResolvedValue({
    data: [{ id, content, receivedAt: '2026-01-02T03:04:05.000Z' }],
    total: 1,
    page: 1,
    pageSize: 10,
  })
}

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
        <ProblemFeedbackPage />
      </QueryClientProvider>
    )
  })
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} button not found`)
  return button
}

async function click(element: HTMLButtonElement) {
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
