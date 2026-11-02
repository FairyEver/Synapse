import { useMemo, useState, type ComponentProps } from 'react'
import type { ColumnDef, HeaderContext, SortingState } from '@tanstack/react-table'
import { Button, Card, Chip, Link, Pagination, Tabs, toast } from '@heroui/react'
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import type { CloudField, CloudRecordDto, CloudTableDto, CloudTableSummary } from '@synapse/shared'
import { DataTableColumnHeader, ServerDataTable } from '@/components/data-table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'
import { useAuthStore } from '@/stores/auth-store'
import { useCloudTables, type CloudTablesModel } from './use-cloud-tables'
import { CloudTableDialogs } from './cloud-table-dialogs'
import { CloudInput, CloudSelect } from './cloud-table-controls'
import { fieldInput, fieldTypes, filterOperators, parseFieldInput, canChangeRecord } from './cloud-table-forms'

const actions = [
  { key: 'read', name: '查看' },
  { key: 'create', name: '新增' },
  { key: 'update', name: '修改' },
  { key: 'delete', name: '删除' },
] as const
const ranges = { none: '不允许', own: '仅本人创建的记录', all: '全部记录' }
const noPageChange = () => undefined

export default function CloudTablesPage() {
  const session = useAuthStore(s => s.auth.user?.sessionId ?? 'anonymous')
  return <CloudTablesWorkspace key={session} />
}

function CloudTablesWorkspace() {
  const m = useCloudTables()
  const [recordDelete, setRecordDelete] = useState<CloudRecordDto | null>(null)
  const [fieldArchive, setFieldArchive] = useState<CloudField | null>(null)
  const table = m.table
  const title = table?.name ?? (m.listTrash ? '数据表回收站' : '云端数据表')

  async function deleteRecord() {
    if (!recordDelete || !table) return
    try {
      await m.mutation.mutateAsync({ path: `/${table.id}/records/${recordDelete.id}`, method: 'DELETE', body: { version: recordDelete.version } })
      setRecordDelete(null)
    } catch { /* mutation displays the error and keeps the confirmation open */ }
  }

  async function archive() {
    if (!fieldArchive) return
    try {
      await m.archiveField(fieldArchive)
      setFieldArchive(null)
    } catch { /* mutation displays the error */ }
  }

  return <>
    <Header>
      {m.selected && <Button variant='ghost' isIconOnly aria-label='返回数据表' onPress={() => m.select(null)}><ArrowLeft /></Button>}
      <h1 className='min-w-0 truncate' title={title}>{title}</h1>
    </Header>
    <Main className='min-w-0'>
      {!m.selected ? <TableList model={m} /> : <>
        <LoadState loading={m.detail.isLoading} error={m.detail.error} retry={() => void m.detail.refetch()} />
        {table && <>
          {table.permissions.manage !== 'none' && <div className='flex flex-wrap justify-end gap-2'>
            <Button variant='secondary' onPress={() => m.setDialog({ kind: 'rename' })}>重命名</Button>
            <Button variant='danger-soft' onPress={() => m.setDialog({ kind: 'deleteTable' })}>删除表</Button>
          </div>}
          <Tabs selectedKey={m.tab} onSelectionChange={key => m.changeTab(String(key))}>
            <Tabs.ListContainer className='w-fit max-w-full overflow-x-auto'>
              <Tabs.List aria-label='数据表管理' className='w-max'>
                <Tabs.Tab className='whitespace-nowrap' id='records'>记录<Tabs.Indicator /></Tabs.Tab>
                {table.permissions.manage !== 'none' && <>
                  <Tabs.Tab className='whitespace-nowrap' id='fields'>字段<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab className='whitespace-nowrap' id='permissions'>权限<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab className='whitespace-nowrap' id='trash'>回收站<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab className='whitespace-nowrap' id='logs'>操作记录<Tabs.Indicator /></Tabs.Tab>
                </>}
                <Tabs.Tab className='whitespace-nowrap' id='api'>API<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel id='records'>
              <Records model={m} table={table} onDelete={setRecordDelete} />
            </Tabs.Panel>
            <Tabs.Panel id='fields'>
              <Fields model={m} table={table} onArchive={setFieldArchive} />
            </Tabs.Panel>
            <Tabs.Panel id='permissions'><Permissions model={m} table={table} /></Tabs.Panel>
            <Tabs.Panel id='trash'><Records model={m} table={table} onDelete={setRecordDelete} /></Tabs.Panel>
            <Tabs.Panel id='logs'><OperationLogs model={m} /></Tabs.Panel>
            <Tabs.Panel id='api'><ApiAccess table={table} /></Tabs.Panel>
          </Tabs>
        </>}
      </>}
      <CloudTableDialogs key={JSON.stringify(m.dialog)} model={m} />
      <ConfirmDialog open={Boolean(recordDelete)} onOpenChange={open => !open && setRecordDelete(null)} title='删除记录' desc='删除后保留30天，仅表主可恢复。' confirmText='删除' destructive isLoading={m.mutation.isPending} handleConfirm={() => void deleteRecord()} />
      <ConfirmDialog open={Boolean(fieldArchive)} onOpenChange={open => !open && setFieldArchive(null)} title='归档字段' desc='归档后不再通过 API 读写，30天内可恢复。' confirmText='归档' destructive isLoading={m.mutation.isPending} handleConfirm={() => void archive()} />
    </Main>
  </>
}

