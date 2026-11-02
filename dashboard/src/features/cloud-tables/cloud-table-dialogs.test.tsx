// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { CloudTableDto } from '@synapse/shared'
import { CloudTableDialogs } from './cloud-table-dialogs'
import type { CloudTablesModel } from './use-cloud-tables'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.restoreAllMocks() })
const table: CloudTableDto = { id: 'table', ownerId: 'owner', name: '原名', schemaVersion: 1, fields: [], anonymous: {}, members: [], deletedAt: null, createdAt: '', permissions: { read: 'all', create: 'all', update: 'all', delete: 'all', manage: 'all' } }
async function mount(model: CloudTablesModel) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<CloudTableDialogs model={model} />))
}
async function save() {
  const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '保存')!
  await act(async () => button.click())
}
it('does not submit an old name draft with a new schema version', async () => {
  const mutateAsync = vi.fn().mockResolvedValue({})
  const model = { table, dialog: { kind: 'rename' }, setDialog: vi.fn(), mutation: { mutateAsync, isPending: false } } as unknown as CloudTablesModel
  await mount(model)
  await act(async () => root.render(<CloudTableDialogs model={{ ...model, table: { ...table, schemaVersion: 2, name: '并发修改' } }} />))
  await save()
  expect(mutateAsync).toHaveBeenCalledWith({ path: '/table', method: 'PATCH', body: { version: 1, name: '原名' } })
})
it('keeps an empty-string default and the original schema snapshot when editing a field', async () => {
  const saveField = vi.fn().mockResolvedValue({})
  const field = { key: 'text', name: '文本', type: 'text' as const, defaultValue: '' }
  const original = { ...table, fields: [field] }
  const model = { table: original, dialog: { kind: 'field', field }, setDialog: vi.fn(), saveField, mutation: { isPending: false } } as unknown as CloudTablesModel
  await mount(model)
  await act(async () => root.render(<CloudTableDialogs model={{ ...model, table: { ...original, schemaVersion: 2 } }} />))
  await save()
  expect(saveField).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: '' }), original)
})
it('keeps the legal _null select option distinct from clearing a value', async () => {
  const saveRecord = vi.fn().mockResolvedValue({})
  const original = { ...table, fields: [{ key: 'status', name: '状态', type: 'singleSelect' as const, options: [{ key: '_null', name: '保留选项' }] }] }
  const model = { table: original, dialog: { kind: 'record' }, setDialog: vi.fn(), saveRecord, mutation: { isPending: false } } as unknown as CloudTablesModel
  await mount(model)
  const select = document.querySelector('select')!
  const options = Array.from(select.options)
  expect(new Set(options.map(o => o.value)).size).toBe(options.length)
  const option = options.find(o => o.textContent === '保留选项')!
  await act(async () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await save()
  expect(saveRecord).toHaveBeenCalledWith({ status: '_null' }, undefined, original)
})
