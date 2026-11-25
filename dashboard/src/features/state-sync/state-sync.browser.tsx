import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { AppShell } from '@/components/layout/app-shell'
import StateSyncPage from './index'
import { stateSyncApi, type StateSyncSpaceSummary } from './state-sync-api'

const sampleSpace: StateSyncSpaceSummary = {
  id: 'ss_browser_1',
  name: '协同画布空间',
  description: '实时 JSON 状态树演示',
  defaultDocTtlSeconds: 86400,
  maxDocs: 100,
  docCount: 1,
  onlineCount: 2,
  tokenCount: 1,
  createdAt: '2026-11-26T01:00:00.000Z',
  updatedAt: '2026-11-26T01:00:00.000Z',
}

afterEach(() => {
  vi.restoreAllMocks()
})

async function mount({ shell = false }: { shell?: boolean } = {}) {
  vi.spyOn(stateSyncApi, 'listSpaces').mockResolvedValue({ data: [sampleSpace] })
  vi.spyOn(stateSyncApi, 'getSpace').mockResolvedValue(sampleSpace)
  vi.spyOn(stateSyncApi, 'listDocs').mockResolvedValue({
    data: [{
      spaceId: sampleSpace.id,
      docId: 'room-demo',
      rev: 3,
      onlineCount: 2,
      ttlSeconds: 86400,
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      createdAt: sampleSpace.createdAt,
      updatedAt: sampleSpace.updatedAt,
    }],
    nextCursor: null,
  })
  vi.spyOn(stateSyncApi, 'listTokens').mockResolvedValue({
    data: [{
      id: 'sst_browser_1',
      spaceId: sampleSpace.id,
      name: '观战大屏',
      role: 'read',
      prefix: 'sys_browser1',
      lastUsedAt: null,
      createdAt: sampleSpace.createdAt,
    }],
  })
  const createToken = vi.spyOn(stateSyncApi, 'createToken').mockResolvedValue({
    token: {
      id: 'sst_browser_2',
      spaceId: sampleSpace.id,
      name: '房主客户端',
      role: 'create_write',
      prefix: 'sys_browser2',
      lastUsedAt: null,
      createdAt: sampleSpace.createdAt,
    },
    secret: 'sys_browser_plaintext_secret_once',
  })
  vi.spyOn(stateSyncApi, 'getSdkManifest').mockResolvedValue(null)

  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const content = (
    <QueryClientProvider client={client}>
      <StateSyncPage />
    </QueryClientProvider>
  )
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <AppShell mode='user'>{content}</AppShell> }),
    history: createMemoryHistory({ initialEntries: ['/console/state-sync'] }),
  })
  const view = await render(shell ? <RouterProvider router={router} /> : content)
  return { createToken, view }
}

function noPageOverflow(width: number) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width + 1)
}

for (const width of [390, 1280]) {
  describe(`state-sync Console layout ${width}px`, () => {
    it('renders shared shell, space table, debugger layout and tabs without overflow', async () => {
      await page.viewport(width, 850)
      await mount({ shell: true })
      await expect.element(page.getByRole('button', { name: sampleSpace.name, exact: true })).toBeVisible()
      noPageOverflow(width)

      await page.getByRole('button', { name: sampleSpace.name, exact: true }).click()
      await expect.element(page.getByRole('tablist', { name: '状态同步空间管理', exact: true })).toBeVisible()
      await expect.element(page.getByRole('button', { name: '新建房间', exact: true })).toBeVisible()
      noPageOverflow(width)

      await page.getByRole('tab', { name: '接入与 SDK 示例', exact: true }).click()
      await expect.element(page.getByText('SynapseStateSync.createClient')).toBeVisible()
      noPageOverflow(width)

      await page.getByRole('tab', { name: '设置', exact: true }).click()
      await expect.element(page.getByRole('button', { name: '保存更改', exact: true })).toBeVisible()
      noPageOverflow(width)
    })

    it('opens token creation modal with expanded role dropdown inside the viewport', async () => {
      await page.viewport(width, 850)
      const { createToken } = await mount()
      await page.getByRole('button', { name: sampleSpace.name, exact: true }).click()
      await page.getByRole('tab', { name: '接入凭证', exact: true }).click()
      await page.getByRole('button', { name: '签发凭证', exact: true }).click()

      const dialog = page.getByRole('dialog').element() as HTMLElement
      const dialogRect = dialog.getBoundingClientRect()
      expect(dialogRect.left).toBeGreaterThanOrEqual(0)
      expect(dialogRect.right).toBeLessThanOrEqual(width + 1)

      await page.getByRole('textbox', { name: '凭证名称' }).fill('房主客户端')
      await page.getByRole('button', { name: /角色权限/ }).click()

      const listRect = page.getByRole('listbox').element().getBoundingClientRect()
      expect(listRect.left).toBeGreaterThanOrEqual(0)
      expect(listRect.right).toBeLessThanOrEqual(width + 1)
      await expect.element(page.getByRole('option', { name: '建房并读写（可创建房间并写入）', exact: true })).toBeVisible()
      await page.getByRole('option', { name: '建房并读写（可创建房间并写入）', exact: true }).click()

      await page.getByRole('button', { name: '签发', exact: true }).click()
      await expect.poll(() => createToken.mock.calls.length).toBe(1)
      expect(createToken).toHaveBeenCalledWith(sampleSpace.id, { name: '房主客户端', role: 'create_write' })
      await expect.element(page.getByText('sys_browser_plaintext_secret_once')).toBeVisible()
      await userEvent.keyboard('{Escape}')
    })

    it('opens create room modal and mutation operation dropdown inside the viewport', async () => {
      await page.viewport(width, 850)
      await mount()
      await page.getByRole('button', { name: sampleSpace.name, exact: true }).click()

      // Expand mutation operation Select dropdown inside debugger tab
      await page.getByRole('button', { name: /操作类型/ }).click()
      const opListRect = page.getByRole('listbox').element().getBoundingClientRect()
      expect(opListRect.left).toBeGreaterThanOrEqual(0)
      expect(opListRect.right).toBeLessThanOrEqual(width + 1)
      await expect.element(page.getByRole('option', { name: 'patch（合并对象）', exact: true })).toBeVisible()
      await page.getByRole('option', { name: 'patch（合并对象）', exact: true }).click()
      noPageOverflow(width)

      // Open create room modal
      await page.getByRole('button', { name: '新建房间', exact: true }).click()
      await expect.element(page.getByRole('dialog', { name: '新建测试房间' })).toBeVisible()
      const dialog = page.getByRole('dialog', { name: '新建测试房间' }).element() as HTMLElement
      const dialogRect = dialog.getBoundingClientRect()
      expect(dialogRect.left).toBeGreaterThanOrEqual(0)
      expect(dialogRect.right).toBeLessThanOrEqual(width + 1)
      await expect.element(page.getByRole('button', { name: '创建房间', exact: true })).toBeVisible()
      await userEvent.keyboard('{Escape}')
    })
  })
}