/** Cursor lists share the Console table without inventing a total or numbered pages. */
function CloudDataTable<T>({ columns, data, ...props }: Omit<ComponentProps<typeof ServerDataTable<T, unknown>>, 'page' | 'pageSize' | 'total' | 'onPageChange' | 'onPageSizeChange'>) {
  return <ServerDataTable columns={columns} data={data} page={1} pageSize={50} total={data.length} onPageChange={noPageChange} onPageSizeChange={noPageChange} showPagination={false} clampPage={false} {...props} />
}

function TableList({ model: m }: { model: CloudTablesModel }) {
  const columns: ColumnDef<CloudTableSummary>[] = [
    {
      id: 'name', header: '表名称', meta: { label: '表名称' }, enableSorting: false,
      cell: ({ row }) => m.listTrash
        ? <span className='block max-w-xs truncate font-medium' title={row.original.name}>{row.original.name}</span>
        : <Button variant='ghost' className='max-w-xs justify-start' onPress={() => m.select(row.original.id)}><span className='truncate'>{row.original.name}</span></Button>,
    },
    { id: 'role', header: '我的角色', meta: { label: '我的角色' }, enableSorting: false, cell: ({ row }) => <Chip variant='soft'>{row.original.permissions.manage === 'none' ? '协作者' : '表主'}</Chip> },
    { id: 'createdAt', header: '创建时间', meta: { label: '创建时间' }, enableSorting: false, cell: ({ row }) => <RelativeTime value={row.original.createdAt} /> },
    ...(m.listTrash ? [{ id: 'actions', header: '操作', enableSorting: false, enableHiding: false, cell: ({ row }: { row: { original: CloudTableSummary } }) => <Button size='sm' variant='secondary' isPending={m.mutation.isPending} onPress={() => m.mutation.mutate({ path: `/${row.original.id}/restore`, method: 'POST' })}>恢复</Button> }] : []),
  ]
  return <div className='space-y-4'>
    <CloudDataTable columns={columns} data={m.tables.data?.data ?? []} isLoading={m.tables.isLoading} error={m.tables.error} onRetry={() => void m.tables.refetch()} emptyMessage={m.listTrash ? '回收站为空' : '暂无数据表'} toolbar={
      <div className='flex flex-wrap items-center justify-end gap-2'>
        <Button variant='secondary' onPress={() => m.toggleTrash(!m.listTrash)}>{m.listTrash ? '返回数据表' : '回收站'}</Button>
        {!m.listTrash && <Button onPress={() => m.setDialog({ kind: 'create' })}><Plus />创建数据表</Button>}
      </div>
    } />
    <CursorPager previous={m.previousList} next={() => m.nextList(m.tables.data?.nextCursor)} hasPrevious={Boolean(m.listHistory.length)} hasNext={Boolean(m.tables.data?.nextCursor)} />
  </div>
}

