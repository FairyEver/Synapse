import { useMemo, useState } from 'react'
import { formatBytes } from '@synapse/shared'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, type AdminDriveItemRow } from '@/lib/api'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { LongText } from '@/components/long-text'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdminDriveStorageSummary } from '@/features/drive-browser/admin-drive-storage-summary'
import { AdminPublicAssets } from '@/features/drive-browser/admin-public-assets'

const allTypesValue = 'all'
const allSharedValue = 'all'
const allStatusesValue = 'all'

export default function DriveAdminPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [userId, setUserId] = useState('')
  const [type, setType] = useState<AdminDriveItemRow['type'] | ''>('')
  const [shared, setShared] = useState<'true' | 'false' | ''>('')
  const [storageStatus, setStorageStatus] = useState<
    AdminDriveItemRow['storageStatus'] | ''
  >('')
  const [deleteTarget, setDeleteTarget] = useState<AdminDriveItemRow | null>(
    null
  )
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const queryClient = useQueryClient()
  const sortQuery = getServerTableSortQuery(sorting)
  const listQuery = {
    page,
    pageSize,
    search: debouncedSearch.trim() || undefined,
    userId: userId.trim() || undefined,
    type: type || undefined,
    shared: shared || undefined,
    storageStatus: storageStatus || undefined,
    ...sortQuery,
  }

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-drive-items', listQuery],
    queryFn: () => adminApi.listDriveItems(listQuery),
  })

  const deleteMutation = useMutation({
    mutationFn: adminApi.deleteDriveItem,
    onSuccess: () => {
      const message = deleteTarget?.lifecycleStatus === 'trashed' ? '已清理' : '已删除'
      void queryClient.invalidateQueries({ queryKey: ['admin-drive-items'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-drive-storage-summary'] })
      setDeleteTarget(null)
      toast.success(message)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const restoreMutation = useMutation({
    mutationFn: adminApi.restoreDriveItem,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-drive-items'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-drive-storage-summary'] })
      toast.success('已恢复')
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
        meta: { className: 'max-w-0 w-1/3' },
      },
      {
        id: 'user',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='用户' />
        ),
        cell: ({ row }) => (
          <LongText>{row.original.userEmail ?? row.original.userId}</LongText>
        ),
        enableSorting: false,
        meta: { className: 'max-w-0 w-1/4' },
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
        meta: { className: 'w-20' },
      },
      {
        accessorKey: 'storageStatus',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='状态' />
        ),
        cell: ({ row }) => (
          <Badge variant={isAdminDriveItemNormal(row.original) ? 'default' : 'secondary'}>
            {driveDisplayStatusLabel(row.original)}
          </Badge>
        ),
        meta: { className: 'w-28' },
      },
      {
        accessorKey: 'size',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='大小' />
        ),
        cell: ({ row }) => (
          <div className='text-right tabular-nums'>
            {row.original.type === 'folder' ? '-' : formatDriveBytes(row.original.size)}
          </div>
        ),
        meta: {
          className: 'w-24',
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
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
        meta: { className: 'w-24' },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='上传时间' />
        ),
        cell: ({ row }) => (
          <RelativeTime className='tabular-nums' value={row.original.createdAt} />
        ),
        meta: { className: 'w-32' },
      },
      {
        id: 'actions',
        cell: ({ row }) => {
          const item = row.original
          const canDelete = canDeleteAdminDriveItem(item)
          const canRestore = canRestoreAdminDriveItem(item)
          const deleteLabel = item.lifecycleStatus === 'trashed' ? '清理' : '删除'

          return (
            <div className='flex justify-end gap-2'>
              {item.type === 'file' && item.storageStatus === 'active' ? (
                <Button asChild variant='ghost' size='icon' className='size-8'>
                  <a href={adminApi.downloadDriveItemUrl(item.id)}>
                    <Download data-icon='inline-start' />
                    <span className='sr-only'>下载</span>
                  </a>
                </Button>
              ) : null}
              {canRestore ? (
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-8'
                  disabled={restoreMutation.isPending}
                  onClick={() => restoreMutation.mutate(item.id)}
                >
                  <RotateCcw data-icon='inline-start' />
                  <span className='sr-only'>恢复</span>
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-8'
                  disabled={deleteMutation.isPending}
                  onClick={() => setDeleteTarget(item)}
                >
                  <Trash2 data-icon='inline-start' />
                  <span className='sr-only'>{deleteLabel}</span>
                </Button>
              ) : null}
            </div>
          )
        },
        enableSorting: false,
        enableHiding: false,
        meta: {
          className: 'w-28',
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
      },
    ],
    [deleteMutation.isPending, restoreMutation.isPending, restoreMutation.mutate]
  )

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>云盘</h1>
      </Header>
      <Main>
        <Tabs defaultValue='items' className='min-h-0'>
          <TabsList>
            <TabsTrigger value='items'>文件</TabsTrigger>
            <TabsTrigger value='public-assets'>公开素材</TabsTrigger>
            <TabsTrigger value='storage'>存储</TabsTrigger>
          </TabsList>
          <TabsContent value='items' className='flex min-h-0 flex-col'>
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
              isLoading={isLoading}
              toolbar={
                <div className='flex flex-wrap items-center gap-2'>
                  <Input
                    placeholder='按名称筛选...'
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setPage(1)
                    }}
                    className='h-8 w-45 lg:w-62.5'
                  />
                  <Input
                    placeholder='按用户 ID 筛选...'
                    value={userId}
                    onChange={(event) => {
                      setUserId(event.target.value)
                      setPage(1)
                    }}
                    className='h-8 w-45 lg:w-62.5'
                  />
                  <Select
                    value={type || allTypesValue}
                    onValueChange={(value) => {
                      setType(
                        value === allTypesValue
                          ? ''
                          : (value as AdminDriveItemRow['type'])
                      )
                      setPage(1)
                    }}
                  >
                    <SelectTrigger size='sm' className='w-32'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={allTypesValue}>全部类型</SelectItem>
                        <SelectItem value='file'>文件</SelectItem>
                        <SelectItem value='folder'>文件夹</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Select
                    value={shared || allSharedValue}
                    onValueChange={(value) => {
                      setShared(
                        value === allSharedValue
                          ? ''
                          : (value as 'true' | 'false')
                      )
                      setPage(1)
                    }}
                  >
                    <SelectTrigger size='sm' className='w-32'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={allSharedValue}>全部分享</SelectItem>
                        <SelectItem value='true'>已分享</SelectItem>
                        <SelectItem value='false'>未分享</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Select
                    value={storageStatus || allStatusesValue}
                    onValueChange={(value) => {
                      setStorageStatus(
                        value === allStatusesValue
                          ? ''
                          : (value as AdminDriveItemRow['storageStatus'])
                      )
                      setPage(1)
                    }}
                  >
                    <SelectTrigger size='sm' className='w-32'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={allStatusesValue}>全部状态</SelectItem>
                        <SelectItem value='pending'>上传中</SelectItem>
                        <SelectItem value='active'>正常</SelectItem>
                        <SelectItem value='delete_pending'>删除中</SelectItem>
                        <SelectItem value='failed'>失败</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              }
            />
          </TabsContent>
          <TabsContent value='public-assets' className='flex min-h-0 flex-col'>
            <AdminPublicAssets />
          </TabsContent>
          <TabsContent value='storage'>
            <AdminDriveStorageSummary />
          </TabsContent>
        </Tabs>
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open && !deleteMutation.isPending) setDeleteTarget(null)
          }}
          title={deleteTarget?.lifecycleStatus === 'trashed' ? '清理云盘项目' : '删除云盘项目'}
          desc={deleteTarget ? `${deleteTarget.lifecycleStatus === 'trashed' ? '清理' : '删除'}「${deleteTarget.name}」？` : ''}
          cancelBtnText='取消'
          confirmText={deleteTarget?.lifecycleStatus === 'trashed' ? '清理' : '删除'}
          destructive
          isLoading={deleteMutation.isPending}
          handleConfirm={() => {
            if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
          }}
        />
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

export function driveLifecycleStatusLabel(status: AdminDriveItemRow['lifecycleStatus']) {
  const labels: Record<AdminDriveItemRow['lifecycleStatus'], string> = {
    active: '正常',
    trashed: '已移到回收站',
    hidden: '已隐藏',
    legacy_missing: '不可用',
  }
  return labels[status]
}

export function driveDisplayStatusLabel(item: AdminDriveItemRow) {
  if (item.lifecycleStatus !== 'active') return driveLifecycleStatusLabel(item.lifecycleStatus)
  return driveStatusLabel(item.storageStatus)
}

function isAdminDriveItemNormal(item: AdminDriveItemRow) {
  return item.lifecycleStatus === 'active' && item.storageStatus === 'active'
}

export function canDeleteAdminDriveItem(item: AdminDriveItemRow) {
  return (
    (item.lifecycleStatus === 'active' || item.lifecycleStatus === 'trashed') &&
    item.storageStatus !== 'delete_pending' &&
    !item.storageDeletePending
  )
}

export function canRestoreAdminDriveItem(item: AdminDriveItemRow) {
  return item.lifecycleStatus === 'trashed' || item.lifecycleStatus === 'hidden'
}

export function formatDriveBytes(value: string) {
  return formatBytes(value)
}
