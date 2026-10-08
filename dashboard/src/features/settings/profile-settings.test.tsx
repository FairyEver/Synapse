// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userNicknameMaxLength } from '@synapse/shared'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { ProfileSettings } from './profile-settings'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  dashboardApi: {
    getMe: vi.fn(),
    updateMe: vi.fn(),
    createMyPasswordResetLink: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
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
  useAuthStore.getState().auth.reset()
  vi.clearAllMocks()
})

describe('ProfileSettings', () => {
  it('saves a normalized username', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())
    mockedDashboardApi.updateMe.mockResolvedValue(profile({
      user: { ...profile().user, handle: 'new-name' },
    }))

    renderProfileSettings()
    await waitFor(() => inputById('user-handle'))

    await inputValue(inputById('user-handle'), ' New-Name ')
    await click(saveButton())

    await waitFor(() => {
      expect(mockedDashboardApi.updateMe.mock.calls[0]?.[0]).toEqual({
        handle: 'new-name',
      })
    })
  })

  it('blocks handles with dots', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())

    renderProfileSettings()
    await waitFor(() => inputById('user-handle'))

    await inputValue(inputById('user-handle'), 'bad.name')

    expect(saveButton().disabled).toBe(true)
    expect(document.body.textContent).toContain('只能使用小写字母、数字和连字符，并以字母或数字开头和结尾。')
  })

  it('renders the saved nickname', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())

    renderProfileSettings()
    await waitFor(() => inputById('user-nickname'))

    expect(inputById('user-nickname').value).toBe('liyang')
  })

  it('saves a nickname change', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())
    mockedDashboardApi.updateMe.mockResolvedValue(profile({
      user: { ...profile().user, nickname: '李 阳' },
    }))

    renderProfileSettings()
    await waitFor(() => inputById('user-nickname'))

    await inputValue(inputById('user-nickname'), ' 李 阳 ')
    await click(saveButton())

    await waitFor(() => {
      expect(mockedDashboardApi.updateMe.mock.calls[0]?.[0]).toEqual({
        nickname: '李 阳',
      })
    })
  })

  it('submits the username and nickname together when both change', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())
    mockedDashboardApi.updateMe.mockResolvedValue(profile({
      user: { ...profile().user, handle: 'new-name', nickname: '李 阳' },
    }))

    renderProfileSettings()
    await waitFor(() => inputById('user-handle'))

    await inputValue(inputById('user-handle'), 'New-Name')
    await inputValue(inputById('user-nickname'), '李 阳')
    await click(saveButton())

    await waitFor(() => {
      expect(mockedDashboardApi.updateMe.mock.calls[0]?.[0]).toEqual({
        handle: 'new-name',
        nickname: '李 阳',
      })
    })
  })

  it('blocks an empty nickname', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())

    renderProfileSettings()
    await waitFor(() => inputById('user-nickname'))

    await inputValue(inputById('user-nickname'), '   ')

    expect(saveButton().disabled).toBe(true)
    expect(document.body.textContent).toContain('昵称不能为空。')
  })

  it('keeps a cleared nickname silent while the save button stays disabled', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())

    renderProfileSettings()
    await waitFor(() => inputById('user-nickname'))

    await inputValue(inputById('user-nickname'), '')

    expect(saveButton().disabled).toBe(true)
    expect(document.body.textContent).not.toContain('昵称不能为空。')
  })

  it('blocks nicknames over the shared limit by code point', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())

    renderProfileSettings()
    await waitFor(() => inputById('user-nickname'))

    await inputValue(inputById('user-nickname'), '名'.repeat(userNicknameMaxLength + 1))

    expect(saveButton().disabled).toBe(true)
    expect(document.body.textContent).toContain('昵称不能超过 24 个字符。')
  })

  it('blocks reserved route handles', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())

    renderProfileSettings()
    await waitFor(() => inputById('user-handle'))

    await inputValue(inputById('user-handle'), 'console')

    expect(saveButton().disabled).toBe(true)
    expect(document.body.textContent).toContain('该用户名不可用。')
  })

  it('blocks Windows-reserved handles', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())

    renderProfileSettings()
    await waitFor(() => inputById('user-handle'))

    await inputValue(inputById('user-handle'), 'con')

    expect(saveButton().disabled).toBe(true)
    expect(document.body.textContent).toContain('该用户名不可用。')
  })

  it('generates, copies, and clears a password reset link', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())
    mockedDashboardApi.createMyPasswordResetLink.mockResolvedValue({
      ok: true,
      resetUrl: 'https://app.example.com/console/reset-password?token=reset-token',
      expiresAt: '2026-09-02T01:30:00.000Z',
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    renderProfileSettings()
    await waitFor(() => inputById('user-handle'))
    await click(buttonByText('生成重置链接'))

    await waitFor(() => {
      expect(mockedDashboardApi.createMyPasswordResetLink).toHaveBeenCalledOnce()
      expect(inputById('password-reset-link').value).toContain('token=reset-token')
    })
    await click(buttonByText('复制链接'))
    expect(writeText).toHaveBeenCalledWith(
      'https://app.example.com/console/reset-password?token=reset-token'
    )
    await click(buttonByText('关闭'))
    expect(document.getElementById('password-reset-link')).toBeNull()
  })

  it('shows a generation error without leaving a reset link visible', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())
    mockedDashboardApi.createMyPasswordResetLink.mockRejectedValue(new Error('请求失败'))

    renderProfileSettings()
    await waitFor(() => inputById('user-handle'))
    await click(buttonByText('生成重置链接'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('请求失败'))
    expect(document.getElementById('password-reset-link')).toBeNull()
  })
})

function renderProfileSettings() {
  useAuthStore.getState().auth.setUser({
    email: 'u@example.test',
    handle: 'liyang',
    sessionId: 'session-1',
  })

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
        <ProfileSettings />
      </QueryClientProvider>
    )
  })
}

function profile(overrides: Partial<Awaited<ReturnType<typeof dashboardApi.getMe>>> = {}) {
  return {
    user: {
      id: 'user-1',
      email: 'u@example.test',
      status: 'active' as const,
      handle: 'liyang',
      nickname: 'liyang',
    },
    ...overrides,
  }
}

async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
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

function inputById(id: string): HTMLInputElement {
  const input = document.getElementById(id)
  if (!(input instanceof HTMLInputElement)) throw new Error(`${id} input not found`)
  return input
}

function saveButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent === '保存')
  if (!(button instanceof HTMLButtonElement)) throw new Error('save button not found')
  return button
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent?.trim() === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}
