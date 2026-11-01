import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CloudTablesPage from './index'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { AppShell } from '@/components/layout/app-shell'
import { CloudInput, CloudModal } from './cloud-table-controls'
import { useState } from 'react'
import { cloudTableApi } from './cloud-table-api'
import type { CloudTableDto } from '@synapse/shared'
import { useAuthStore } from '@/stores/auth-store'

const table: CloudTableDto = { id: 'table-1', ownerId: 'owner', name: '研发报名表', schemaVersion: 1, fields: [{ key: 'name', name: '姓名', type: 'text', required: true }], anonymous: {}, members: [], deletedAt: null, createdAt: '2026-11-01T00:00:00Z', permissions: { manage: 'all', read: 'all', create: 'all', update: 'all', delete: 'all' } }
afterEach(() => vi.restoreAllMocks())
async function mount({ shell = false, fixture = table }: { shell?: boolean; fixture?: CloudTableDto } = {}) {
  vi.spyOn(cloudTableApi, 'list').mockImplementation(async trash => ({ data: trash ? [{ ...table, deletedAt: '2026-11-01T00:00:00Z' }] : [fixture], nextCursor: null }))
  vi.spyOn(cloudTableApi, 'get').mockResolvedValue(fixture)
  vi.spyOn(cloudTableApi, 'query').mockResolvedValue({ data: [{ id: 'row1', values: { name: '张三' }, creatorUserId: 'owner', version: 1, createdAt: table.createdAt, updatedAt: table.createdAt, deletedAt: null }], nextCursor: null })
  vi.spyOn(cloudTableApi, 'logs').mockResolvedValue({ data: [], nextCursor: null })
  vi.spyOn(cloudTableApi, 'trash').mockResolvedValue({ data: [], nextCursor: null })
  const send = vi.spyOn(cloudTableApi, 'send').mockResolvedValue({ id: 'row-new', version: 1 } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const content = <QueryClientProvider client={client}><CloudTablesPage /></QueryClientProvider>
  const router = createRouter({ routeTree: createRootRoute({ component: () => <AppShell mode='user'>{content}</AppShell> }), history: createMemoryHistory({ initialEntries: ['/console/tables'] }) })
  const view = await render(shell ? <RouterProvider router={router} /> : content)
  return { send, client, view }
}
for (const width of [390, 1280]) describe(`cloud table Console ${width}px`, () => {
  it('creates typed records and retains standard modal geometry', async () => {
    await page.viewport(width, 850); const { send } = await mount()
    await page.getByRole('button', { name: table.name, exact: true }).click()
    await page.getByRole('button', { name: '新增记录', exact: true }).click()
    await page.getByRole('textbox', { name: '姓名' }).fill('李四')
    const dialog = page.getByRole('dialog').element() as HTMLElement
    const rect = dialog.getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(width + 1)
    const heading = dialog.querySelector('[data-slot="modal-header"]')!.getBoundingClientRect()
    expect(heading.left - rect.left).toBeGreaterThanOrEqual(20)
    expect(rect.right - heading.right).toBeGreaterThanOrEqual(20)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => send.mock.calls.some(c => c[0] === '/table-1/records' && c[1] === 'POST' && JSON.stringify(c[2]) === '{"values":{"name":"李四"}}')).toBe(true)
  })
  it('opens field type choices within the viewport and preserves field API identifiers', async () => {
    await page.viewport(width, 850); const { send } = await mount()
    await page.getByRole('button', { name: table.name, exact: true }).click()
    await page.getByRole('tab', { name: '字段', exact: true }).click()
    await page.getByRole('button', { name: '添加字段', exact: true }).click()
    await page.getByRole('textbox', { name: '字段名称' }).fill('完成')
    await page.getByRole('textbox', { name: 'API 标识' }).fill('done')
    await page.getByRole('button', { name: /字段类型/ }).click()
    const list = page.getByRole('listbox').element().getBoundingClientRect()
    expect(list.left).toBeGreaterThanOrEqual(0); expect(list.right).toBeLessThanOrEqual(width + 1)
    await expect.element(page.getByRole('option', { name: '布尔', exact: true })).toBeVisible()
    await page.screenshot({ animations: 'disabled', path: `/tmp/synapse-cloud-tables-field-menu-${width}.png` })
    await page.getByRole('option', { name: '布尔', exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => send.mock.calls.some(c => c[1] === 'PATCH' && JSON.stringify(c[2]).includes('"key":"done","name":"完成","type":"boolean"'))).toBe(true)
  })
  it('requires explicit anonymous destructive acknowledgement and restores tables', async () => {
    await page.viewport(width, 850); const { send } = await mount()
    await page.getByRole('button', { name: table.name, exact: true }).click()
    await page.getByRole('tab', { name: '权限', exact: true }).click()
    await page.getByRole('button', { name: '编辑权限', exact: true }).click()
    await page.screenshot({ animations: 'disabled', path: `/tmp/synapse-cloud-tables-permissions-modal-${width}.png` })
    await page.getByText('删除全部记录', { exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '允许并保存', exact: true }).click()
    await expect.poll(() => send.mock.calls.some(c => c[0] === '/table-1/permissions' && JSON.stringify(c[2]).includes('"delete":true'))).toBe(true)
    await page.getByRole('button', { name: '返回数据表', exact: true }).click()
    await page.getByRole('button', { name: '回收站', exact: true }).click()
    await page.getByRole('button', { name: '恢复', exact: true }).click()
    await expect.poll(() => send.mock.calls.some(c => c[0] === '/table-1/restore')).toBe(true)
  })
})
it('clears selection, dialogs and record data when the SY account changes', async () => {
  const { view } = await mount()
  try {
    await page.getByRole('button', { name: table.name, exact: true }).click()
    await expect.poll(() => document.body.textContent?.includes('张三')).toBe(true)
    await page.getByRole('button', { name: '新增记录', exact: true }).click()
    vi.mocked(cloudTableApi.list).mockResolvedValue({ data: [], nextCursor: null })
    useAuthStore.getState().auth.setUser({ email: 'next@example.test', handle: 'next', sessionId: 'next-session' })
    await expect.poll(() => document.body.textContent?.includes('张三')).toBe(false)
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
    await expect.poll(() => document.querySelector('h1')?.textContent).toBe('云端数据表')
  } finally { await view.unmount(); useAuthStore.getState().auth.reset() }
})
it('reuses a record idempotency key when retrying an uncertain network response', async () => {
  const { send } = await mount()
  send.mockRejectedValueOnce(new Error('网络响应中断'))
  await page.getByRole('button', { name: table.name, exact: true }).click()
  await page.getByRole('button', { name: '新增记录', exact: true }).click()
  await page.getByRole('textbox', { name: '姓名' }).fill('重试')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => send.mock.calls.length).toBe(1)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => send.mock.calls.length).toBe(2)
  expect(send.mock.calls[0]?.[3]).toEqual(expect.any(String))
  expect(send.mock.calls[1]?.[3]).toBe(send.mock.calls[0]?.[3])
})


