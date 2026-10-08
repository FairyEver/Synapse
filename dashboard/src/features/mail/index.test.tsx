// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/lib/api'
import MailPage from './index'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  adminApi: {
    getMailMessage: vi.fn(),
    listMailContext: vi.fn(),
    listMailMessages: vi.fn(),
    listTeams: vi.fn(),
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
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('MailPage', () => {
  it('keeps message bodies out of the table and renders them as plain text in the detail sheet', async () => {
    mockedAdminApi.listMailMessages.mockResolvedValue({
      data: [{
        messageId: 'mail-1', kind: 'user', sender: { userId: 'user-1', email: 'ada@example.com', handle: 'ada', nickname: 'Ada' },
        toAddresses: [{ kind: 'user', userId: 'user-2', name: 'Bob' }], ccAddresses: [], subject: '主题', snippet: '摘要',
        sentAt: '2026-10-01T00:00:00.000Z', conversationId: 'conversation-1', relationKind: null, replyToId: null, forwardOfId: null,
        team: { id: 'team-1', name: '平台团队' }, recipientCount: 1, attachmentCount: 0, senderDeletedAt: null,
      }], total: 1, page: 1, pageSize: 20,
    })
    mockedAdminApi.getMailMessage.mockResolvedValue({
      messageId: 'mail-1', kind: 'user', sender: { userId: 'user-1', email: 'ada@example.com', handle: 'ada', nickname: 'Ada' },
      toAddresses: [{ kind: 'user', userId: 'user-2', name: 'Bob' }], ccAddresses: [], subject: '主题', snippet: '正文',
      sentAt: '2026-10-01T00:00:00.000Z', conversationId: 'conversation-1', relationKind: null, replyToId: null, forwardOfId: null, team: { id: 'team-1', name: '平台团队' },
      recipientCount: 1, attachmentCount: 0, senderDeletedAt: null, body: '正文 <script>bad()</script>\n下一行', replyToId: null, forwardOfId: null, quote: null,
      attachments: [], delivery: { recipientCount: 1, readCount: 0, deletedCount: 0, pendingCount: 1 },
    })
    mockedAdminApi.listMailContext.mockResolvedValue({ items: [], nextCursor: null })
    mockedAdminApi.listTeams.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 })
    renderPage()

    const view = await waitFor(() => findButton('查看'))
    expect(document.body.textContent).not.toContain('正文 <script>')
    await click(view)
    await waitFor(() => expect(document.body.textContent).toContain('正文 <script>bad()</script>'))
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('a')).toBeNull()
    expect(mockedAdminApi.listMailContext).toHaveBeenCalledWith('mail-1', undefined)
  })
})

function renderPage() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => {
    root?.render(<QueryClientProvider client={queryClient}><MailPage search={{}} /></QueryClientProvider>)
  })
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent === label)
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
    try { return read() }
    catch (error) {
      lastError = error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    }
  }
  throw lastError
}
