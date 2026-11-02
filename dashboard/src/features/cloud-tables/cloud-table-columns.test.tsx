// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createTable, getCoreRowModel, type ColumnDef } from '@tanstack/react-table'
import { expect, it, vi } from 'vitest'
import type { CloudRecordDto } from '@synapse/shared'
import CloudTablesPage from './index'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const state = vi.hoisted(() => ({ columns: [] as unknown[], model: {} as unknown }))
vi.mock('./use-cloud-tables', () => ({ useCloudTables: () => state.model }))
vi.mock('@/components/layout/header', () => ({ Header: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/layout/main', () => ({ Main: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/data-table', () => ({
  DataTableColumnHeader: () => null,
  ServerDataTable: ({ columns }: { columns: { accessorFn?: unknown }[] }) => { if (columns.some(c => c.accessorFn)) state.columns = columns; return null },
}))
it('keeps the valid actions field readable and sortable alongside system actions', async () => {
  const record = { id: 'row', values: { actions: '业务内容' }, version: 1, creatorUserId: 'owner', createdAt: '', updatedAt: '', deletedAt: null }
  state.model = {
    selected: 'table', tab: 'records', listTrash: false, sort: [], dialog: null,
    table: { id: 'table', name: '测试', fields: [{ key: 'actions', name: '业务操作', type: 'text' }], anonymous: {}, members: [], permissions: { read: 'all', create: 'none', update: 'none', delete: 'none', manage: 'none' } },
    detail: { isLoading: false, error: null }, mutation: { isPending: false },
    records: { data: { data: [record], nextCursor: null }, isLoading: false }, logs: {}, history: [],
    setDialog: vi.fn(), changeTab: vi.fn(), changeSort: vi.fn(),
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<CloudTablesPage />))
    const table = createTable<CloudRecordDto>({ columns: state.columns as ColumnDef<CloudRecordDto>[], data: [record], getCoreRowModel: getCoreRowModel(), state: {}, onStateChange: () => undefined, renderFallbackValue: null })
    expect(new Set(table.getAllColumns().map(c => c.id)).size).toBe(table.getAllColumns().length)
    expect(table.getColumn('actions')!.getCanSort()).toBe(true)
    expect(table.getRowModel().rows[0]!.getValue('actions')).toBe('业务内容')
  } finally { await act(async () => root.unmount()); host.remove() }
})
