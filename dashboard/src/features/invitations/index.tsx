import { useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { adminApi, type AdminInvitationRow } from '@/lib/api'
import {
  DataTableColumnHeader,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export default function InvitationsPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const queryClient = useQueryClient()
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-invitations', page, pageSize, sortQuery],
    queryFn: () => adminApi.listInvitations({ page, pageSize, ...sortQuery }),
  })

  const deleteMutation = useMutation({
    mutationFn: adminApi.deleteInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] })
      toast.success('邀请已删除')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: ColumnDef<AdminInvitationRow>[] = [
    {
      accessorKey: 'type',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='类型' />
      ),
    },
    {
      id: 'team',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='团队' />
      ),
      cell: ({ row }) => row.original.team?.name ?? '-',
      enableSorting: false,
    },
    {
      id: 'createdBy',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='创建者' />
      ),
      cell: ({ row }) =>
        row.original.createdByAdmin?.email ??
        row.original.createdByUser?.email ??
        '-',
      enableSorting: false,
    },
    {
      id: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='状态' />
      ),
      cell: ({ row }) => {
        if (row.original.usedAt) return <Badge variant='default'>已使用</Badge>
        if (new Date(row.original.expiresAt) < new Date()) {
          return <Badge variant='secondary'>已过期</Badge>
        }
        return <Badge variant='outline'>有效</Badge>
      },
      enableSorting: false,
    },
    {
      accessorKey: 'expiresAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='过期时间' />
      ),
      cell: ({ row }) =>
        new Date(row.original.expiresAt).toLocaleString('zh-CN'),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <Button
          variant='ghost'
          className='h-8 w-8 p-0'
          onClick={() => deleteMutation.mutate(row.original.id)}
        >
          <Trash2 data-icon='inline-start' />
          <span className='sr-only'>删除</span>
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ]

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>邀请管理</h1>
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
