// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { CloudTablesModel } from './use-cloud-tables'
import CloudTablesPage from './index'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const state = vi.hoisted(() => ({ model: {} as CloudTablesModel }))
vi.mock('./use-cloud-tables', () => ({ useCloudTables: () => state.model }))

it.each([[0, '0'], [12345, '12,345'], [null, '—']] as const)('displays directory count %s without confusing unavailable with empty', async (recordCount, text) => {
  state.model = {
    selected: null, listTrash: false, dialog: null, listHistory: [],
    tables: { isLoading: false, data: { data: [{ id: 'table', ownerId: 'owner', name: '计数表', schemaVersion: 1, createdAt: '2026-11-14T00:00:00Z', deletedAt: null, permissions: { manage: 'all' }, recordCount }], nextCursor: null } },
    mutation: { isPending: false },
  } as unknown as CloudTablesModel
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<CloudTablesPage />))
    const headings = [...host.querySelectorAll('thead th')]
    const column = headings.findIndex(h => h.textContent === '记录数')
    expect(column).toBeGreaterThanOrEqual(0)
    expect(host.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[column]!.textContent).toBe(text)
  } finally { await act(async () => root.unmount()); host.remove() }
})
