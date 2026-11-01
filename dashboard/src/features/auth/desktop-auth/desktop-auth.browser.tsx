import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { dashboardApi } from '@/lib/api'
import { DesktopAuth } from './index'

const { navigate, auth } = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: { isAuthenticated: true, user: { sessionId: 'layout-session' } },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate, Navigate: () => null }))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ auth }),
}))
vi.mock('@/lib/api', () => ({ dashboardApi: { authorizeDesktopLogin: vi.fn() } }))

const search = {
  client_id: 'synapse-desktop', redirect_uri: 'synapse://auth/desktop/callback',
  response_type: 'code', state: 'layout-state-1234567890',
  code_challenge: 'layout-challenge-1234567890', code_challenge_method: 'S256',
}

afterEach(() => vi.resetAllMocks())

function expectAlignedActions(width: number) {
  const card = document.querySelector<HTMLElement>('[data-slot="card"]')!
  const content = document.querySelector<HTMLElement>('[data-slot="card-content"]')!
  const bounds = card.getBoundingClientRect()
  const contentBounds = content.getBoundingClientRect()
  const buttons = Array.from(card.querySelectorAll('button'))
  expect(buttons).toHaveLength(2)
  for (const button of buttons) {
    const rect = button.getBoundingClientRect()
    expect(Math.abs(rect.left - contentBounds.left)).toBeLessThan(1)
    expect(Math.abs(rect.width - contentBounds.width)).toBeLessThan(1)
    expect(rect.height).toBeGreaterThanOrEqual(width < 768 ? 40 : 36)
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth)
  }
  const first = buttons[0].getBoundingClientRect()
  const second = buttons[1].getBoundingClientRect()
  expect(second.top - first.bottom).toBeGreaterThanOrEqual(8)
  expect(second.top - first.bottom).toBeLessThanOrEqual(16)
  expect(bounds.height).toBeLessThan(300)
  expect(bounds.left).toBeGreaterThanOrEqual(20)
  expect(bounds.right).toBeLessThanOrEqual(width - 20)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
}

describe('desktop auth handoff layout', () => {
  for (const width of [320, 390, 1280]) {
    it(`keeps pending and opened actions aligned at ${width}px`, async () => {
      await page.viewport(width, 800)
      let resolve!: (value: { deepLinkUrl: string }) => void
      vi.mocked(dashboardApi.authorizeDesktopLogin).mockReturnValue(new Promise(result => { resolve = result }))
      await render(<DesktopAuth search={search} />)
      await expect.element(page.getByRole('button', { name: /打开/ }).first()).toBeDisabled()
      expectAlignedActions(width)
      await page.screenshot({ path: `/tmp/synapse-desktop-auth-${width}-pending.png` })

      // A fragment-only fixture cannot open an external protocol or submit a real login.
      resolve({ deepLinkUrl: '#desktop-auth-layout-fixture' })
      const reopen = page.getByRole('button', { name: '再次打开 Synapse', exact: true })
      await expect.element(reopen).toBeEnabled()
      await expect.element(page.getByRole('status')).toHaveTextContent('请在 Synapse 中继续登录。')
      expectAlignedActions(width)
      await userEvent.tab()
      await expect.element(reopen).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      expect(dashboardApi.authorizeDesktopLogin).toHaveBeenCalledOnce()
      await page.screenshot({ path: `/tmp/synapse-desktop-auth-${width}-opened.png` })
      await userEvent.tab()
      await expect.element(page.getByRole('button', { name: '返回首页' })).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      expect(navigate).toHaveBeenCalledWith({ to: '/settings', replace: true })
    })

    it(`wraps errors and retains full actions when retrying at ${width}px`, async () => {
      await page.viewport(width, 800)
      vi.mocked(dashboardApi.authorizeDesktopLogin)
        .mockRejectedValueOnce(new Error('暂时无法连接服务器，请检查网络连接后重试。'))
        .mockReturnValue(new Promise(() => undefined))
      await render(<DesktopAuth search={search} />)
      await expect.element(page.getByRole('alert')).toHaveTextContent('暂时无法连接服务器，请检查网络连接后重试。')
      expectAlignedActions(width)
      await page.screenshot({ path: `/tmp/synapse-desktop-auth-${width}-error.png` })
      await page.getByRole('button', { name: '重试打开 Synapse' }).click()
      await expect.element(page.getByRole('button', { name: '正在打开 Synapse' })).toBeDisabled()
      expect(dashboardApi.authorizeDesktopLogin).toHaveBeenCalledTimes(2)
      expectAlignedActions(width)
    })
  }
})
