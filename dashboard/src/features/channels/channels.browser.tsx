import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { AppShell } from '@/components/layout/app-shell'
import ChannelsPage from './index'
import { channelApi, type ChannelSummary } from './channel-api'

const sampleChannel: ChannelSummary = {
  id: 'ch_browser_1',
  name: '展厅大屏频道',
  description: '大屏与手机遥控器联动',
  onlineCount: 2,
  tokenCount: 1,
  createdAt: '2026-11-25T08:00:00.000Z',
  updatedAt: '2026-11-25T08:00:00.000Z',
}

afterEach(() => {
  vi.restoreAllMocks()
})

async function mount({ shell = false }: { shell?: boolean } = {}) {
  vi.spyOn(channelApi, 'list').mockResolvedValue({ data: [sampleChannel] })
  vi.spyOn(channelApi, 'get').mockResolvedValue(sampleChannel)
  vi.spyOn(channelApi, 'listTokens').mockResolvedValue({
    data: [{
      id: 'cht_browser_1',
      channelId: sampleChannel.id,
      name: '客厅大屏',
      role: 'subscribe',
      prefix: 'syc_browser1',
      lastUsedAt: null,
      createdAt: sampleChannel.createdAt,
    }],
  })
  const createToken = vi.spyOn(channelApi, 'createToken').mockResolvedValue({
    token: {
      id: 'cht_browser_2',
      channelId: sampleChannel.id,
      name: '手机遥控器',
      role: 'publish',
      prefix: 'syc_browser2',
      lastUsedAt: null,
      createdAt: sampleChannel.createdAt,
    },
    secret: 'syc_browser_plaintext_secret_once',
  })
  vi.spyOn(channelApi, 'getState').mockResolvedValue({
    channelId: sampleChannel.id,
    latestSeq: 3,
    presence: [],
    retained: [{
      event: 'slide.current',
      payload: { index: 1 },
      seq: 3,
      updatedAt: sampleChannel.createdAt,
    }],
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const content = (
    <QueryClientProvider client={client}>
      <ChannelsPage />
    </QueryClientProvider>
  )
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <AppShell mode='user'>{content}</AppShell> }),
    history: createMemoryHistory({ initialEntries: ['/console/channels'] }),
  })
  const view = await render(shell ? <RouterProvider router={router} /> : content)
  return { createToken, view }
}

function noPageOverflow(width: number) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width + 1)
}

for (const width of [390, 1280]) {
  describe(`channels Console layout ${width}px`, () => {
    it('renders shared shell, channel table, debugger layout and tabs without overflow', async () => {
      await page.viewport(width, 850)
      await mount({ shell: true })
      await expect.element(page.getByRole('button', { name: sampleChannel.name, exact: true })).toBeVisible()
      noPageOverflow(width)

      await page.getByRole('button', { name: sampleChannel.name, exact: true }).click()
      await expect.element(page.getByRole('tablist', { name: '频道管理', exact: true })).toBeVisible()
      await expect.element(page.getByRole('button', { name: '连接调试', exact: true })).toBeVisible()
      noPageOverflow(width)
    })

    it('opens token creation modal with expanded role dropdown inside the viewport', async () => {
      await page.viewport(width, 850)
      const { createToken } = await mount()
      await page.getByRole('button', { name: sampleChannel.name, exact: true }).click()
      await page.getByRole('tab', { name: '接入凭证', exact: true }).click()
      await page.getByRole('button', { name: '签发凭证', exact: true }).click()

      const dialog = page.getByRole('dialog').element() as HTMLElement
      const dialogRect = dialog.getBoundingClientRect()
      expect(dialogRect.left).toBeGreaterThanOrEqual(0)
      expect(dialogRect.right).toBeLessThanOrEqual(width + 1)

      await page.getByRole('textbox', { name: '凭证名称' }).fill('手机遥控器')
      await page.getByRole('button', { name: /角色权限/ }).click()

      const listRect = page.getByRole('listbox').element().getBoundingClientRect()
      expect(listRect.left).toBeGreaterThanOrEqual(0)
      expect(listRect.right).toBeLessThanOrEqual(width + 1)
      await expect.element(page.getByRole('option', { name: '仅发布（如手机遥控器）', exact: true })).toBeVisible()
      await page.getByRole('option', { name: '仅发布（如手机遥控器）', exact: true }).click()

      await page.getByRole('button', { name: '签发', exact: true }).click()
      await expect.poll(() => createToken.mock.calls.length).toBe(1)
      expect(createToken).toHaveBeenCalledWith(sampleChannel.id, { name: '手机遥控器', role: 'publish' })
      await expect.element(page.getByText('syc_browser_plaintext_secret_once')).toBeVisible()
      await userEvent.keyboard('{Escape}')
    })
  })
}
