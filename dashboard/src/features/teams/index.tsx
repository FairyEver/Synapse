import { useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type AdminTeamRow } from '@/lib/api'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'

const columns: ColumnDef<AdminTeamRow>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='团队名称' />
    ),
    cell: ({ row }) => <span className='font-medium'>{row.original.name}</span>,
  },
  {
    id: 'createdBy',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='创建者' />
    ),
    cell: ({ row }) => row.original.createdByUser.email,
    enableSorting: false,
  },
  {
    id: 'members',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='成员数' />
    ),
    cell: ({ row }) => (
      <Badge variant='secondary'>{row.original.memberCount}</Badge>
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='创建时间' />
    ),
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
  },
  {
    id: 'actions',
    cell: () => <span aria-hidden='true' className='block h-8' />,
    enableSorting: false,
    enableHiding: false,
  },
]

export default function TeamsPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-teams', page, pageSize, sortQuery],
    queryFn: () => adminApi.listTeams({ page, pageSize, ...sortQuery }),
  })

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>团队管理</h1>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={data?.data ?? []}
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            error={isError ? error : null}
            onRetry={() => void refetch()}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sorting={sorting}
            onSortingChange={setSorting}
          />
        )}
      </Main>
    </>
  )
}