function noPageOverflow(width: number) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width + 1)
}

for (const width of [320, 390, 1280]) describe(`cloud table HeroUI layout ${width}px`, () => {
  it('uses the shared shell, table and navigation at the standard page inset', async () => {
    await page.viewport(width, 850)
    await mount({ shell: true })
    await expect.element(page.getByRole('button', { name: table.name, exact: true })).toBeVisible()
    const header = document.querySelector('header')!
    const main = document.querySelector('main')!
    expect(parseFloat(getComputedStyle(header).paddingLeft)).toBe(24)
    expect(parseFloat(getComputedStyle(main).paddingLeft)).toBe(24)
    expect(parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize)).toBe(20)
    expect(document.querySelector('main [data-slot="table"]')).not.toBeNull()
    noPageOverflow(width)
    if (width < 768) {
      await page.getByRole('button', { name: '切换导航', exact: true }).click()
      await expect.element(page.getByRole('dialog', { name: '导航', exact: true })).toBeVisible()
      await userEvent.keyboard('{Escape}')
    }
    await page.screenshot({ animations: 'disabled', path: `/tmp/synapse-cloud-tables-list-${width}.png` })
  })

  it('keeps record filters visible, tabs scrollable and menus inside the viewport', async () => {
    await page.viewport(width, 850)
    await mount({ fixture: { ...table, name: 'A'.repeat(120) } })
    await page.getByRole('button', { name: 'A'.repeat(120), exact: true }).click()
    await expect.element(page.getByRole('button', { name: '新增记录', exact: true })).toBeVisible()
    const tabs = page.getByRole('tablist', { name: '数据表管理' }).element()
    if (width === 320) expect(tabs.scrollWidth).toBeGreaterThan(tabs.parentElement!.clientWidth)
    for (const tab of tabs.querySelectorAll('[role="tab"]')) expect(getComputedStyle(tab).whiteSpace).toBe('nowrap')
    noPageOverflow(width)
    const input = page.getByRole('textbox', { name: '值', exact: true }).element()
    expect(input.getBoundingClientRect().width).toBeGreaterThan(100)
    expect(getComputedStyle(input).backgroundColor).not.toBe(getComputedStyle(document.querySelector('main')!).backgroundColor)
    await page.getByRole('button', { name: /筛选字段/ }).click()
    const list = page.getByRole('listbox').element().getBoundingClientRect()
    expect(list.left).toBeGreaterThanOrEqual(0)
    expect(list.right).toBeLessThanOrEqual(width + 1)
    await userEvent.keyboard('{Escape}')
    await page.getByRole('button', { name: '列', exact: true }).click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    const menu = page.getByRole('menu').element().getBoundingClientRect()
    expect(menu.left).toBeGreaterThanOrEqual(0)
    expect(menu.right).toBeLessThanOrEqual(width + 1)
    await page.screenshot({ animations: 'disabled', path: `/tmp/synapse-cloud-tables-columns-menu-${width}.png` })
    await userEvent.keyboard('{Escape}')
    await page.getByRole('button', { name: '姓名排序', exact: true }).click()
    await expect.element(page.getByRole('menu', { name: '姓名排序', exact: true })).toBeVisible()
    await page.getByRole('menuitem', { name: '降序', exact: true }).click()
    await expect.poll(() => vi.mocked(cloudTableApi.query).mock.calls.some(call => JSON.stringify(call[1]).includes('"field":"name","direction":"desc"'))).toBe(true)
    await page.screenshot({ animations: 'disabled', path: `/tmp/synapse-cloud-tables-records-${width}.png` })
  })

  it('uses standard field, permissions and log tables and the native API link', async () => {
    await page.viewport(width, 850)
    await mount()
    await page.getByRole('button', { name: table.name, exact: true }).click()
    for (const name of ['字段', '权限', '操作记录']) {
      await page.getByRole('tab', { name, exact: true }).click()
      await expect.element(page.getByRole('grid', { name: '数据列表', exact: true })).toBeVisible()
      noPageOverflow(width)
      await page.screenshot({ animations: 'disabled', path: `/tmp/synapse-cloud-tables-${name}-${width}.png` })
    }
    await page.getByRole('tab', { name: 'API', exact: true }).click()
    await expect.element(page.getByRole('link', { name: 'API 文档', exact: true })).toBeVisible()
    noPageOverflow(width)
    await page.screenshot({ animations: 'disabled', path: `/tmp/synapse-cloud-tables-api-${width}.png` })
  })
})


