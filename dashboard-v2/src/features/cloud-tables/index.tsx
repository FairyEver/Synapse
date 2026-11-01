import { useMemo, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Button, Tabs, toast } from '@heroui/react'
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import type { CloudField, CloudRecordDto } from '@synapse/shared'
import { ServerDataTable } from '@/components/data-table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { RelativeTime } from '@/components/relative-time'
import { useCloudTables, type CloudTablesModel } from './use-cloud-tables'
import { CloudTableDialogs } from './cloud-table-dialogs'
import { CloudInput, CloudSelect } from './cloud-table-controls'
import { fieldInput, parseFieldInput, canChangeRecord } from './cloud-table-forms'
import { useAuthStore } from '@/stores/auth-store'

export default function CloudTablesPage() {
  const session = useAuthStore(s => s.auth.user?.sessionId ?? 'anonymous')
  return <CloudTablesWorkspace key={session} />
}
function CloudTablesWorkspace() {
  const m = useCloudTables(), [recordDelete, setRecordDelete] = useState<CloudRecordDto | null>(null), [fieldArchive, setFieldArchive] = useState<CloudField | null>(null)
  const table = m.table
  const columns = useMemo<ColumnDef<CloudRecordDto>[]>(() => {
    const fields = table?.fields.filter(f => !f.archivedAt) ?? []
    return [
      ...fields.map(f => ({ id: f.key, accessorFn: (r: CloudRecordDto) => fieldInput(r.values[f.key]), enableSorting: !['json', 'multiSelect'].includes(f.type), header: f.name, cell: ({ row }: { row: { original: CloudRecordDto } }) => <span className='block max-w-xs truncate' title={fieldInput(row.original.values[f.key])}>{fieldInput(row.original.values[f.key]) || '—'}</span> })),
      { id: 'createdAt', header: '创建时间', enableSorting: false, cell: ({ row }) => <RelativeTime value={row.original.createdAt} /> },
      { id: 'actions', header: '操作', enableSorting: false, enableHiding: false, cell: ({ row }) => <div className='flex gap-2'>{m.tab === 'trash' ? <Button size='sm' variant='secondary' onPress={() => m.mutation.mutate({ path: `/${table!.id}/records/${row.original.id}/restore`, method: 'POST' })}>恢复</Button> : <>{table && canChangeRecord(table, row.original, 'update') && <Button size='sm' variant='secondary' onPress={() => m.setDialog({ kind: 'record', record: row.original })}>编辑</Button>}{table && canChangeRecord(table, row.original, 'delete') && <Button size='sm' variant='danger-soft' onPress={() => setRecordDelete(row.original)}>删除</Button>}</>}</div> },
    ]
  }, [table, m.tab, m.mutation, m.setDialog])
  const sorted: SortingState = m.sort.map(s => ({ id: s.field, desc: s.direction === 'desc' }))
  function changeSorting(sorting: SortingState) { m.changeSort(sorting.map(s => ({ field: s.id, direction: s.desc ? 'desc' : 'asc' }))) }
  async function deleteRecord() {
    if (!recordDelete || !table) return
    try { await m.mutation.mutateAsync({ path: `/${table.id}/records/${recordDelete.id}`, method: 'DELETE', body: { version: recordDelete.version } }); setRecordDelete(null) } catch { /* mutation displays the error and keeps the confirmation open */ }
  }
  async function archive() { if (!fieldArchive) return; try { await m.archiveField(fieldArchive); setFieldArchive(null) } catch { /* mutation displays the error */ } }
  return <section className='flex min-w-0 flex-1 flex-col gap-5'>
    <div className='flex flex-wrap items-center justify-between gap-3'><div className='flex min-w-0 items-center gap-3'>{m.selected && <Button variant='secondary' isIconOnly aria-label='返回数据表' onPress={() => m.select(null)}><ArrowLeft /></Button>}<h1 className='min-w-0 break-words text-2xl font-semibold'>{table?.name ?? (m.listTrash ? '数据表回收站' : '云端数据表')}</h1></div><div className='flex flex-wrap gap-2'>{!m.selected && <><Button variant='secondary' onPress={() => m.toggleTrash(!m.listTrash)}>{m.listTrash ? '返回数据表' : '回收站'}</Button>{!m.listTrash && <Button onPress={() => m.setDialog({ kind: 'create' })}><Plus />创建数据表</Button>}</>}{table && !m.listTrash && table.permissions.manage !== 'none' && <><Button variant='secondary' onPress={() => m.setDialog({ kind: 'rename' })}>重命名</Button><Button variant='danger-soft' onPress={() => m.setDialog({ kind: 'deleteTable' })}>删除表</Button></>}</div></div>
    {!m.selected ? <>
      <LoadState loading={m.tables.isLoading} error={m.tables.error} retry={() => void m.tables.refetch()} />
      {!m.tables.isLoading && !m.tables.error && !m.tables.data?.data.length && <p className='py-8 text-center text-muted'>暂无数据表</p>}
      <div className='divide-y divide-separator'>{m.tables.data?.data.map(t => <div key={t.id} className='flex flex-wrap items-center justify-between gap-3 py-4'><div className='min-w-0'>{m.listTrash ? <p className='break-words font-medium'>{t.name}</p> : <Button variant='ghost' onPress={() => m.select(t.id)}>{t.name}</Button>}<p className='text-sm text-muted'>{t.permissions.manage === 'none' ? '协作表' : '我管理的表'}</p></div>{m.listTrash && <Button variant='secondary' isPending={m.mutation.isPending} onPress={() => m.mutation.mutate({ path: `/${t.id}/restore`, method: 'POST' })}>恢复</Button>}</div>)}</div>
      <Pager previous={m.previousList} next={() => m.nextList(m.tables.data?.nextCursor)} hasPrevious={Boolean(m.listHistory.length)} hasNext={Boolean(m.tables.data?.nextCursor)} />
    </> : <>
      <LoadState loading={m.detail.isLoading && !m.listTrash} error={m.detail.error} retry={() => void m.detail.refetch()} />
      {table && !m.listTrash && <Tabs selectedKey={m.tab} onSelectionChange={key => m.changeTab(String(key))} variant='secondary'>
        <Tabs.ListContainer><Tabs.List aria-label='数据表管理'>{[{ id: 'records', name: '记录' }, ...(table.permissions.manage !== 'none' ? [{ id: 'fields', name: '字段' }, { id: 'permissions', name: '权限' }, { id: 'trash', name: '回收站' }, { id: 'logs', name: '操作记录' }] : []), { id: 'api', name: 'API' }].map(t => <Tabs.Tab id={t.id} key={t.id}>{t.name}<Tabs.Indicator /></Tabs.Tab>)}</Tabs.List></Tabs.ListContainer>
        <Tabs.Panel id='records' className='space-y-4 pt-4'>
          <div className='flex flex-wrap gap-2'><Button variant='secondary' onPress={() => void m.records.refetch()}><RefreshCw />刷新</Button>{table.permissions.create !== 'none' && <Button onPress={() => m.setDialog({ kind: 'record' })}>新增记录</Button>}{table.permissions.read !== 'none' && <><Button variant='secondary' isPending={m.exporting} onPress={() => void m.exportRecords('json')}>导出 JSON</Button><Button variant='secondary' isPending={m.exporting} onPress={() => void m.exportRecords('csv')}>导出 CSV</Button></>}</div>
          {table.permissions.read === 'none' ? <p className='text-muted'>没有查询权限</p> : <><RecordFilter model={m} /><ServerDataTable columns={columns} data={m.records.data?.data ?? []} page={m.history.length + 1} pageSize={50} total={m.records.data?.data.length ?? 0} onPageChange={() => undefined} onPageSizeChange={() => undefined} showPagination={false} clampPage={false} isLoading={m.records.isLoading} error={m.records.error} onRetry={() => void m.records.refetch()} sorting={sorted} onSortingChange={changeSorting} /><Pager previous={m.previous} next={() => m.next(m.records.data?.nextCursor)} hasPrevious={Boolean(m.history.length)} hasNext={Boolean(m.records.data?.nextCursor)} /></>}
        </Tabs.Panel>
        <Tabs.Panel id='fields' className='space-y-4 pt-4'><Button onPress={() => m.setDialog({ kind: 'field' })}>添加字段</Button><div className='divide-y divide-separator'>{table.fields.map(f => <div key={f.key} className='flex flex-wrap items-center justify-between gap-3 py-3'><div className='min-w-0'><p className='break-words font-medium'>{f.name}{f.archivedAt ? '（已归档）' : ''}</p><p className='break-all text-sm text-muted'>{f.key} · {f.type}{f.required ? ' · 必填' : ''}</p></div><div className='flex gap-2'><Button variant='secondary' onPress={() => m.setDialog({ kind: 'field', field: f })}>{f.archivedAt ? '恢复字段' : '编辑'}</Button>{!f.archivedAt && <Button variant='danger-soft' onPress={() => setFieldArchive(f)}>归档</Button>}</div></div>)}</div></Tabs.Panel>
        <Tabs.Panel id='permissions' className='space-y-4 pt-4'><Button onPress={() => m.setDialog({ kind: 'permissions' })}>编辑权限</Button><p>匿名开放：{Object.entries(table.anonymous).filter(([, yes]) => yes).map(([key]) => ({ read: '查询', create: '新增', update: '修改', delete: '删除' })[key]).join('、') || '无'}</p><div>{table.members?.map(member => <p key={member.userId} className='break-all py-2'>{member.handle ?? member.userId}</p>)}</div></Tabs.Panel>
        <Tabs.Panel id='trash' className='space-y-4 pt-4'><ServerDataTable columns={columns} data={m.records.data?.data ?? []} page={1} pageSize={50} total={0} onPageChange={() => undefined} onPageSizeChange={() => undefined} showPagination={false} clampPage={false} isLoading={m.records.isLoading} error={m.records.error} /><Pager previous={m.previous} next={() => m.next(m.records.data?.nextCursor)} hasPrevious={Boolean(m.history.length)} hasNext={Boolean(m.records.data?.nextCursor)} /></Tabs.Panel>
        <Tabs.Panel id='logs' className='space-y-4 pt-4'><LoadState loading={m.logs.isLoading} error={m.logs.error} retry={() => void m.logs.refetch()} /><div className='divide-y divide-separator'>{m.logs.data?.data.map(log => <div key={log.id} className='flex flex-wrap justify-between gap-3 py-3 text-sm'><span>{log.operation} · {log.status} · {log.durationMs} ms</span><code className='break-all'>{log.requestId}</code><RelativeTime value={log.createdAt} /></div>)}</div><Pager previous={m.previous} next={() => m.next(m.logs.data?.nextCursor)} hasPrevious={Boolean(m.history.length)} hasNext={Boolean(m.logs.data?.nextCursor)} /></Tabs.Panel>
        <Tabs.Panel id='api' className='space-y-4 pt-4'><p className='break-all font-mono'>/api/open/v1/tables/{table.id}</p><p className='break-all font-mono'>/api/open/v1/tables/{table.id}/schema</p><pre className='overflow-x-auto rounded-lg bg-surface p-4 text-sm'>{`curl "$SY_API_BASE_URL/api/open/v1/tables/${table.id}/records/query" \\\n  -H "Authorization: Bearer $SY_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"limit":50}'`}</pre><a className='text-accent underline' href='/document/open-api/api/cloud-tables' target='_blank' rel='noreferrer'>API 文档</a></Tabs.Panel>
      </Tabs>}
    </>}
    <CloudTableDialogs key={JSON.stringify(m.dialog)} model={m} />
    <ConfirmDialog open={Boolean(recordDelete)} onOpenChange={open => !open && setRecordDelete(null)} title='删除记录' desc='删除后保留30天，仅表主可恢复。' confirmText='删除' destructive isLoading={m.mutation.isPending} handleConfirm={() => void deleteRecord()} />
    <ConfirmDialog open={Boolean(fieldArchive)} onOpenChange={open => !open && setFieldArchive(null)} title='归档字段' desc='归档后不再通过 API 读写，30天内可恢复。' confirmText='归档' destructive isLoading={m.mutation.isPending} handleConfirm={() => void archive()} />
  </section>
}
function LoadState({ loading, error, retry }: { loading: boolean; error: unknown; retry: () => void }) { return loading ? <p className='text-muted'>加载中…</p> : error ? <div role='alert' className='space-y-3'><p>{error instanceof Error ? error.message : '加载失败'}</p><Button variant='secondary' onPress={retry}>重试</Button></div> : null }
function Pager({ previous, next, hasPrevious, hasNext }: { previous: () => void; next: () => void; hasPrevious: boolean; hasNext: boolean }) { return <div className='flex justify-end gap-3'><Button variant='secondary' isDisabled={!hasPrevious} onPress={previous}>上一页</Button><Button variant='secondary' isDisabled={!hasNext} onPress={next}>下一页</Button></div> }
function RecordFilter({ model: m }: { model: CloudTablesModel }) {
  const fields = m.table!.fields.filter(f => !f.archivedAt && !['json', 'multiSelect'].includes(f.type))
  const [field, setField] = useState(fields[0]?.key ?? ''), [op, setOp] = useState('eq'), [value, setValue] = useState('')
  function apply() { try { const f = fields.find(f => f.key === field); if (!f) return; m.query([{ field, op, value: parseFieldInput(f.type, value) }], m.sort) } catch (e) { toast.danger(e instanceof Error ? e.message : '筛选条件无效') } }
  if (!fields.length) return null
  return <div className='flex flex-wrap items-end gap-3'><div className='min-w-0 flex-1'><CloudSelect label='筛选字段' value={field} onChange={setField} items={fields.map(f => ({ key: f.key, name: f.name }))} /></div><div className='min-w-0 flex-1'><CloudSelect label='条件' value={op} onChange={setOp} items={[{ key: 'eq', name: '等于' }, { key: 'ne', name: '不等于' }, { key: 'contains', name: '包含' }, { key: 'gt', name: '大于' }, { key: 'lt', name: '小于' }]} /></div><div className='min-w-0 flex-1'><CloudInput label='值' value={value} onChange={setValue} /></div><Button variant='secondary' onPress={apply}>筛选</Button><Button variant='secondary' onPress={() => { setValue(''); m.query([], m.sort) }}>清除</Button></div>
}