function Records({ model: m, table, onDelete }: { model: CloudTablesModel; table: CloudTableDto; onDelete: (record: CloudRecordDto) => void }) {
  const trash = m.tab === 'trash'
  const columns = useMemo<ColumnDef<CloudRecordDto>[]>(() => [
    ...table.fields.filter(f => !f.archivedAt).map(f => ({
      id: f.key,
      accessorFn: (record: CloudRecordDto) => fieldInput(record.values[f.key]),
      meta: { label: f.name, ...(['integer', 'number'].includes(f.type) ? { className: 'text-right tabular-nums' } : {}) },
      enableSorting: !trash && !['json', 'multiSelect'].includes(f.type),
      header: ({ column }: HeaderContext<CloudRecordDto, unknown>) => <DataTableColumnHeader column={column} title={f.name} />,
      cell: ({ row }: { row: { original: CloudRecordDto } }) => <span className='block max-w-xs truncate' title={fieldInput(row.original.values[f.key])}>{fieldInput(row.original.values[f.key]) || '—'}</span>,
    })),
    { id: '$createdAt', header: '创建时间', meta: { label: '创建时间' }, enableSorting: false, cell: ({ row }) => <RelativeTime value={row.original.createdAt} /> },
    {
      id: '$actions', header: '操作', enableSorting: false, enableHiding: false,
      cell: ({ row }) => <div className='flex gap-2'>
        {trash ? <Button size='sm' variant='secondary' isPending={m.mutation.isPending} onPress={() => m.mutation.mutate({ path: `/${table.id}/records/${row.original.id}/restore`, method: 'POST' })}>恢复</Button> : <>
          {canChangeRecord(table, row.original, 'update') && <Button size='sm' variant='secondary' onPress={() => m.setDialog({ kind: 'record', record: row.original })}>编辑</Button>}
          {canChangeRecord(table, row.original, 'delete') && <Button size='sm' variant='danger-soft' onPress={() => onDelete(row.original)}>删除</Button>}
        </>}
      </div>,
    },
  ], [table, trash, m.mutation, m.setDialog, onDelete])
  const sorted: SortingState = m.sort.map(s => ({ id: s.field, desc: s.direction === 'desc' }))
  function changeSorting(sorting: SortingState) {
    m.changeSort(sorting.map(s => ({ field: s.id, direction: s.desc ? 'desc' : 'asc' })))
  }

  return <div className='space-y-4'>
    {!trash && <div className='flex flex-wrap items-center justify-between gap-2'>
      <Button variant='secondary' onPress={() => void m.records.refetch()}><RefreshCw />刷新</Button>
      <div className='flex flex-wrap gap-2'>
        {table.permissions.read !== 'none' && <>
          <Button variant='secondary' isPending={m.exporting} onPress={() => void m.exportRecords('json')}>导出 JSON</Button>
          <Button variant='secondary' isPending={m.exporting} onPress={() => void m.exportRecords('csv')}>导出 CSV</Button>
        </>}
        {table.permissions.create !== 'none' && <Button onPress={() => m.setDialog({ kind: 'record' })}><Plus />新增记录</Button>}
      </div>
    </div>}
    {!trash && table.permissions.read === 'none' ? <p className='text-muted'>没有查询权限</p> : <>
      <CloudDataTable columns={columns} data={m.records.data?.data ?? []} isLoading={m.records.isLoading} error={m.records.error} onRetry={() => void m.records.refetch()} sorting={sorted} onSortingChange={trash ? undefined : changeSorting} toolbar={trash ? undefined : <RecordFilter key={table.schemaVersion} model={m} />} emptyMessage={trash ? '回收站为空' : '暂无记录'} />
      <CursorPager previous={m.previous} next={() => m.next(m.records.data?.nextCursor)} hasPrevious={Boolean(m.history.length)} hasNext={Boolean(m.records.data?.nextCursor)} />
    </>}
  </div>
}

