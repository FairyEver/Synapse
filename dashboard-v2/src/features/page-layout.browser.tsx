import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import UsersPage from './users'
import BackupPage from './backup'
import LogsPage from './logs'
import SettingsPage from './settings'

vi.mock('@tanstack/react-router', async (original) => ({
  ...await original<typeof import('@tanstack/react-router')>(),
  useLocation: () => '/settings',
  useNavigate: () => vi.fn(),
  Outlet: () => null,
}))

afterEach(() => vi.restoreAllMocks())

async function renderPage(element: React.ReactNode, width = 1280) {
  await page.viewport(width, 900)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

function visibleWidth(element: Element) {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range.getBoundingClientRect().width
}

describe('page layout regressions', () => {
  it('keeps user columns readable without a viewport-sized email column', async () => {
    vi.spyOn(adminApi, 'listUsers').mockResolvedValue({ data: [{
      id: 'layout-user', email: 'layout-acceptance@example.invalid', handle: 'layout-user',
      nickname: '视觉验收', adminNote: null, status: 'active', teams: [],
      createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
    }], total: 1, page: 1, pageSize: 10 })
    vi.spyOn(adminApi, 'listLiveClients').mockResolvedValue([])
    vi.spyOn(adminApi, 'subscribeLiveClients').mockReturnValue(() => undefined)
    await renderPage(<UsersPage />)
    await expect.poll(() => document.querySelector('tbody tr')?.textContent).toContain('视觉验收')
    const cells = document.querySelectorAll('tbody tr:first-child > *')
    expect(cells[0].getBoundingClientRect().width).toBeLessThan(500)
    expect(visibleWidth(cells[1])).toBeGreaterThan(30)
    expect(document.querySelector('table')!.getBoundingClientRect().width).toBeLessThan(1800)
    await page.getByRole('button', { name: '列', exact: true }).click()
    await expect.element(page.getByRole('menuitemcheckbox', { name: '邮箱', exact: true })).toBeVisible()
  })

  it('shows backup filenames on narrow screens', async () => {
    vi.spyOn(adminApi, 'listBackups').mockResolvedValue([{ filename: 'synapse-backup-20261101.sql.gz', size: 1024, createdAt: '2026-11-01T00:00:00Z' }])
    await renderPage(<BackupPage />, 390)
    await expect.poll(() => document.querySelector('tbody tr')?.textContent).toContain('synapse-backup')
    const filename = document.querySelector('tbody tr > *')!
    expect(filename.getBoundingClientRect().width).toBeGreaterThan(150)
  })

  it('keeps log actions inside the narrow viewport', async () => {
    vi.spyOn(adminApi, 'fetchRecentLogs').mockResolvedValue([])
    await renderPage(<LogsPage />, 390)
    const cleanup = page.getByRole('button', { name: '清理30天前' })
    await expect.element(cleanup).toBeVisible()
    const rect = cleanup.element().getBoundingClientRect()
    expect(rect.right).toBeLessThanOrEqual(390)
  })

  it('keeps the profile tab label on one line', async () => {
    await renderPage(<SettingsPage />)
    const tab = page.getByRole('tab', { name: '个人资料' }).element()
    const text = Array.from(tab.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)!
    const range = document.createRange()
    range.selectNode(text)
    expect(range.getClientRects().length).toBe(1)
  })
})
