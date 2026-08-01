// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { ProfileSettings } from './profile-settings'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  dashboardApi: {
    getMe: vi.fn(),
    updateMe: vi.fn(),
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

  it('does not render a nickname field', async () => {
    mockedDashboardApi.getMe.mockResolvedValue(profile())

    renderProfileSettings()
    await waitFor(() => inputById('user-handle'))

    expect(document.getElementById('display-name')).toBeNull()
    expect(document.body.textContent).not.toContain('昵称')
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
    },
    teams: [],
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
