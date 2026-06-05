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
import { formatModulePermissionSummary } from './module-permissions'
import { UserModulePermissionsSheet } from './user-module-permissions-sheet'
import { useUserModulePermissionsEditor } from './use-user-module-permissions-editor'
import { getUsersTableError } from './users-page-error'

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
  const permissionEditor = useUserModulePermissionsEditor()

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-users', page, pageSize, sortQuery],
    queryFn: () => adminApi.listUsers({ page, pageSize, ...sortQuery }),
  })

  const {
    data: modulePermissionDefinitions = [],
    isLoading: isModulePermissionDefinitionsLoading,
    refetch: refetchModulePermissionDefinitions,
  } = useQuery({
    queryKey: ['admin-module-permissions'],
    queryFn: () => adminApi.listModulePermissions(),
  })
  const isTableLoading = isLoading || isModulePermissionDefinitionsLoading
  const tableError = getUsersTableError(isError, error)
  const retryTable = () => {
    void refetch()
    void refetchModulePermissionDefinitions()
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
      id: 'modulePermissions',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='模块' />
      ),
      cell: ({ row }) =>
        formatModulePermissionSummary(
          row.original.modulePermissions.map((item) => item.permissionKey),
          modulePermissionDefinitions
        ),
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
            onClick={() => void permissionEditor.open(row.original)}
          >
            模块权限
          </Button>
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

  return (
    <>
      <Header>
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
            error={tableError}
            onRetry={retryTable}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sorting={sorting}
            onSortingChange={setSorting}
          />
        )}
        <UserModulePermissionsSheet
          open={permissionEditor.isOpen}
          user={permissionEditor.user}
          definitions={
            permissionEditor.definitions.length > 0
              ? permissionEditor.definitions
              : modulePermissionDefinitions
          }
          permissionKeys={permissionEditor.permissionKeys}
          isLoading={permissionEditor.isLoading}
          isSaving={permissionEditor.isSaving}
          error={permissionEditor.error}
          onClose={permissionEditor.close}
          onRetry={permissionEditor.retry}
          onSave={() => void permissionEditor.save()}
          onToggle={permissionEditor.toggle}
        />
      </Main>
    </>
  )
}