function Fields({ model: m, table, onArchive }: { model: CloudTablesModel; table: CloudTableDto; onArchive: (field: CloudField) => void }) {
  const columns: ColumnDef<CloudField>[] = [
    { id: 'name', header: '字段名称', meta: { label: '字段名称' }, cell: ({ row }) => <span className='block max-w-xs truncate font-medium' title={row.original.name}>{row.original.name}</span> },
    { accessorKey: 'key', header: 'API 标识', meta: { label: 'API 标识' }, cell: ({ row }) => <code>{row.original.key}</code> },
    { id: 'type', header: '类型', meta: { label: '类型' }, cell: ({ row }) => fieldTypes.find(t => t.key === row.original.type)?.name },
    { id: 'required', header: '必填', meta: { label: '必填' }, cell: ({ row }) => row.original.required ? '是' : '否' },
    { id: 'status', header: '状态', meta: { label: '状态' }, cell: ({ row }) => <Chip variant='soft'>{row.original.archivedAt ? '已归档' : '使用中'}</Chip> },
    { id: 'actions', header: '操作', enableHiding: false, cell: ({ row }) => <div className='flex gap-2'>
      <Button size='sm' variant='secondary' onPress={() => m.setDialog({ kind: 'field', field: row.original })}>{row.original.archivedAt ? '恢复字段' : '编辑'}</Button>
      {!row.original.archivedAt && <Button size='sm' variant='danger-soft' onPress={() => onArchive(row.original)}>归档</Button>}
    </div> },
  ]
  return <CloudDataTable columns={columns} data={table.fields} emptyMessage='暂无字段' toolbar={<Button onPress={() => m.setDialog({ kind: 'field' })}><Plus />添加字段</Button>} />
}

function Permissions({ model: m, table }: { model: CloudTablesModel; table: CloudTableDto }) {
  type PermissionRow = { id: string; name: string; read: string; create: string; update: string; delete: string }
  const data: PermissionRow[] = [
    { id: 'anonymous', name: '无需登录的访问', ...Object.fromEntries(actions.map(a => [a.key, table.anonymous[a.key] ? (a.key === 'create' ? '允许新增' : '全部记录') : '不允许'])) } as PermissionRow,
    ...(table.members ?? []).map(member => ({ id: member.userId, name: member.handle ?? member.userId, ...Object.fromEntries(actions.map(a => [a.key, a.key === 'create' && member.permissions.create === 'all' ? '允许新增' : ranges[member.permissions[a.key] ?? 'none']])) }) as PermissionRow),
  ]
  const columns: ColumnDef<PermissionRow>[] = [
    { accessorKey: 'name', header: '访问者', enableHiding: false, cell: ({ row }) => <span className='block max-w-xs truncate' title={row.original.name}>{row.original.name}</span> },
    ...actions.map(a => ({ accessorKey: a.key, header: a.name, enableHiding: false })),
  ]
  return <CloudDataTable columns={columns} data={data} toolbar={<Button onPress={() => m.setDialog({ kind: 'permissions' })}>编辑权限</Button>} />
}

function OperationLogs({ model: m }: { model: CloudTablesModel }) {
  type Log = NonNullable<typeof m.logs.data>['data'][number]
  const columns: ColumnDef<Log>[] = [
    { accessorKey: 'operation', header: '操作', meta: { label: '操作' } },
    { accessorKey: 'status', header: '状态码', meta: { label: '状态码', className: 'text-right tabular-nums' } },
    { accessorKey: 'durationMs', header: '耗时（ms）', meta: { label: '耗时', className: 'text-right tabular-nums' } },
    { accessorKey: 'requestId', header: '请求 ID', meta: { label: '请求 ID' }, cell: ({ row }) => <code>{row.original.requestId}</code> },
    { id: 'createdAt', header: '时间', meta: { label: '时间' }, cell: ({ row }) => <RelativeTime value={row.original.createdAt} /> },
  ]
  return <div className='space-y-4'>
    <CloudDataTable columns={columns} data={m.logs.data?.data ?? []} isLoading={m.logs.isLoading} error={m.logs.error} onRetry={() => void m.logs.refetch()} emptyMessage='暂无操作记录' />
    <CursorPager previous={m.previous} next={() => m.next(m.logs.data?.nextCursor)} hasPrevious={Boolean(m.history.length)} hasNext={Boolean(m.logs.data?.nextCursor)} />
  </div>
}

