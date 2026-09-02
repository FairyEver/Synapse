// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userAuthApi } from '@/lib/api'
import { ResetPassword } from './index'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...props}>{children}</a>
  ),
  useSearch: () => ({ token: 'reset-token', redirect: undefined }),
}))

vi.mock('@/lib/api', () => ({
  userAuthApi: {
    validatePasswordResetToken: vi.fn(),
    resetPassword: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const mockedUserAuthApi = vi.mocked(userAuthApi)
let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('ResetPassword', () => {
  it('shows the reset form only after token validation succeeds', async () => {
    mockedUserAuthApi.validatePasswordResetToken.mockResolvedValue({
      valid: true,
      expiresAt: '2026-09-02T02:30:00.000Z',
    })

    renderPage()

    await waitFor(() => {
      expect(document.body.textContent).toContain('新密码')
      expect(document.body.textContent).toContain('确认密码')
    })
  })

  it('directs users to the administrator when the token is invalid', async () => {
    mockedUserAuthApi.validatePasswordResetToken.mockResolvedValue({ valid: false })

    renderPage()

    await waitFor(() => {
      expect(document.body.textContent).toContain('链接已失效')
      expect(document.body.textContent).toContain('请联系管理员重新生成重置链接。')
      expect(document.body.textContent).not.toContain('重新获取链接')
    })
  })
})

function renderPage() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <ResetPassword />
      </QueryClientProvider>
    )
  })
}

async function waitFor(read: () => void) {
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
