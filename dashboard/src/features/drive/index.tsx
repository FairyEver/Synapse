import { useMemo, useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, type AdminDriveItemRow } from '@/lib/api'
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

export default function DriveAdminPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const queryClient = useQueryClient()
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-drive-items', page, pageSize, sortQuery],
    queryFn: () => adminApi.listDriveItems({ page, pageSize, ...sortQuery }),
  })

  const deleteMutation = useMutation({
    mutationFn: adminApi.deleteDriveItem,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-drive-items'] })
      toast.success('已删除')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns = useMemo<ColumnDef<AdminDriveItemRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='名称' />
        ),
        cell: ({ row }) => <DriveItemName item={row.original} />,
      },
      {
        id: 'user',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='用户' />
        ),
        cell: ({ row }) => row.original.userEmail ?? row.original.userId,
        enableSorting: false,
      },
      {
        accessorKey: 'type',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='类型' />
        ),
        cell: ({ row }) => (
          <Badge variant='outline'>{driveItemTypeLabel(row.original.type)}</Badge>
        ),
        enableSorting: false,
      },
      {
        accessorKey: 'storageStatus',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='状态' />
        ),
        cell: ({ row }) => (
          <Badge variant={row.original.storageStatus === 'active' ? 'default' : 'secondary'}>
            {driveStatusLabel(row.original.storageStatus)}
          </Badge>
        ),
      },
      {
        accessorKey: 'size',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='大小' />
        ),
        cell: ({ row }) => (
          <div className='text-right'>
            {row.original.type === 'folder' ? '-' : formatDriveBytes(row.original.size)}
          </div>
        ),
      },
      {
        id: 'shared',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='分享' />
        ),
        cell: ({ row }) => (
          <Badge variant={row.original.shared ? 'secondary' : 'outline'}>
            {row.original.shared ? '已分享' : '未分享'}
          </Badge>
        ),
        enableSorting: false,
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='上传时间' />
        ),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString('zh-CN'),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className='flex justify-end'>
            <Button
              variant='ghost'
              className='h-8 w-8 p-0'
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (window.confirm(`删除「${row.original.name}」？`)) {
                  deleteMutation.mutate(row.original.id)
                }
              }}
            >
              <Trash2 data-icon='inline-start' />
              <span className='sr-only'>删除</span>
            </Button>
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [deleteMutation]
  )

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>云盘</h1>
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

function DriveItemName({ item }: { readonly item: AdminDriveItemRow }) {
  return (
    <div className='min-w-0'>
      <div className='truncate font-medium'>{item.name}</div>
      <div className='truncate text-sm text-muted-foreground'>{item.id}</div>
    </div>
  )
}

export function driveItemTypeLabel(type: AdminDriveItemRow['type']) {
  return type === 'folder' ? '文件夹' : '文件'
}

export function driveStatusLabel(status: AdminDriveItemRow['storageStatus']) {
  const labels: Record<AdminDriveItemRow['storageStatus'], string> = {
    pending: '上传中',
    active: '正常',
    delete_pending: '删除中',
    deleted: '已删除',
    failed: '失败',
  }
  return labels[status]
}

export function formatDriveBytes(value: string) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
