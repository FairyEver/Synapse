import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from '@heroui/react'
import type { CloudField, CloudRecordDto, CloudTableDto } from '@synapse/shared'
import { cloudTableApi } from './cloud-table-api'
import { downloadData, exportCsv, fieldInput, recordValues } from './cloud-table-forms'
import { useAuthStore } from '@/stores/auth-store'

export type CloudDialog = { kind: 'create' } | { kind: 'field'; field?: CloudField } | { kind: 'record'; record?: CloudRecordDto } | { kind: 'permissions' } | { kind: 'deleteTable' } | { kind: 'rename' } | null
export function useCloudTables() {
  const cache = useQueryClient()
  const session = useAuthStore(s => s.auth.user?.sessionId ?? 'anonymous')
  const exportingRequest = useRef<AbortController | null>(null)
  const pendingWrite = useRef<{ signature: string; key: string } | null>(null)
  useEffect(() => () => { exportingRequest.current?.abort(); void cache.cancelQueries({ queryKey: ['cloud-tables', session] }); cache.removeQueries({ queryKey: ['cloud-tables', session] }) }, [cache, session])
  const [selected, setSelected] = useState<string | null>(null), [listTrash, setListTrash] = useState(false)
  const [listCursor, setListCursor] = useState<string | undefined>(), [listHistory, setListHistory] = useState<(string | undefined)[]>([])
  const [tab, setTab] = useState('records'), [cursor, setCursor] = useState<string | undefined>(), [history, setHistory] = useState<(string | undefined)[]>([])
  const [filters, setFilters] = useState<unknown[]>([]), [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' }[]>([])
  const [dialog, setDialog] = useState<CloudDialog>(null), [exporting, setExporting] = useState(false)
  const tables = useQuery({ queryKey: ['cloud-tables', session, 'list', listTrash, listCursor], queryFn: ({ signal }) => cloudTableApi.list(listTrash, listCursor, signal) })
  const detail = useQuery({ queryKey: ['cloud-tables', session, 'detail', selected], queryFn: ({ signal }) => cloudTableApi.get(selected!, signal), enabled: Boolean(selected && !listTrash) })
  const table = detail.data
  useEffect(() => { setCursor(undefined); setHistory([]); setFilters([]); setSort([]) }, [table?.id, table?.schemaVersion])
  const records = useQuery({ queryKey: ['cloud-tables', session, 'records', selected, table?.schemaVersion, tab, cursor, filters, sort], queryFn: ({ signal }) => tab === 'trash' ? cloudTableApi.trash(selected!, cursor, signal) : cloudTableApi.query(selected!, { cursor, filters, sort }, signal), enabled: Boolean(table && !listTrash && (tab === 'trash' ? table.permissions.manage !== 'none' : table.permissions.read !== 'none') && ['records', 'trash'].includes(tab)) })
  const logs = useQuery({ queryKey: ['cloud-tables', session, 'logs', selected, cursor], queryFn: ({ signal }) => cloudTableApi.logs(selected!, cursor, signal), enabled: Boolean(table && !listTrash && tab === 'logs' && table.permissions.manage !== 'none') })
  const mutation = useMutation({ mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown }) => {
    const signature = JSON.stringify({ path, method, body })
    if (pendingWrite.current?.signature !== signature) pendingWrite.current = { signature, key: crypto.randomUUID() }
    return cloudTableApi.send<CloudTableDto>(path, method, body, pendingWrite.current.key)
  }, onSuccess: () => { pendingWrite.current = null; setDialog(null); void cache.invalidateQueries({ queryKey: ['cloud-tables'] }) }, onError: (e: Error) => toast.danger(e.message) })
  function select(id: string | null) { setSelected(id); setFilters([]); setSort([]); changeTab('records') }
  function changeTab(value: string) { setTab(value); setCursor(undefined); setHistory([]) }
  function query(filters: unknown[], sort: { field: string; direction: 'asc' | 'desc' }[] = []) { setFilters(filters); setSort(sort); setCursor(undefined); setHistory([]) }
  function changeSort(sort: { field: string; direction: 'asc' | 'desc' }[]) { setSort(sort); setCursor(undefined); setHistory([]) }
  function next(nextCursor: string | null | undefined) { if (nextCursor) { setHistory(h => [...h, cursor]); setCursor(nextCursor) } }
  function previous() { setHistory(h => { setCursor(h.at(-1)); return h.slice(0, -1) }) }
  function nextList(value: string | null | undefined) { if (value) { setListHistory(h => [...h, listCursor]); setListCursor(value) } }
  function previousList() { setListHistory(h => { setListCursor(h.at(-1)); return h.slice(0, -1) }) }
  function toggleTrash(value: boolean) { setListTrash(value); setListCursor(undefined); setListHistory([]); select(null) }
  async function saveRecord(draft: Record<string, string>, record?: CloudRecordDto, original = table) {
    if (!original) return
    const values = recordValues(original.fields, draft, record?.values)
    await mutation.mutateAsync({ path: `/${original.id}/records${record ? `/${record.id}` : ''}`, method: record ? 'PATCH' : 'POST', body: { values, ...(record ? { version: record.version } : {}) } })
  }
  async function saveField(field: CloudField, original = table) {
    if (!original) return
    const active = original.fields.filter(f => !f.archivedAt).map(({ archivedAt: _a, ...f }) => f)
    const fields = active.some(f => f.key === field.key) ? active.map(f => f.key === field.key ? field : f) : [...active, field]
    await mutation.mutateAsync({ path: `/${original.id}`, method: 'PATCH', body: { version: original.schemaVersion, fields } })
  }
  async function archiveField(field: CloudField) {
    if (!table) return
    await mutation.mutateAsync({ path: `/${table.id}`, method: 'PATCH', body: { version: table.schemaVersion, fields: table.fields.filter(f => !f.archivedAt && f.key !== field.key).map(({ archivedAt: _a, ...f }) => f) } })
  }
  async function exportRecords(format: 'json' | 'csv') {
    if (!table) return
    setExporting(true)
    const controller = new AbortController(); exportingRequest.current?.abort(); exportingRequest.current = controller
    try {
      const rows: Record<string, unknown>[] = [], encoder = new TextEncoder(); let cursor: string | undefined, size = 0
      do {
        const page = await cloudTableApi.query(table.id, { filters, sort, cursor, limit: 100 }, controller.signal)
        for (const r of page.data) { size += encoder.encode(JSON.stringify(r.values)).byteLength; if (size > 16 * 1024 * 1024) throw new Error('本次导出超过16 MiB，请缩小筛选范围或使用API分批导出'); rows.push(r.values) }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      if (controller.signal.aborted) return
      const fields = table.fields.filter(f => !f.archivedAt)
      downloadData(`${table.name}.${format}`, format === 'json' ? JSON.stringify(rows, null, 2) : '\uFEFF' + exportCsv(fields, rows), format === 'json' ? 'application/json' : 'text/csv;charset=utf-8')
    } catch (e) { if (!controller.signal.aborted) toast.danger(e instanceof Error ? e.message : '导出失败') } finally { setExporting(false) }
  }
  return { tables, detail, table, selected, select, listTrash, toggleTrash, nextList, previousList, listHistory, tab, changeTab, records, logs, history, next, previous, query, sort, changeSort, dialog, setDialog, mutation, saveRecord, saveField, archiveField, exportRecords, exporting, fieldInput }
}
export type CloudTablesModel = ReturnType<typeof useCloudTables>
