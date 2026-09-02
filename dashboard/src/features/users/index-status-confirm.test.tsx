// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/lib/api'
import UsersPage from './index'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  adminApi: {
    listLiveClients: vi.fn(),
    listUsers: vi.fn(),
    subscribeLiveClients: vi.fn(),
    createUserPasswordResetLink: vi.fn(),
    updateUserAdminNote: vi.fn(),
    updateUserStatus: vi.fn(),
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

describe('UsersPage status confirmation', () => {
  it('requires confirmation before disabling a user', async () => {
    mockedAdminApi.listUsers.mockResolvedValue({
      data: [{
        id: 'user-1',
        email: 'ada@example.com',
        handle: 'ada',
        adminNote: null,
        status: 'active',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      }],
      total: 1,
    })
    mockedAdminApi.listLiveClients.mockResolvedValue([])
    mockedAdminApi.subscribeLiveClients.mockReturnValue(() => {})
    mockedAdminApi.updateUserStatus.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      handle: 'ada',
      adminNote: null,
      status: 'disabled',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    })

    renderPage()
    const actionsButton = await waitFor(() => userActionsButton('ada@example.com'))

    await openMenu(actionsButton)
    await click(menuItemByText('禁用用户'))

    expect(mockedAdminApi.updateUserStatus).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('禁用用户')
    expect(document.body.textContent).toContain('ada@example.com 将被禁用，并断开桌面连接。')

    await click(buttonByText('取消'))

    expect(mockedAdminApi.updateUserStatus).not.toHaveBeenCalled()

    await openMenu(userActionsButton('ada@example.com'))
    await click(menuItemByText('禁用用户'))
    await click(dialogButtonByText('禁用'))

    expect(mockedAdminApi.updateUserStatus).toHaveBeenCalledWith('user-1', 'disabled')
  })

  it('shows handles and lets administrators edit user notes', async () => {
    mockedAdminApi.listUsers.mockResolvedValue({
      data: [{
        id: 'user-1',
        email: 'ada@example.com',
        handle: 'ada',
        adminNote: '付费客户',
        status: 'active',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      }],
      total: 1,
    })
    mockedAdminApi.listLiveClients.mockResolvedValue([])
    mockedAdminApi.subscribeLiveClients.mockReturnValue(() => {})
    mockedAdminApi.updateUserAdminNote.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      handle: 'ada',
      adminNote: '内部测试账号',
      status: 'active',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    })

    renderPage()

    await waitFor(() => {
      expect(document.body.textContent).toContain('ada')
      expect(document.body.textContent).toContain('付费客户')
    })

    await openMenu(userActionsButton('ada@example.com'))
    await click(menuItemByText('编辑备注'))
    const textarea = document.querySelector('textarea')
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('textarea not found')

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )?.set
      valueSetter?.call(textarea, ' 内部测试账号 ')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(dialogButtonByText('保存').disabled).toBe(false)
    })
    await click(dialogButtonByText('保存'))

    expect(mockedAdminApi.updateUserAdminNote).toHaveBeenCalledWith(
      'user-1',
      '内部测试账号'
    )
  })

  it('generates and copies password reset links for active users', async () => {
    mockedAdminApi.listUsers.mockResolvedValue({
      data: [{
        id: 'user-1',
        email: 'ada@example.com',
        handle: 'ada',
        adminNote: null,
        status: 'active',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      }],
      total: 1,
    })
    mockedAdminApi.listLiveClients.mockResolvedValue([])
    mockedAdminApi.subscribeLiveClients.mockReturnValue(() => {})
    mockedAdminApi.createUserPasswordResetLink.mockResolvedValue({
      ok: true,
      resetUrl: 'https://app.example.com/console/reset-password?token=reset-token',
      expiresAt: '2026-09-02T02:30:00.000Z',
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    renderPage()
    await waitFor(() => userActionsButton('ada@example.com'))
    await openMenu(userActionsButton('ada@example.com'))
    await click(menuItemByText('生成重置链接'))

    expect(document.body.textContent).toContain('生成重置链接')
    expect(document.body.textContent).toContain('30 分钟后失效')
    await click(dialogButtonByText('生成链接'))

    await waitFor(() => {
      expect(mockedAdminApi.createUserPasswordResetLink).toHaveBeenCalledWith('user-1')
      expect(document.body.textContent).toContain('重置链接已生成')
    })
    const input = document.querySelector('#password-reset-link')
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect((input as HTMLInputElement).value).toContain('token=reset-token')

    await click(dialogButtonByText('复制链接'))
    expect(writeText).toHaveBeenCalledWith(
      'https://app.example.com/console/reset-password?token=reset-token'
    )
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
        <UsersPage />
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

function userActionsButton(email: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label="${email} 的用户操作"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${email} actions button not found`)
  return button
}

function menuItemByText(text: string): HTMLElement {
  const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find((element) => element.textContent === text)
  if (!(item instanceof HTMLElement)) throw new Error(`${text} menu item not found`)
  return item
}

async function openMenu(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      ctrlKey: false,
    }))
    await Promise.resolve()
  })
}

function dialogButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent === text && !item.closest('table'))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} dialog button not found`)
  return button
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}
