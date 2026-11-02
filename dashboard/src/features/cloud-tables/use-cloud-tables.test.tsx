// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { CloudTableDto } from '@synapse/shared'
import { cloudTableApi } from './cloud-table-api'
import { useCloudTables, type CloudTablesModel } from './use-cloud-tables'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('refreshes first-page records when a separately refreshed schema restores a field', async () => {
  let current: CloudTableDto = { id: 'table', ownerId: 'owner', name: '原名', schemaVersion: 1, fields: [], anonymous: {}, members: [], deletedAt: null, createdAt: '', permissions: { read: 'all', create: 'all', update: 'all', delete: 'all', manage: 'all' } }
  vi.spyOn(cloudTableApi, 'list').mockResolvedValue({ data: [], nextCursor: null })
  vi.spyOn(cloudTableApi, 'get').mockImplementation(async () => current)
  vi.spyOn(cloudTableApi, 'query').mockImplementation(async () => ({ data: [{ id: 'row', values: current.schemaVersion === 1 ? {} : { restored: '原始值' }, version: 1, creatorUserId: 'owner', createdAt: '', updatedAt: '', deletedAt: null }], nextCursor: null }))
  let model!: CloudTablesModel
  function Probe() { model = useCloudTables(); return null }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const settle = () => act(async () => { await new Promise(r => setTimeout(r, 30)) })
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>))
    await act(async () => model.select('table')); await settle()
    expect(model.records.data!.data[0]!.values).toEqual({})
    current = { ...current, schemaVersion: 2, fields: [{ key: 'restored', name: '恢复字段', type: 'text' }] }
    await act(async () => { await model.detail.refetch() }); await settle(); await settle()
    expect(model.records.data!.data[0]!.values).toEqual({ restored: '原始值' })
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks() }
})
it('recovers a paged record query after a schema-changing rename', async () => {
  let current: CloudTableDto = { id: 'table', ownerId: 'owner', name: '原名', schemaVersion: 1, fields: [], anonymous: {}, members: [], deletedAt: null, createdAt: '', permissions: { read: 'all', create: 'all', update: 'all', delete: 'all', manage: 'all' } }
  vi.spyOn(cloudTableApi, 'list').mockResolvedValue({ data: [], nextCursor: null })
  vi.spyOn(cloudTableApi, 'get').mockImplementation(async () => current)
  vi.spyOn(cloudTableApi, 'send').mockImplementation(async () => { current = { ...current, name: '新名', schemaVersion: 2 }; return current as never })
  const query = vi.spyOn(cloudTableApi, 'query').mockImplementation(async (_id, input) => {
    if ((input as { cursor?: string }).cursor && current.schemaVersion > 1) throw new Error('INVALID_CURSOR')
    return { data: [], nextCursor: 'page2' }
  })
  let model!: CloudTablesModel
  function Probe() { model = useCloudTables(); return null }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const settle = () => act(async () => { await new Promise(r => setTimeout(r, 30)) })
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>))
    await act(async () => model.select('table')); await settle()
    await act(async () => model.next('page2')); await settle()
    expect(model.history).toHaveLength(1)
    await act(async () => { await model.mutation.mutateAsync({ path: '/table', method: 'PATCH', body: { version: 1, name: '新名' } }) })
    await settle(); await settle()
    expect(model.table!.schemaVersion).toBe(2)
    expect(model.history).toEqual([])
    expect(model.records.error).toBeNull()
    expect(query.mock.lastCall![1]).toMatchObject({ cursor: undefined })
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks() }
})
