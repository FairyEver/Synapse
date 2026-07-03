// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { SignOutDialog } from './sign-out-dialog'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const navigate = vi.fn()
const reset = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ href: '/console/settings' }),
  useNavigate: () => navigate,
}))

vi.mock('@/lib/api', () => ({
  dashboardApi: {
    logout: vi.fn(),
  },
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ auth: { reset } }),
}))

vi.mock('@/components/confirm-dialog', () => ({
  ConfirmDialog: ({
    confirmText,
    handleConfirm,
  }: {
    readonly confirmText: string
    readonly handleConfirm: () => Promise<void>
  }) => (
    <button type='button' onClick={() => { void handleConfirm() }}>
      {confirmText}
    </button>
  ),
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
})

describe('SignOutDialog', () => {
  it('shows a warning when server logout fails', async () => {
    vi.mocked(dashboardApi.logout).mockRejectedValue(new Error('offline'))

    renderDialog()
    await act(async () => {
      buttonWithText('退出登录')?.click()
    })

    expect(toast.error).toHaveBeenCalledWith('退出登录失败，服务端会话可能未清除。')
    expect(reset).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith({
      to: '/sign-in',
      search: { redirect: '/settings' },
      replace: true,
    })
  })
})

function renderDialog() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(<SignOutDialog open onOpenChange={vi.fn()} />)
  })
}

function buttonWithText(text: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.includes(text)) ?? null
}
