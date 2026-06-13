import { useEffect, useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, type AdminUserRow, type LiveClientRow } from '@/lib/api'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getLiveClientSummary,
  mergeLiveClientSnapshot,
  upsertLiveClient,
} from './live-client-utils'
import {
  getUsersLiveClientStatusError,
  getUsersTableError,
  getUsersTableLoading,
} from './users-page-error'

export default function UsersPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const [liveClients, setLiveClients] = useState<LiveClientRow[]>([])
  const queryClient = useQueryClient()
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-users', page, pageSize, sortQuery],
    queryFn: () => adminApi.listUsers({ page, pageSize, ...sortQuery }),
  })

  const {
    data: liveClientSnapshot,
    error: liveClientsError,
    isError: isLiveClientsError,
    refetch: refetchLiveClients,
  } = useQuery({
    queryKey: ['admin-live-clients'],
    queryFn: () => adminApi.listLiveClients(),
  })

  useEffect(() => {
    if (liveClientSnapshot) {
      setLiveClients((current) =>
        mergeLiveClientSnapshot(current, liveClientSnapshot)
      )
    }
  }, [liveClientSnapshot])

  useEffect(() => {
    return adminApi.subscribeLiveClients(
      (event) => {
        setLiveClients((current) => upsertLiveClient(current, event))
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ['admin-live-clients'] })
      }
    )
  }, [queryClient])

  const isTableLoading = getUsersTableLoading({
    isUsersError: isError,
    isUsersLoading: isLoading,
  })
  const tableError = getUsersTableError(isError, error)
  const liveClientStatusError = getUsersLiveClientStatusError(
    isLiveClientsError,
    liveClientsError
  )
  const retryTable = () => {
    void refetch()
    void refetchLiveClients()
  }

  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'disabled' }) =>
      adminApi.updateUserStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('用户状态已更新')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleToggle(user: AdminUserRow) {
    const newStatus = user.status === 'active' ? 'disabled' : 'active'
    toggleStatus.mutate({ id: user.id, status: newStatus })
  }

  const columns: ColumnDef<AdminUserRow>[] = [
    {
      accessorKey: 'email',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='邮箱' />
      ),
      cell: ({ row }) => (
        <span className='font-medium'>{row.original.email}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='状态' />
      ),
      cell: ({ row }) => (
        <Badge
          variant={row.original.status === 'active' ? 'default' : 'secondary'}
        >
          {row.original.status === 'active' ? '正常' : '禁用'}
        </Badge>
      ),
    },
    {
      id: 'teams',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='团队' />
      ),
      cell: ({ row }) =>
        row.original.memberships.map((m) => m.team.name).join(', ') || '-',
      enableSorting: false,
    },
    {
      id: 'liveClients',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='客户端' />
      ),
      cell: ({ row }) => {
        const summary = getLiveClientSummary(row.original.id, liveClients, {
          isSnapshotUnavailable: Boolean(liveClientStatusError),
        })

        return (
          <div className='flex flex-wrap items-center gap-2'>
            <Badge
              variant={
                summary.onlineCount > 0
                  ? 'default'
                  : summary.isUnknown
                    ? 'secondary'
                    : 'outline'
              }
            >
              {summary.label}
            </Badge>
            {summary.hasStale ? (
              <Badge variant='secondary'>不稳定</Badge>
            ) : null}
          </div>
        )
      },
      enableSorting: false,
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='创建时间' />
      ),
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleDateString('zh-CN'),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className='flex justify-end gap-2'>
          <Button
            variant='ghost'
            className='h-8 px-2'
            onClick={() => handleToggle(row.original)}
          >
            {row.original.status === 'active' ? '禁用' : '启用'}
          </Button>
        </div>
      ),
      meta: {
        thClassName: 'text-right',
        tdClassName: 'text-right',
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
  const liveClientToolbar = liveClientStatusError ? (
    <div className='flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm'>
      <span className='text-muted-foreground'>客户端状态未知</span>
      <Button variant='outline' size='sm' onClick={retryTable}>
        <RefreshCw className='size-4' />
        重试
      </Button>
    </div>
  ) : null

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>用户管理</h1>
      </Header>
      <Main>
        {isTableLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={data?.data ?? []}
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            toolbar={liveClientToolbar}
            error={tableError}
            onRetry={retryTable}
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
