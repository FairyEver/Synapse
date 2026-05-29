import { useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { adminApi, type AdminUserRow } from '@/lib/api'
import {
  DataTableColumnHeader,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const pageSizeOptions = {
  initial: 20,
}

export default function UsersPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(pageSizeOptions.initial)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const queryClient = useQueryClient()
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', page, pageSize, sortQuery],
    queryFn: () => adminApi.listUsers({ page, pageSize, ...sortQuery }),
  })

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
        <Button
          variant='ghost'
          className='h-8 px-2'
          onClick={() => handleToggle(row.original)}
        >
          {row.original.status === 'active' ? '禁用' : '启用'}
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ]

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>用户管理</h1>
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
