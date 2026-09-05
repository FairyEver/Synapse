import { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { Eye, RotateCcw, ShieldBan, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { LongText } from '@/components/long-text'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDriveBytes } from '@/features/drive'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { adminApi, type AdminDocumentHostedImageRow } from '@/lib/api'

export function AdminDocumentImages() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [deleteTarget, setDeleteTarget] = useState<AdminDocumentHostedImageRow | null>(null)
  const listQuery = {
    page,
    pageSize,
    search: debouncedSearch.trim() || undefined,
    ...getServerTableSortQuery(sorting),
  }
  const images = useQuery({
    queryKey: ['admin-document-images', listQuery],
    queryFn: () => adminApi.listDocumentImages(listQuery),
    placeholderData: keepPreviousData,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-document-images'] })
  const quarantine = useMutation({
    mutationFn: adminApi.quarantineDocumentImage,
    onSuccess: () => { toast.success('已隔离'); void refresh() },
    onError: (error: Error) => toast.error(error.message),
  })
  const restore = useMutation({
    mutationFn: adminApi.restoreDocumentImage,
    onSuccess: () => { toast.success('已恢复'); void refresh() },
    onError: (error: Error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: adminApi.deleteDocumentImage,
    onSuccess: () => { setDeleteTarget(null); toast.success('已删除'); void refresh() },
    onError: (error: Error) => toast.error(error.message),
  })
  const columns = useMemo<ColumnDef<AdminDocumentHostedImageRow>[]>(() => [
    {
      accessorKey: 'originalName',
      id: 'originalName',
      header: ({ column }) => <DataTableColumnHeader column={column} title='名称' />,
      cell: ({ row }) => (
        <div className='min-w-0'>
          <div className='truncate font-medium'>{row.original.name}</div>
          <div className='truncate text-sm text-muted-foreground'>{row.original.imageId}</div>
        </div>
      ),
      meta: { className: 'max-w-0 w-1/3' },
    },
    {
      id: 'source',
      header: '来源',
      enableSorting: false,
      cell: ({ row }) => <LongText>{row.original.uploaderEmail ?? row.original.sourceItemName ?? '-'}</LongText>,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title='状态' />,
      cell: ({ row }) => <Badge variant={row.original.status === 'active' ? 'default' : 'secondary'}>{documentImageStatusLabel(row.original.status)}</Badge>,
      meta: { className: 'w-24' },
    },
    {
      accessorKey: 'size',
      header: ({ column }) => <DataTableColumnHeader column={column} title='大小' />,
      cell: ({ row }) => <div className='text-right tabular-nums'>{formatDriveBytes(row.original.size)}</div>,
      meta: { className: 'w-24', thClassName: 'text-right', tdClassName: 'text-right' },
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title='上传时间' />,
      cell: ({ row }) => <RelativeTime className='tabular-nums' value={row.original.createdAt} />,
      meta: { className: 'w-36' },
    },
    {
      id: 'actions',
      header: () => <div className='text-right'>操作</div>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className='flex justify-end gap-1'>
          <Button type='button' variant='ghost' size='icon' className='size-8' aria-label='打开图片' onClick={() => window.open(adminApi.documentImageOpenUrl(row.original.imageId), '_blank', 'noopener,noreferrer')}>
            <Eye />
          </Button>
          {row.original.status === 'quarantined' ? (
            <>
              <Button type='button' variant='ghost' size='icon' className='size-8' aria-label='恢复图片' disabled={restore.isPending} onClick={() => restore.mutate(row.original.imageId)}><RotateCcw /></Button>
              <Button type='button' variant='ghost' size='icon' className='size-8' aria-label='删除图片' disabled={remove.isPending} onClick={() => setDeleteTarget(row.original)}><Trash2 /></Button>
            </>
          ) : (
            <Button type='button' variant='ghost' size='icon' className='size-8' aria-label='隔离图片' disabled={quarantine.isPending || row.original.status === 'delete_pending'} onClick={() => quarantine.mutate(row.original.imageId)}><ShieldBan /></Button>
          )}
        </div>
      ),
      meta: { className: 'w-32', thClassName: 'text-right', tdClassName: 'text-right' },
    },
  ], [quarantine, remove.isPending, restore])

  return (
    <>
      <ServerDataTable
        columns={columns}
        data={images.data?.data ?? []}
        page={page}
        pageSize={pageSize}
        total={images.data?.total ?? 0}
        error={images.isError ? images.error : null}
        onRetry={() => void images.refetch()}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        sorting={sorting}
        onSortingChange={setSorting}
        isLoading={images.isLoading}
        toolbar={<Input placeholder='按名称、ID 或上传者筛选...' value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} className='h-8 w-64' />}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        contentProps={{ 'data-drive-telemetry-scope': 'portal' }}
        onOpenChange={(open) => { if (!open && !remove.isPending) setDeleteTarget(null) }}
        title='永久删除图片'
        desc={deleteTarget ? `永久删除「${deleteTarget.name}」？` : ''}
        confirmText='删除'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => { if (deleteTarget) remove.mutate(deleteTarget.imageId) }}
      />
    </>
  )
}

function documentImageStatusLabel(status: AdminDocumentHostedImageRow['status']) {
  return { temporary: '临时', active: '正常', quarantined: '已隔离', delete_pending: '删除中' }[status]
}
