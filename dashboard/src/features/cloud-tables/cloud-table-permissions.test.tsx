// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { CloudTableDto } from '@synapse/shared'
import { CloudTableDialogs } from './cloud-table-dialogs'
import { cloudTableApi } from './cloud-table-api'
import type { CloudTablesModel } from './use-cloud-tables'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement, client: QueryClient
let mountedModel: CloudTablesModel
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); client?.clear(); vi.restoreAllMocks() })
const table: CloudTableDto = { id: 'table', ownerId: 'owner', name: '报名', schemaVersion: 1, fields: [], members: [], anonymous: {}, deletedAt: null, createdAt: '', permissions: { read: 'all', create: 'all', update: 'all', delete: 'all', manage: 'all' } }
async function mount(anonymous = {}) {
  const mutateAsync = vi.fn().mockResolvedValue({})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const model = { table: { ...table, anonymous }, dialog: { kind: 'permissions' }, setDialog: vi.fn(), mutation: { mutateAsync, isPending: false } } as unknown as CloudTablesModel
  mountedModel = model
  await act(async () => root.render(<QueryClientProvider client={client}><CloudTableDialogs model={model} /></QueryClientProvider>))
  return mutateAsync
}
it('keeps permission drafts on their original schema version after a background revocation', async () => {
  const save = await mount({ read: true })
  const updated = { ...mountedModel, table: { ...mountedModel.table!, schemaVersion: 2, anonymous: {}, members: [] } }
  await act(async () => root.render(<QueryClientProvider client={client}><CloudTableDialogs model={updated} /></QueryClientProvider>))
  await click('保存')
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ body: { version: 1, anonymous: { read: true }, members: [] } }))
})
async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent === text)
  if (!button) throw new Error(`Button missing: ${text}`)
  await act(async () => button.click())
}
async function toggle(label: string) {
  const node = Array.from(document.querySelectorAll('label')).find(n => n.textContent === label)
  if (!node) throw new Error(`Checkbox missing: ${label}`)
  await act(async () => node.querySelector('input')!.click())
}
async function input(value: string) {
  const node = document.querySelector('[role="combobox"]') as HTMLInputElement
  if (!node) throw new Error('Collaborator search missing')
  await act(async () => {
    node.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
}

it('confirms public destructive permissions on save and keeps the draft after cancel', async () => {
  const save = await mount()
  await toggle('删除全部记录')
  expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(4)
  await click('保存')
  expect(save).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('任何人无需登录即可删除全部记录')
  await click('返回修改')
  expect(save).not.toHaveBeenCalled()
  await click('保存'); await click('允许并保存')
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ body: { version: 1, anonymous: { delete: true }, members: [] } }))
})
it('saves without a warning when destructive access was already enabled or is turned back off', async () => {
  const save = await mount({ update: true })
  await toggle('删除全部记录'); await toggle('删除全部记录')
  await click('保存')
  expect(save).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
})
it('debounces account searches, adds the selected user and submits only their id and permissions', async () => {
  const search = vi.spyOn(cloudTableApi, 'searchCollaborators').mockResolvedValue({ data: [{ id: 'u1', handle: 'alice', nickname: '小明' }], hasMore: false })
  const save = await mount()
  expect(search).not.toHaveBeenCalled()
  await input('alice@example.test'); await settle()
  expect(search).toHaveBeenLastCalledWith('table', 'alice@example.test', expect.any(AbortSignal))
  const option = document.querySelector('[role="option"]') as HTMLElement
  expect(option?.textContent).toContain('小明')
  expect(option?.textContent).toContain('alice')
  await act(async () => option.click())
  await click('添加')
  expect(document.body.textContent).toContain('小明')
  await click('保存')
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ body: { version: 1, anonymous: {}, members: [{ userId: 'u1', permissions: { read: 'all', create: 'none', update: 'none', delete: 'none' } }] } }))
})
it('shows search failure with a retry instead of an empty result', async () => {
  const search = vi.spyOn(cloudTableApi, 'searchCollaborators').mockRejectedValueOnce(new Error('搜索暂时不可用')).mockResolvedValue({ data: [], hasMore: false })
  await mount(); await input('小明'); await settle()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('搜索暂时不可用')
  expect(document.body.textContent).not.toContain('未找到用户')
  await click('重试'); await settle()
  expect(search).toHaveBeenCalledTimes(2)
  expect(document.body.textContent).toContain('未找到用户')
})
it('aborts old searches and ignores their late results when the query changes', async () => {
  let resolveOld!: (value: Awaited<ReturnType<typeof cloudTableApi.searchCollaborators>>) => void
  const search = vi.spyOn(cloudTableApi, 'searchCollaborators')
    .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    .mockResolvedValue({ data: [{ id: 'bob', handle: 'bob', nickname: '新结果' }], hasMore: false })
  await mount(); await input('alice'); await settle()
  const signal = search.mock.calls[0]![2]!
  await input('bob'); await settle()
  expect(signal.aborted).toBe(true)
  await act(async () => resolveOld({ data: [{ id: 'alice', handle: 'alice', nickname: '过期结果' }], hasMore: false }))
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain('新结果')
  expect(document.querySelector('[role="listbox"]')?.textContent).not.toContain('过期结果')
})
