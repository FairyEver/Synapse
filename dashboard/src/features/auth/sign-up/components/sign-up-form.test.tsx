// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, userAuthApi } from '@/lib/api'
import { toast } from 'sonner'
import { SignUpForm } from './sign-up-form'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    userAuthApi: {
      register: vi.fn(),
    },
  }
})

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { readonly children: ReactNode; readonly to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const mockedUserAuthApi = vi.mocked(userAuthApi)
const mockedToast = vi.mocked(toast)

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

describe('SignUpForm', () => {
  it('submits the username during registration', async () => {
    mockedUserAuthApi.register.mockResolvedValue({ ok: true })

    renderForm()
    await fillValidForm()
    await submitForm()

    await waitFor(() => {
      expect(mockedUserAuthApi.register).toHaveBeenCalledWith({
        email: 'user@example.com',
        handle: 'liyang',
        password: 'StrongPassword123!',
      })
    })
  })

  it('requires a username', async () => {
    renderForm()
    await inputValue(inputByName('email'), 'user@example.com')
    await inputValue(inputByName('password'), 'StrongPassword123!')
    await inputValue(inputByName('confirmPassword'), 'StrongPassword123!')
    await inputValue(inputByName('handle'), '')
    await submitForm()

    expect(mockedUserAuthApi.register).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请输入用户名')
  })

  it('shows duplicate email errors on the email field without a toast', async () => {
    mockedUserAuthApi.register.mockRejectedValue(new ApiError('邮箱已注册。', 400))

    renderForm()
    await fillValidForm()
    await submitForm()

    await waitFor(() => {
      expect(document.body.textContent).toContain('邮箱已注册。')
    })
    expect(mockedToast.error).not.toHaveBeenCalled()
  })

  it('keeps generic registration failures in the toast', async () => {
    mockedUserAuthApi.register.mockRejectedValue(new Error('注册服务暂不可用'))

    renderForm()
    await fillValidForm()
    await submitForm()

    await waitFor(() => {
      expect(mockedToast.error).toHaveBeenCalledWith('注册服务暂不可用')
    })
    expect(document.body.textContent).not.toContain('邮箱已注册。')
  })
})

function renderForm() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  act(() => {
    root?.render(<SignUpForm />)
  })
}

async function fillValidForm() {
  await inputValue(inputByName('email'), 'user@example.com')
  await inputValue(inputByName('handle'), 'liyang')
  await inputValue(inputByName('password'), 'StrongPassword123!')
  await inputValue(inputByName('confirmPassword'), 'StrongPassword123!')
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

async function submitForm() {
  await act(async () => {
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

function inputByName(name: string): HTMLInputElement {
  const input = document.querySelector(`input[name="${name}"]`)
  if (!(input instanceof HTMLInputElement)) throw new Error(`${name} input not found`)
  return input
}

function submitButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent?.includes('创建账号'))
  if (!(button instanceof HTMLButtonElement)) throw new Error('submit button not found')
  return button
}
