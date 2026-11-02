import '@/styles/globals.css'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DashboardWebhookDto, WebhookDeliveryHistoryDto } from '@synapse/shared'
import { adminApi, dashboardApi } from '@/lib/api'
import { WebhookConfiguration } from './webhook-configuration'
import { WebhookDeliveryHistory, type WebhookDeliveryHistorySearch } from '../webhook-deliveries'
import { WebhookDeliveryHistoryDetailSheet } from '../webhook-deliveries/webhook-delivery-history-detail-sheet'
import { WebhookSelector } from '../webhook-deliveries/webhook-selector'
import { ServerDataTable } from '@/components/data-table'
import { buildWebhookColumns } from './webhook-columns'
import { WebhookWorkspace } from './webhook-workspace'
import type { WebhookWorkspaceSearch } from './webhook-workspace-search'

vi.mock('@tanstack/react-router', async (original) => ({
  ...await original<typeof import('@tanstack/react-router')>(),
  useNavigate: () => vi.fn(),
}))

const webhook: DashboardWebhookDto = {
  id: 'hook-1', publicId: 'wh_fixture', name: 'GitHub 部署', enabled: true,
  url: 'https://example.invalid/webhooks/wh_fixture/whsec_fixture',
  maskedUrl: 'https://example.invalid/webhooks/wh_fixture/***',
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
}
const delivery: WebhookDeliveryHistoryDto = {
  id: 'delivery-1', webhookId: webhook.id, method: 'POST', path: '/webhooks/wh_fixture/***',
  query: { branch: 'main' }, headers: { 'content-type': 'application/json' },
  bodyKind: 'json', bodySize: 10, bodyPreview: '{"ok":true}', receivedAt: '2026-11-02T00:00:00Z',
  onlineClientCount: 2, sentClientCount: 2, failedClientCount: 0, acknowledgedClientCount: 1,
  status: 'sent', webhook: { id: webhook.id, publicId: webhook.publicId, name: webhook.name },
  clientReceipts: [{ id: 'receipt-1', clientInstanceId: 'client-1', deviceName: 'MacBook Pro',
    platform: 'darwin', appVersion: '1.0.0', sentAt: '2026-11-02T00:00:00Z', status: 'acknowledged',
    acknowledgedAt: '2026-11-02T00:00:01Z' }],
}

afterEach(() => vi.restoreAllMocks())

function HistoryFixture({ initialSearch = {} }: { initialSearch?: WebhookDeliveryHistorySearch }) {
  const [search, setSearch] = useState(initialSearch)
  // Match the owning Main's page gutter when measuring portalled filters.
  return <main className='p-6'>
    <button onClick={() => setSearch({ webhookId: 'hook-2', status: 'delivered', page: 2 })}>切换历史条件</button>
    <WebhookDeliveryHistory mode='user' search={search} onSearchChange={setSearch} />
  </main>
}
function provider(children: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}
function WorkspaceFixture({ initialSearch = {} }: { initialSearch?: WebhookWorkspaceSearch }) {
  const [search, setSearch] = useState(initialSearch)
  return <WebhookWorkspace search={search} onSearchChange={setSearch} />
}
function noOverflow() {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
}
async function settleMotion() {
  await expect.poll(() => document.getAnimations().some(animation => animation.playState === 'running' && animation.timeline instanceof DocumentTimeline)).toBe(false)
}