function ApiAccess({ table }: { table: CloudTableDto }) {
  const example = `curl "$SY_API_BASE_URL/api/open/v1/tables/${table.id}/records/query" \\\n  -H "Authorization: Bearer $SY_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"limit":50}'`
  return <Card>
    <Card.Header><Card.Title>API 接入</Card.Title></Card.Header>
    <Card.Content className='space-y-4'>
      <dl className='space-y-3 text-sm'>
        <div><dt className='text-muted'>数据表</dt><dd className='break-all font-mono'>/api/open/v1/tables/{table.id}</dd></div>
        <div><dt className='text-muted'>字段结构</dt><dd className='break-all font-mono'>/api/open/v1/tables/{table.id}/schema</dd></div>
      </dl>
      <pre className='overflow-x-auto text-sm'><code>{example}</code></pre>
    </Card.Content>
    <Card.Footer><Link href='/document/open-api/api/cloud-tables' target='_blank' rel='noreferrer'>API 文档<Link.Icon /></Link></Card.Footer>
  </Card>
}

function LoadState({ loading, error, retry }: { loading: boolean; error: unknown; retry: () => void }) {
  if (loading) return <p role='status' className='text-muted'>加载中…</p>
  if (!error) return null
  return <div role='alert' className='space-y-3'><p>{error instanceof Error ? error.message : '加载失败'}</p><Button variant='secondary' onPress={retry}>重试</Button></div>
}

function CursorPager({ previous, next, hasPrevious, hasNext }: { previous: () => void; next: () => void; hasPrevious: boolean; hasNext: boolean }) {
  return <Pagination className='justify-end' aria-label='游标分页'>
    <Pagination.Content>
      <Pagination.Item><Pagination.Previous isDisabled={!hasPrevious} onPress={previous}><Pagination.PreviousIcon /><span>上一页</span></Pagination.Previous></Pagination.Item>
      <Pagination.Item><Pagination.Next isDisabled={!hasNext} onPress={next}><span>下一页</span><Pagination.NextIcon /></Pagination.Next></Pagination.Item>
    </Pagination.Content>
  </Pagination>
}

function RecordFilter({ model: m }: { model: CloudTablesModel }) {
  const fields = m.table!.fields.filter(f => !f.archivedAt && !['json', 'multiSelect'].includes(f.type))
  const [field, setField] = useState(fields[0]?.key ?? '')
  const [op, setOp] = useState('eq')
  const [value, setValue] = useState('')
  function apply() {
    try {
      const f = fields.find(f => f.key === field)
      if (f) m.query([{ field, op, value: parseFieldInput(f.type, value) }], m.sort)
    } catch (e) { toast.danger(e instanceof Error ? e.message : '筛选条件无效') }
  }
  if (!fields.length) return null
  return <div className='grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4'>
    <CloudSelect label='筛选字段' value={field} onChange={key => { setField(key); setOp('eq'); setValue('') }} items={fields.map(f => ({ key: f.key, name: f.name }))} variant='primary' />
    <CloudSelect label='条件' value={op} onChange={setOp} items={filterOperators(fields.find(f => f.key === field)?.type)} variant='primary' />
    <CloudInput label='值' value={value} onChange={setValue} variant='primary' />
    <div className='flex flex-wrap gap-2'><Button variant='secondary' onPress={apply}>筛选</Button><Button variant='ghost' onPress={() => { setValue(''); m.query([], m.sort) }}>清除</Button></div>
  </div>
}
