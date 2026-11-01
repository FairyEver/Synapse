import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CloudTablesPage from './index'
import { cloudTableApi } from './cloud-table-api'
import type { CloudTableDto } from '@synapse/shared'
import { useAuthStore } from '@/stores/auth-store'

const table: CloudTableDto = { id: 'table-1', ownerId: 'owner', name: '研发报名表', schemaVersion: 1, fields: [{ key: 'name', name: '姓名', type: 'text', required: true }], anonymous: {}, members: [], deletedAt: null, createdAt: '2026-11-01T00:00:00Z', permissions: { manage: 'all', read: 'all', create: 'all', update: 'all', delete: 'all' } }
afterEach(() => vi.restoreAllMocks())
async function mount() {
  vi.spyOn(cloudTableApi, 'list').mockImplementation(async trash => ({ data: trash ? [{ ...table, deletedAt: '2026-11-01T00:00:00Z' }] : [table], nextCursor: null }))
  vi.spyOn(cloudTableApi, 'get').mockResolvedValue(table)
  vi.spyOn(cloudTableApi, 'query').mockResolvedValue({ data: [{ id: 'row1', values: { name: '张三' }, creatorUserId: 'owner', version: 1, createdAt: table.createdAt, updatedAt: table.createdAt, deletedAt: null }], nextCursor: null })
  vi.spyOn(cloudTableApi, 'logs').mockResolvedValue({ data: [], nextCursor: null })
  vi.spyOn(cloudTableApi, 'trash').mockResolvedValue({ data: [], nextCursor: null })
  const send = vi.spyOn(cloudTableApi, 'send').mockResolvedValue({ id: 'row-new', version: 1 } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = await render(<QueryClientProvider client={client}><CloudTablesPage /></QueryClientProvider>)
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
    await page.getByRole('option', { name: '布尔', exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => send.mock.calls.some(c => c[1] === 'PATCH' && JSON.stringify(c[2]).includes('"key":"done","name":"完成","type":"boolean"'))).toBe(true)
  })
  it('requires explicit anonymous destructive acknowledgement and restores tables', async () => {
    await page.viewport(width, 850); const { send } = await mount()
    await page.getByRole('button', { name: table.name, exact: true }).click()
    await page.getByRole('tab', { name: '权限', exact: true }).click()
    await page.getByRole('button', { name: '编辑权限', exact: true }).click()
    await page.getByText('匿名删除', { exact: true }).click()
    await page.getByText('确认允许任何人修改或删除全部记录', { exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
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