describe('Webhook task flows', () => {
  for (const width of [390, 1280]) {
    it(`unifies configuration and global records with persistent filters at ${width}px`, async () => {
      await page.viewport(width, 850)
      vi.spyOn(dashboardApi, 'listWebhooks').mockResolvedValue({ data: [webhook], total: 1, page: 1, pageSize: 10 })
      const history = vi.spyOn(dashboardApi, 'listWebhookDeliveryHistory').mockResolvedValue({ data: [delivery], total: 1, page: 1, pageSize: 10 })
      await render(provider(<WorkspaceFixture />))
      await expect.element(page.getByRole('heading', { name: 'Webhook', exact: true })).toBeVisible()
      await expect.element(page.getByRole('tab', { name: '接入配置', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect.element(page.getByRole('button', { name: '新建 Webhook', exact: true })).toBeVisible()
      expect(history).not.toHaveBeenCalled()
      page.getByRole('tab', { name: '接入配置', exact: true }).element().focus()
      await userEvent.keyboard('{ArrowRight}')
      await expect.element(page.getByRole('tab', { name: '触发记录', exact: true })).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('button', { name: '全部状态 投递状态', exact: true }).click()
      await page.getByRole('option', { name: '桌面端已确认', exact: true }).click()
      await expect.poll(() => history.mock.calls.at(-1)?.[0]?.status).toBe('delivered')
      await page.getByRole('tab', { name: '接入配置', exact: true }).click()
      await page.getByRole('button', { name: '新建 Webhook', exact: true }).click()
      await expect.element(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await page.getByRole('tab', { name: '触发记录', exact: true }).click()
      await expect.element(page.getByRole('button', { name: '桌面端已确认 投递状态', exact: true })).toBeVisible()
      expect(document.querySelectorAll('main')).toHaveLength(1)
      noOverflow()
      await settleMotion()
      await page.screenshot({ path: `/tmp/synapse-webhook-workspace-${width}.png` })
    })

    it(`reveals and copies the URL, and saves a name at ${width}px`, async () => {
      await page.viewport(width, 850)
      const onSaveName = vi.fn()
      const onToggle = vi.fn()
      const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
      await render(<WebhookConfiguration webhook={webhook} isUpdating={false} isResetting={false}
        onSaveName={onSaveName} onToggle={onToggle} onResetSecret={() => undefined} onDelete={() => undefined} />)
      const address = page.getByLabelText('接入地址', { exact: true })
      expect((address.element() as HTMLInputElement).value).toBe(webhook.maskedUrl)
      await page.getByRole('button', { name: '显示接入地址' }).click()
      expect((address.element() as HTMLInputElement).value).toBe(webhook.url)
      await page.getByRole('button', { name: '复制接入地址' }).click()
      expect(copy).toHaveBeenCalledWith(webhook.url)
      await page.getByRole('textbox', { name: /^名称/ }).fill('  新部署入口  ')
      await page.getByRole('button', { name: '保存名称' }).click()
      expect(onSaveName).toHaveBeenCalledWith('新部署入口')
      await page.getByText('接收 Webhook', { exact: true }).click()
      expect(onToggle).toHaveBeenCalledOnce()
      page.getByRole('switch', { name: '接收 Webhook' }).element().focus()
      await userEvent.keyboard(' ')
      expect(onToggle).toHaveBeenCalledTimes(2)
      noOverflow()
      await settleMotion()
      await page.screenshot({ path: `/tmp/synapse-webhook-configuration-${width}.png` })
    })

    it(`filters by name, clears filters, and blocks reversed dates at ${width}px`, async () => {
      await page.viewport(width, 850)
      vi.spyOn(dashboardApi, 'listWebhooks').mockResolvedValue({ data: [webhook], total: 1, page: 1, pageSize: 50 })
      const history = vi.spyOn(dashboardApi, 'listWebhookDeliveryHistory').mockResolvedValue({ data: [delivery], total: 1, page: 1, pageSize: 10 })
      await render(provider(<HistoryFixture />))
      await page.getByRole('button', { name: /全部 Webhook/ }).click()
      await page.getByRole('option', { name: webhook.name }).click()
      await expect.poll(() => history.mock.calls.at(-1)?.[0]?.webhookId).toBe(webhook.id)
      await page.getByLabelText('开始日期', { exact: true }).fill('2026-11-03')
      const calls = history.mock.calls.length
      await page.getByLabelText('结束日期', { exact: true }).fill('2026-11-02')
      await expect.element(page.getByText('结束日期不能早于开始日期', { exact: true })).toBeVisible()
      expect(history.mock.calls.length).toBe(calls)
      await page.getByRole('button', { name: '清除筛选' }).click()
      await expect.poll(() => history.mock.calls.at(-1)?.[0]?.webhookId).toBeUndefined()
      noOverflow()
      await page.getByRole('button', { name: '全部状态 投递状态', exact: true }).click()
      await expect.element(page.getByRole('option', { name: '桌面端已确认', exact: true })).toBeVisible()
      await settleMotion()
      const popup = document.querySelector('[data-slot="select-popover"]')!.getBoundingClientRect()
      expect(popup.left).toBeGreaterThanOrEqual(0)
      expect(popup.right).toBeLessThanOrEqual(width)
      await page.screenshot({ path: `/tmp/synapse-webhook-filters-${width}.png` })
    })

    it(`separates request data and receipts in an open drawer at ${width}px`, async () => {
      await page.viewport(width, 850)
      const longName = 'WebhookLongName'.repeat(8)
      await render(<WebhookDeliveryHistoryDetailSheet open onOpenChange={() => undefined}
        delivery={{ ...delivery, webhook: { ...delivery.webhook, name: longName } }} />)
      await expect.element(page.getByRole('heading', { name: longName, exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Query 参数', exact: true }).click()
      await expect.element(page.getByText('"branch": "main"', { exact: false })).toBeVisible()
      await page.getByRole('tab', { name: '桌面端回执' }).click()
      await expect.element(page.getByText('MacBook Pro', { exact: true })).toBeVisible()
      const dialog = page.getByRole('dialog').element()
      await settleMotion()
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth)
      const close = document.querySelector('[data-slot="drawer-close-trigger"]')!.getBoundingClientRect()
      const title = page.getByRole('heading', { name: longName, exact: true }).element().getBoundingClientRect()
      expect(title.right).toBeLessThanOrEqual(close.left - 8)
      await page.screenshot({ path: `/tmp/synapse-webhook-receipts-${width}.png` })
    })

    it(`opens a grouped row menu without clipping at ${width}px`, async () => {
      await page.viewport(width, 850)
      const edit = vi.fn()
      const columns = buildWebhookColumns({ onEdit: edit, onToggle: vi.fn(), onResetSecret: vi.fn(), onOpenDeliveries: vi.fn(), onDelete: vi.fn() })
      await render(<ServerDataTable columns={columns} data={[webhook]} page={1} pageSize={10} total={1} onPageChange={() => undefined} onPageSizeChange={() => undefined} />)
      await page.getByRole('button', { name: `${webhook.name} 的操作`, exact: true }).click()
      await expect.element(page.getByRole('menuitem', { name: '重命名', exact: true })).toBeVisible()
      await expect.element(page.getByRole('menuitem', { name: '删除 Webhook', exact: true })).toBeVisible()
      await settleMotion()
      const menu = document.querySelector('[data-slot="dropdown-popover"]')!.getBoundingClientRect()
      expect(menu.left).toBeGreaterThanOrEqual(0)
      expect(menu.right).toBeLessThanOrEqual(width)
      expect(menu.bottom).toBeLessThanOrEqual(850)
      await page.screenshot({ path: `/tmp/synapse-webhook-menu-${width}.png` })
      await userEvent.keyboard('{ArrowDown}{Enter}')
      expect(edit).toHaveBeenCalledWith(webhook)
    })
  }

  it('keeps legacy URLs non-copyable and routes the user to reset', async () => {
    const reset = vi.fn()
    await render(<WebhookConfiguration webhook={{ ...webhook, url: null }} isUpdating={false} isResetting={false}
      onSaveName={() => undefined} onToggle={() => undefined} onResetSecret={reset} onDelete={() => undefined} />)
    await expect.element(page.getByRole('button', { name: '复制接入地址' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: '显示接入地址' })).toBeDisabled()
    const buttons = page.getByRole('button', { name: '重置调用地址', exact: true }).all()
    await buttons[0].click()
    expect(reset).toHaveBeenCalledOnce()
  })

  it('responds to new route search values and preserves the selected page size', async () => {
    vi.spyOn(dashboardApi, 'listWebhooks').mockResolvedValue({ data: [webhook, { ...webhook, id: 'hook-2', name: '另一入口' }], total: 2, page: 1, pageSize: 50 })
    const history = vi.spyOn(dashboardApi, 'listWebhookDeliveryHistory').mockImplementation(async (query) => ({ data: [delivery], total: 50, page: query?.page ?? 1, pageSize: query?.pageSize ?? 10 }))
    await render(provider(<HistoryFixture />))
    await page.getByRole('button', { name: '切换历史条件' }).click()
    await expect.poll(() => history.mock.calls.at(-1)?.[0]).toMatchObject({ webhookId: 'hook-2', status: 'delivered', page: 2 })
    await page.getByRole('button', { name: /每页行数/ }).click()
    await page.getByRole('option', { name: '20 条 / 页', exact: true }).click()
    await expect.poll(() => history.mock.calls.at(-1)?.[0]).toMatchObject({ webhookId: 'hook-2', page: 1, pageSize: 20 })
  })

  it('loads the next page of named Webhooks when the list is scrolled', async () => {
    const first = Array.from({ length: 50 }, (_, index) => ({ ...webhook, id: `hook-${index}`, name: `入口 ${index}` }))
    const list = vi.spyOn(dashboardApi, 'listWebhooks').mockImplementation(async (query) => ({ data: query?.page === 2 ? [{ ...webhook, id: 'hook-50', name: '最后的入口' }] : first, total: 51, page: query?.page ?? 1, pageSize: 50 }))
    const change = vi.fn()
    await render(provider(<WebhookSelector value='' onChange={change} />))
    await page.getByRole('button', { name: /全部 Webhook/ }).click()
    await expect.element(page.getByRole('option', { name: '入口 49', exact: true })).toBeInTheDocument()
    page.getByRole('option', { name: '入口 49', exact: true }).element().scrollIntoView()
    await expect.poll(() => list.mock.calls.some(([query]) => query?.page === 2)).toBe(true)
    await page.getByRole('option', { name: '最后的入口', exact: true }).click()
    expect(change).toHaveBeenCalledWith('hook-50')
  })

  it('keeps deleted Webhook history selectable and admin requests isolated', async () => {
    vi.spyOn(dashboardApi, 'listWebhooks').mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 50 })
    vi.spyOn(dashboardApi, 'getWebhook').mockRejectedValue(new Error('不存在'))
    const user = vi.spyOn(dashboardApi, 'listWebhookDeliveryHistory').mockResolvedValue({ data: [{ ...delivery, webhook: { ...delivery.webhook, deletedAt: '2026-11-01T00:00:00Z' } }], total: 1, page: 1, pageSize: 10 })
    const view = await render(provider(<HistoryFixture initialSearch={{ webhookId: webhook.id }} />))
    await expect.poll(() => user.mock.calls.at(-1)?.[0]?.webhookId).toBe(webhook.id)
    await expect.element(page.getByText('已删除', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /GitHub 部署 Webhook/ }).click()
    await expect.element(page.getByRole('option', { name: webhook.name, exact: true })).toBeVisible()
    await view.unmount()
    const admin = vi.spyOn(adminApi, 'listWebhookDeliveryHistory').mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 10 })
    const before = user.mock.calls.length
    await render(provider(<WebhookDeliveryHistory mode='admin' search={{ webhookId: 'deleted', userId: 'user-1' }} onSearchChange={() => undefined} />))
    await expect.poll(() => admin.mock.calls.at(-1)?.[0]).toMatchObject({ webhookId: 'deleted', userId: 'user-1' })
    expect(user.mock.calls.length).toBe(before)
    await expect.element(page.getByLabelText('Webhook ID', { exact: true })).toBeVisible()
  })
})
