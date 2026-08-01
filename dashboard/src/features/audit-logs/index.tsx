import { useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, type AuditLog } from '@/lib/api'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { LongText } from '@/components/long-text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const columns: ColumnDef<AuditLog>[] = [
  {
    accessorKey: 'action',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='操作' />
    ),
    cell: ({ row }) => (
      <LongText className='font-medium'>{row.original.action}</LongText>
    ),
    meta: { className: 'max-w-0 w-1/4' },
  },
  {
    accessorKey: 'actorLabel',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='主体' />
    ),
    cell: ({ row }) => (
      <LongText className='max-w-40'>{row.original.actorLabel}</LongText>
    ),
    meta: { className: 'w-40' },
  },
  {
    id: 'target',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='目标' />
    ),
    cell: ({ row }) => (
      <LongText>{`${row.original.targetType}:${row.original.targetId}`}</LongText>
    ),
    enableSorting: false,
    meta: { className: 'max-w-0 w-1/4' },
  },
  {
    accessorKey: 'ipAddress',
    header: ({ column }) => <DataTableColumnHeader column={column} title='IP' />,
    enableSorting: false,
    meta: { className: 'w-36' },
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='时间' />
    ),
    cell: ({ row }) => (
      <span className='tabular-nums'>
        {new Date(row.original.createdAt).toLocaleString('zh-CN')}
      </span>
    ),
    meta: { className: 'w-44' },
  },
  {
    id: 'actions',
    cell: () => <span aria-hidden='true' className='block h-8' />,
    enableSorting: false,
    enableHiding: false,
    meta: { className: 'w-8' },
  },
]

export default function AuditLogsPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [action, setAction] = useState('')
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-audit-logs', page, pageSize, action, sortQuery],
    queryFn: () =>
      adminApi.listAuditLogs({
        page,
        pageSize,
        action: action || undefined,
        ...sortQuery,
      }),
  })

  async function handleExport() {
    try {
      await adminApi.exportAuditLogs({ action: action || undefined })
      toast.success('导出成功')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    }
  }

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>审计日志</h1>
      </Header>
      <Main>
        <ServerDataTable
          columns={columns}
          data={data?.data ?? []}
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          error={isError ? error : null}
          isLoading={isLoading}
          loadingRowCount={Math.min(pageSize, DEFAULT_DASHBOARD_PAGE_SIZE)}
          onRetry={() => void refetch()}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          sorting={sorting}
          onSortingChange={setSorting}
          toolbar={
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='flex min-w-0 flex-1 items-center gap-2'>
                <Input
                  placeholder='按操作类型筛选...'
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value)
                    setPage(1)
                  }}
                  className='h-8 w-37.5 lg:w-62.5'
                />
              </div>
              <Button variant='outline' size='sm' onClick={handleExport}>
                <Download data-icon='inline-start' />
                导出
              </Button>
            </div>
          }
        />
      </Main>
    </>
  )
}