function InputStatesFixture({ save }: { save: () => void }) {
  const [name, setName] = useState('')
  return <CloudModal title='字段设置' onClose={() => undefined} onSave={save}>
    <CloudInput label='字段名称' value={name} onChange={setName} required />
    <CloudInput label='API 标识' value='stable_key' onChange={() => undefined} disabled />
  </CloudModal>
}

for (const width of [320, 390, 1280]) it(`retains modal field validation, disabled identity and footer spacing at ${width}px`, async () => {
  await page.viewport(width, 850)
  const save = vi.fn()
  await render(<InputStatesFixture save={save} />)
  await expect.element(page.getByRole('textbox', { name: '字段名称' })).toBeVisible()
  const input = page.getByRole('textbox', { name: '字段名称' }).element() as HTMLInputElement
  await expect.element(page.getByRole('textbox', { name: 'API 标识', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect(save).not.toHaveBeenCalled()
  expect(input.validity.valueMissing).toBe(true)
  expect(document.activeElement).toBe(input)
  await page.getByRole('textbox', { name: '字段名称' }).fill('姓名')
  const dialog = page.getByRole('dialog').element()
  const body = dialog.querySelector('[data-slot="modal-body"]')!
  const footer = dialog.querySelector('[data-slot="modal-footer"]')!
  expect(footer.getBoundingClientRect().top - body.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(16)
  expect(getComputedStyle(input).backgroundColor).not.toBe(getComputedStyle(dialog).backgroundColor)
  expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
  expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width + 1)
  await page.screenshot({ animations: 'disabled', path: `/tmp/synapse-cloud-tables-field-states-${width}.png` })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect(save).toHaveBeenCalledOnce()
})
