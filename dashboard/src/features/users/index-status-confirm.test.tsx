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
    exportUsers: vi.fn(),
    subscribeLiveClients: vi.fn(),
    createUserPasswordResetLink: vi.fn(),
    updateUserAdminNote: vi.fn(),
    updateUserNickname: vi.fn(),
    updateUserHandle: vi.fn(),
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
  it('exports all users from the toolbar', async () => {
    mockedAdminApi.listUsers.mockResolvedValue({ data: [], total: 0 })
    mockedAdminApi.listLiveClients.mockResolvedValue([])
    mockedAdminApi.subscribeLiveClients.mockReturnValue(() => {})
    mockedAdminApi.exportUsers.mockResolvedValue(undefined)

    renderPage()
    await click(buttonByText('导出'))

    expect(mockedAdminApi.exportUsers).toHaveBeenCalledOnce()
  })


  it('passes all fuzzy user filters to the users query', async () => {
    vi.useFakeTimers()
    try {
      mockedAdminApi.listUsers.mockResolvedValue({ data: [], total: 0 })
      mockedAdminApi.listLiveClients.mockResolvedValue([])
      mockedAdminApi.subscribeLiveClients.mockReturnValue(() => {})

      renderPage()
      const emailInput = document.querySelector('input[aria-label="按邮箱搜索"]')
      const handleInput = document.querySelector('input[aria-label="按用户名搜索"]')
      const nicknameInput = document.querySelector('input[aria-label="按昵称搜索"]')
      if (!(emailInput instanceof HTMLInputElement)) throw new Error('email search input not found')
      if (!(handleInput instanceof HTMLInputElement)) throw new Error('handle search input not found')
      if (!(nicknameInput instanceof HTMLInputElement)) throw new Error('nickname search input not found')

      await inputValue(emailInput, 'ada@')
      await inputValue(handleInput, 'ali')
      await inputValue(nicknameInput, '小明')
      await act(async () => {
        vi.advanceTimersByTime(300)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mockedAdminApi.listUsers).toHaveBeenCalledWith(expect.objectContaining({
        email: 'ada@',
        handle: 'ali',
        nickname: '小明',
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an open user menu when live client status changes', async () => {
    mockedAdminApi.listUsers.mockResolvedValue({
      data: [{
        id: 'user-1',
        email: 'ada@example.com',
        handle: 'ada',
        nickname: 'Ada',
        adminNote: null,
        status: 'active',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
        teams: [],
      }],
      total: 1,
    })
    mockedAdminApi.listLiveClients.mockResolvedValue([])
    let onLiveClientChanged: Parameters<typeof adminApi.subscribeLiveClients>[0] | null = null
    mockedAdminApi.subscribeLiveClients.mockImplementation((onEvent) => {
      onLiveClientChanged = onEvent
      return () => {}
    })

    renderPage()
    await waitFor(() => expect(cellByHeader('ada@example.com', '客户端').textContent).toContain('离线'))
    await openMenu(userActionsButton('ada@example.com'))
    expect(menuItemByText('编辑昵称')).toBeTruthy()

    if (!onLiveClientChanged) throw new Error('live client subscription not found')
    await act(async () => {
      onLiveClientChanged?.({
        type: 'live.client.changed',
        occurredAt: '2026-06-14T00:01:00.000Z',
        client: {
          userId: 'user-1',
          clientInstanceId: 'client-1',
          status: 'online',
          appVersion: '1.0.0',
          platform: 'macos',
          deviceName: 'Mac',
          connectedAt: '2026-06-14T00:01:00.000Z',
          lastSeenAt: '2026-06-14T00:01:00.000Z',
        },
      })
    })

    expect(cellByHeader('ada@example.com', '客户端').textContent).toContain('1 台在线')
    await click(menuItemByText('编辑昵称'))
    expect(document.querySelector('#user-nickname')).toBeInstanceOf(HTMLInputElement)
  })

  it('requires confirmation before disabling a user', async () => {
    mockedAdminApi.listUsers.mockResolvedValue({
      data: [{
        id: 'user-1',
        email: 'ada@example.com',
        handle: 'ada',
        nickname: 'Ada',
        adminNote: null,
        status: 'active',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
        teams: [],
      }],
      total: 1,
    })
    mockedAdminApi.listLiveClients.mockResolvedValue([])
    mockedAdminApi.subscribeLiveClients.mockReturnValue(() => {})
    mockedAdminApi.updateUserStatus.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      handle: 'ada',
      nickname: 'Ada',
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
        nickname: 'Ada',
        adminNote: '付费客户',
        status: 'active',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
        teams: [],
      }],
      total: 1,
    })
    mockedAdminApi.listLiveClients.mockResolvedValue([])
    mockedAdminApi.subscribeLiveClients.mockReturnValue(() => {})
    mockedAdminApi.updateUserAdminNote.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      handle: 'ada',
      nickname: 'Ada',
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

  it('shows and edits user nicknames with shared validation', async () => {
    const user = {
      id: 'user-1',
      email: 'ada@example.com',
      handle: 'ada',
      nickname: 'Ada',
      adminNote: null,
      status: 'active' as const,
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
      teams: [],
    }
    mockedAdminApi.listUsers
      .mockResolvedValueOnce({ data: [user], total: 1 })
      .mockResolvedValue({ data: [{ ...user, nickname: '李 阳' }], total: 1 })
    mockedAdminApi.listLiveClients.mockResolvedValue([])
    mockedAdminApi.subscribeLiveClients.mockReturnValue(() => {})
    mockedAdminApi.updateUserNickname.mockResolvedValue({ ...user, nickname: '李 阳' })

    renderPage()
    const nicknameCell = await waitFor(() => cellByHeader('ada@example.com', '昵称'))
    expect(nicknameCell.textContent).toBe('Ada')
    const nicknameText = nicknameCell.firstElementChild
    if (!(nicknameText instanceof HTMLElement)) throw new Error('nickname text not found')
    await click(nicknameText)
    expect(document.querySelector('#user-nickname')).toBeNull()
    await act(async () => {
      nicknameText.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    const input = document.querySelector('#user-nickname')
    if (!(input instanceof HTMLInputElement)) throw new Error('nickname input not found')
    await inputValue(input, '   ')
    expect(document.body.textContent).toContain('昵称不能为空。')
    expect(dialogButtonByText('保存').disabled).toBe(true)

    await inputValue(input, ' 李 阳 ')
    expect(dialogButtonByText('保存').disabled).toBe(false)
    await click(dialogButtonByText('保存'))
    expect(mockedAdminApi.updateUserNickname).toHaveBeenCalledWith('user-1', '李 阳')
    await waitFor(() => expect(cellByHeader('ada@example.com', '昵称').textContent).toBe('李 阳'))
  })

  it('edits usernames with shared validation', async () => {
    const user = {
      id: 'user-1',
      email: 'ada@example.com',
      handle: 'ada',
      nickname: 'Ada',
      adminNote: null,
      status: 'active' as const,
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
      teams: [],
    }
    mockedAdminApi.listUsers.mockResolvedValue({ data: [user], total: 1 })
    mockedAdminApi.listLiveClients.mockResolvedValue([])
    mockedAdminApi.subscribeLiveClients.mockReturnValue(() => {})
    mockedAdminApi.updateUserHandle.mockResolvedValue({ ...user, handle: 'new-name' })

    renderPage()
    await waitFor(() => userActionsButton('ada@example.com'))
    await openMenu(userActionsButton('ada@example.com'))
    await click(menuItemByText('编辑用户名'))

    const input = document.querySelector('#user-handle')
    if (!(input instanceof HTMLInputElement)) throw new Error('handle input not found')
    await inputValue(input, 'bad.name')
    expect(document.body.textContent).toContain('用户名不能包含点。')
    expect(dialogButtonByText('保存').disabled).toBe(true)

    await inputValue(input, ' New-Name ')
    expect(dialogButtonByText('保存').disabled).toBe(false)
    await click(dialogButtonByText('保存'))
    expect(mockedAdminApi.updateUserHandle).toHaveBeenCalledWith('user-1', 'new-name')
  })

  it('generates and copies password reset links for active users', async () => {
    mockedAdminApi.listUsers.mockResolvedValue({
      data: [{
        id: 'user-1',
        email: 'ada@example.com',
        handle: 'ada',
        nickname: 'Ada',
        adminNote: null,
        status: 'active',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
        teams: [],
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
  it('lists the teams each user belongs to', async () => {
    mockedAdminApi.listUsers.mockResolvedValue({
      data: [
        {
          id: 'user-1',
          email: 'ada@example.com',
          handle: 'ada',
          nickname: 'Ada',
          adminNote: null,
          status: 'active',
          createdAt: '2026-06-14T00:00:00.000Z',
          updatedAt: '2026-06-14T00:00:00.000Z',
          teams: [
            { id: 'team-1', name: '产品组' },
            { id: 'team-2', name: '研发组' },
          ],
        },
        {
          id: 'user-2',
          email: 'bob@example.com',
          handle: 'bob',
          nickname: 'Bob',
          adminNote: null,
          status: 'active',
          createdAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
          teams: [],
        },
      ],
      total: 2,
    })
    mockedAdminApi.listLiveClients.mockResolvedValue([])
    mockedAdminApi.subscribeLiveClients.mockReturnValue(() => {})

    renderPage()

    await waitFor(() => {
      expect(document.body.textContent).toContain('产品组')
    })
    expect(cellByHeader('ada@example.com', '团队').textContent).toContain('产品组')
    expect(cellByHeader('ada@example.com', '团队').textContent).toContain('研发组')
    expect(cellByHeader('bob@example.com', '团队').textContent).toBe('-')
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

async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
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

function rowByEmail(email: string): HTMLTableRowElement {
  const row = Array.from(document.querySelectorAll('tbody tr'))
    .find((element) => element.textContent?.includes(email))
  if (!(row instanceof HTMLTableRowElement)) throw new Error(`${email} row not found`)
  return row
}

function cellByHeader(email: string, header: string): HTMLTableCellElement {
  const headers = Array.from(document.querySelectorAll('thead th'))
  const index = headers.findIndex((element) => element.textContent?.trim() === header)
  if (index < 0) throw new Error(`${header} column not found`)
  const cell = rowByEmail(email).querySelectorAll('td')[index]
  if (!(cell instanceof HTMLTableCellElement)) throw new Error(`${header} cell not found`)
  return cell
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}
