// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { AdminAccessPage } from './index'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setSession: vi.fn(),
  unlock: vi.fn(),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      unlock: mocks.unlock,
    },
  }
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/features/auth/auth-layout', () => ({
  AuthLayout: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/stores/admin-auth-store', () => ({
  useAdminAuthStore: (selector: (state: unknown) => unknown) => selector({
    auth: { setSession: mocks.setSession },
  }),
}))

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
  mocks.unlock.mockReset()
})

describe('AdminAccessPage', () => {
  it('unlocks the admin session and navigates to the requested page', async () => {
    const session = {
      actorLabel: '平台管理员' as const,
      sessionId: 'admin-session-1',
      expiresAt: '2026-08-09T20:00:00.000Z',
    }
    mocks.unlock.mockResolvedValue(session)

    renderPage('/audit-logs')
    await fillAndSubmit('valid-secret')

    await waitFor(() => {
      expect(mocks.setSession).toHaveBeenCalledWith(session)
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/audit-logs',
        replace: true,
      })
    })
  })

  it('keeps invalid secrets as a field error', async () => {
    mocks.unlock.mockRejectedValue(new ApiError('密钥无效。', 401))

    renderPage()
    await fillAndSubmit('wrong-secret')

    await waitFor(() => {
      expect(document.body.textContent).toContain('密钥无效')
      expect(secretInput().value).toBe('')
    })
  })

  it.each([
    {
      name: 'trusted Origin failures',
      error: new ApiError('请求来源无效。', 403),
      message: '请求来源无效，请检查管理后台地址或代理配置。',
    },
    {
      name: 'authentication service failures',
      error: new ApiError('认证服务暂时不可用，请稍后重试。', 503),
      message: '认证服务暂时不可用，请稍后重试。',
    },
    {
      name: 'network failures',
      error: new TypeError('Failed to fetch'),
      message: '无法连接认证服务，请检查网络后重试。',
    },
  ])('shows $name separately from invalid secrets', async ({ error, message }) => {
    mocks.unlock.mockRejectedValue(error)

    renderPage()
    await fillAndSubmit('valid-secret')

    await waitFor(() => {
      expect(document.body.textContent).toContain(message)
      expect(document.body.textContent).not.toContain('密钥无效')
      expect(secretInput().value).toBe('')
    })
  })
})

function renderPage(redirectTo?: string) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  act(() => {
    root?.render(<AdminAccessPage redirectTo={redirectTo} />)
  })
}

async function fillAndSubmit(value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    valueSetter?.call(secretInput(), value)
    secretInput().dispatchEvent(new Event('input', { bubbles: true }))
    secretInput().dispatchEvent(new Event('change', { bubbles: true }))
    submitButton().click()
    await Promise.resolve()
  })
}

async function waitFor(assertion: () => void) {
  let lastError: unknown
  for (let index = 0; index < 10; index += 1) {
    try {
      assertion()
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

function secretInput(): HTMLInputElement {
  const input = document.querySelector('input[name="accessSecret"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('access secret input not found')
  return input
}

function submitButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent?.includes('进入管理界面'))
  if (!(button instanceof HTMLButtonElement)) throw new Error('submit button not found')
  return button
}
