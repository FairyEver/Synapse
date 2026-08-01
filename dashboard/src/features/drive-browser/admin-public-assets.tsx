import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, Eye } from 'lucide-react'
import {
  adminApi,
  type AdminDrivePublicAssetAccessLogRow,
  type AdminDrivePublicAssetRevisionRow,
  type AdminDrivePublicAssetRow,
} from '@/lib/api'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { LongText } from '@/components/long-text'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameHeader,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDriveBytes } from '@/features/drive'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { formatDriveBrowserDate } from './shared/drive-format'

export function AdminPublicAssets() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const [selectedAsset, setSelectedAsset] = useState<AdminDrivePublicAssetRow | null>(null)
  const sortQuery = getServerTableSortQuery(sorting)
  const listQuery = {
    page,
    pageSize,
    search: debouncedSearch.trim() || undefined,
    ...sortQuery,
  }

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-drive-public-assets', listQuery],
    queryFn: () => adminApi.listDrivePublicAssets(listQuery),
    placeholderData: keepPreviousData,
  })

  const columns = useMemo<ColumnDef<AdminDrivePublicAssetRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='名称' />
        ),
        cell: ({ row }) => (
          <div className='min-w-0'>
            <div className='truncate font-medium'>{row.original.name}</div>
            <div className='truncate text-sm text-muted-foreground'>{row.original.assetId}</div>
          </div>
        ),
        meta: { className: 'max-w-0 w-1/3' },
      },
      {
        id: 'owner',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='用户' />
        ),
        cell: ({ row }) => (
          <LongText>
            {row.original.owner.email ?? row.original.owner.userId}
          </LongText>
        ),
        enableSorting: false,
        meta: { className: 'max-w-0 w-1/4' },
      },
      {
        accessorKey: 'lifecycleStatus',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='状态' />
        ),
        cell: ({ row }) => (
          <Badge variant={row.original.lifecycleStatus === 'active' ? 'default' : 'secondary'}>
            {driveLifecycleLabel(row.original.lifecycleStatus)}
          </Badge>
        ),
        meta: { className: 'w-24' },
      },
      {
        accessorKey: 'size',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='大小' />
        ),
        cell: ({ row }) => (
          <div className='text-right tabular-nums'>{formatDriveBytes(row.original.size)}</div>
        ),
        meta: {
          className: 'w-24',
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
      },
      {
        id: 'stats',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='访问' />
        ),
        cell: ({ row }) => (
          <div className='text-right tabular-nums'>
            {row.original.accessCount} / {formatDriveBytes(row.original.responseBytes)}
          </div>
        ),
        enableSorting: false,
        meta: {
          className: 'w-32',
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='创建时间' />
        ),
        cell: ({ row }) => (
          <RelativeTime className='tabular-nums' value={row.original.createdAt} />
        ),
        meta: { className: 'w-32' },
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => setSelectedAsset(row.original)}
            >
              <Eye />
              详情
            </Button>
            {canOpenPublicAsset(row.original) ? (
              <Button asChild variant='ghost' size='sm'>
                <a href={row.original.url} target='_blank' rel='noreferrer'>
                  <Download />
                  打开
                </a>
              </Button>
            ) : (
              <Button type='button' variant='ghost' size='sm' disabled>
                <Download />
                打开
              </Button>
            )}
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
        meta: {
          className: 'w-36',
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
      },
    ],
    []
  )

  return (
    <>
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
        emptyMessage='暂无公开素材'
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
          </div>
        }
      />
      <AdminPublicAssetDetailsDialog
        asset={selectedAsset}
        onOpenChange={(open) => {
          if (!open) setSelectedAsset(null)
        }}
      />
    </>
  )
}

export function AdminPublicAssetDetailsDialog({
  asset,
  onOpenChange,
}: {
  readonly asset: AdminDrivePublicAssetRow | null
  readonly onOpenChange: (open: boolean) => void
}) {
  const [accessLogPage, setAccessLogPage] = useState(1)
  const [accessLogPageSize, setAccessLogPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [revisionPage, setRevisionPage] = useState(1)
  const [revisionPageSize, setRevisionPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  useEffect(() => {
    setAccessLogPage(1)
    setRevisionPage(1)
  }, [asset?.assetId])

  const accessLogs = useQuery({
    queryKey: ['admin-drive-public-asset-access-logs', asset?.assetId, accessLogPage, accessLogPageSize],
    queryFn: () => adminApi.listDrivePublicAssetAccessLogs(asset!.assetId, {
      page: accessLogPage,
      pageSize: accessLogPageSize,
      sortBy: 'accessedAt',
      sortOrder: 'desc',
    }),
    enabled: Boolean(asset),
    placeholderData: (previousData, previousQuery) => (
      previousQuery?.queryKey[1] === asset?.assetId ? previousData : undefined
    ),
  })
  const revisions = useQuery({
    queryKey: ['admin-drive-public-asset-revisions', asset?.assetId, revisionPage, revisionPageSize],
    queryFn: () => adminApi.listDrivePublicAssetRevisions(asset!.assetId, {
      page: revisionPage,
      pageSize: revisionPageSize,
      sortBy: 'replacedAt',
      sortOrder: 'desc',
    }),
    enabled: Boolean(asset),
    placeholderData: (previousData, previousQuery) => (
      previousQuery?.queryKey[1] === asset?.assetId ? previousData : undefined
    ),
  })

  return (
    <Dialog open={Boolean(asset)} onOpenChange={onOpenChange}>
      <DialogContent
        className='gap-0 overflow-hidden p-0 sm:max-w-5xl'
        showCloseButton={false}
      >
        {asset ? (
          <Tabs defaultValue='detail' className='min-h-0'>
            <DialogFrame>
              <DialogFrameHeader
                title='公开素材'
                description='查看公开素材详情、访问日志和历史版本。'
                descriptionClassName='sr-only'
                center={(
                  <TabsList>
                    <TabsTrigger value='detail'>详情</TabsTrigger>
                    <TabsTrigger value='logs'>访问日志</TabsTrigger>
                    <TabsTrigger value='revisions'>历史版本</TabsTrigger>
                  </TabsList>
                )}
                bordered
              />
              <DialogFrameBody className='px-6 py-4'>
                <TabsContent value='detail'>
                  <PublicAssetDetailTable asset={asset} />
                </TabsContent>
                <TabsContent value='logs'>
                  <AccessLogTable
                    data={accessLogs.data?.data ?? []}
                    error={accessLogs.isError ? accessLogs.error : null}
                    isLoading={accessLogs.isLoading}
                    onRetry={() => void accessLogs.refetch()}
                    page={accessLogPage}
                    pageSize={accessLogPageSize}
                    total={accessLogs.data?.total ?? 0}
                    onPageChange={setAccessLogPage}
                    onPageSizeChange={setAccessLogPageSize}
                  />
                </TabsContent>
                <TabsContent value='revisions'>
                  <RevisionTable
                    assetId={asset.assetId}
                    data={revisions.data?.data ?? []}
                    error={revisions.isError ? revisions.error : null}
                    isLoading={revisions.isLoading}
                    onRetry={() => void revisions.refetch()}
                    page={revisionPage}
                    pageSize={revisionPageSize}
                    total={revisions.data?.total ?? 0}
                    onPageChange={setRevisionPage}
                    onPageSizeChange={setRevisionPageSize}
                  />
                </TabsContent>
              </DialogFrameBody>
            </DialogFrame>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function PublicAssetDetailTable({ asset }: { readonly asset: AdminDrivePublicAssetRow }) {
  return (
    <div className='overflow-hidden rounded-md border'>
      <Table>
        <TableBody>
          <DetailRow label='资源 ID' value={asset.assetId} />
          <DetailRow label='文件名' value={asset.name} />
          <DetailRow label='用户' value={asset.owner.email ?? asset.owner.userId} />
          <DetailRow label='类型' value={asset.mimeType} />
          <DetailRow label='大小' value={formatDriveBytes(asset.size)} />
          <DetailRow label='状态' value={driveLifecycleLabel(asset.lifecycleStatus)} />
          <DetailRow label='创建时间' value={<RelativeTime value={asset.createdAt} />} />
          <DetailRow label='更新时间' value={<RelativeTime value={asset.updatedAt} />} />
        </TableBody>
      </Table>
    </div>
  )
}

function DetailRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <TableRow>
      <TableCell className='w-32 text-muted-foreground'>{label}</TableCell>
      <TableCell className='break-all'>{value || '-'}</TableCell>
    </TableRow>
  )
}

export function AccessLogTable({
  data,
  error,
  isLoading,
  onRetry,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  readonly data: readonly AdminDrivePublicAssetAccessLogRow[]
  readonly error: unknown
  readonly isLoading: boolean
  readonly onRetry: () => void
  readonly page: number
  readonly pageSize: number
  readonly total: number
  readonly onPageChange: (page: number) => void
  readonly onPageSizeChange: (pageSize: number) => void
}) {
  return (
    <ServerDataTable
      columns={accessLogColumns}
      data={[...data]}
      emptyMessage='暂无访问日志'
      error={error}
      isLoading={isLoading}
      loadingRowCount={3}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      onRetry={onRetry}
      page={page}
      pageSize={pageSize}
      showPagination={total > pageSize}
      total={total}
    />
  )
}

function RevisionTable({
  assetId,
  data,
  error,
  isLoading,
  onRetry,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  readonly assetId: string
  readonly data: readonly AdminDrivePublicAssetRevisionRow[]
  readonly error: unknown
  readonly isLoading: boolean
  readonly onRetry: () => void
  readonly page: number
  readonly pageSize: number
  readonly total: number
  readonly onPageChange: (page: number) => void
  readonly onPageSizeChange: (pageSize: number) => void
}) {
  const columns = useMemo<ColumnDef<AdminDrivePublicAssetRevisionRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='名称' />
        ),
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className='min-w-0'>
            <div className='truncate font-medium'>{row.original.name}</div>
            <div className='truncate text-sm text-muted-foreground'>{row.original.id}</div>
          </div>
        ),
        meta: { className: 'max-w-0' },
      },
      {
        accessorKey: 'size',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='大小' />
        ),
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className='text-right tabular-nums'>{formatDriveBytes(row.original.size)}</div>
        ),
        meta: {
          className: 'w-28',
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
      },
      {
        accessorKey: 'replacedAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='替换时间' />
        ),
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <RelativeTime className='tabular-nums' value={row.original.replacedAt} />
        ),
        meta: { className: 'w-40' },
      },
      {
        id: 'actions',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='操作' />
        ),
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className='flex justify-end'>
            <Button asChild variant='ghost' size='sm'>
              <a href={adminApi.downloadDrivePublicAssetRevisionUrl(assetId, row.original.id)}>
                <Download />
                下载
              </a>
            </Button>
          </div>
        ),
        meta: {
          className: 'w-28',
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
      },
    ],
    [assetId]
  )

  return (
    <ServerDataTable
      columns={columns}
      data={[...data]}
      emptyMessage='暂无历史版本'
      error={error}
      isLoading={isLoading}
      loadingRowCount={3}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      onRetry={onRetry}
      page={page}
      pageSize={pageSize}
      showPagination={total > pageSize}
      total={total}
    />
  )
}

const accessLogColumns: ColumnDef<AdminDrivePublicAssetAccessLogRow>[] = [
  {
    accessorKey: 'method',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='方法' />
    ),
    enableSorting: false,
    enableHiding: false,
    meta: { className: 'w-20' },
  },
  {
    accessorKey: 'statusCode',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='状态' />
    ),
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <div className='text-right tabular-nums'>{row.original.statusCode}</div>
    ),
    meta: {
      className: 'w-20',
      thClassName: 'text-right',
      tdClassName: 'text-right',
    },
  },
  {
    accessorKey: 'bytes',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='字节' />
    ),
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <div className='text-right tabular-nums'>{formatDriveBytes(row.original.bytes)}</div>
    ),
    meta: {
      className: 'w-28',
      thClassName: 'text-right',
      tdClassName: 'text-right',
    },
  },
  {
    accessorKey: 'ip',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='IP' />
    ),
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => row.original.ip ?? '-',
    meta: { className: 'w-36' },
  },
  {
    accessorKey: 'referer',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='来源' />
    ),
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <div className='truncate'>{row.original.referer ?? '-'}</div>
    ),
    meta: { className: 'max-w-0' },
  },
  {
    accessorKey: 'accessedAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='时间' />
    ),
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <span className='tabular-nums'>
        {formatDriveBrowserDate(row.original.accessedAt)}
      </span>
    ),
    meta: { className: 'w-44' },
  },
]

function driveLifecycleLabel(status: AdminDrivePublicAssetRow['lifecycleStatus']) {
  const labels: Record<AdminDrivePublicAssetRow['lifecycleStatus'], string> = {
    active: '正常',
    trashed: '回收站',
    hidden: '隐藏',
    legacy_missing: '不可用',
  }
  return labels[status]
}

function canOpenPublicAsset(asset: AdminDrivePublicAssetRow) {
  return asset.lifecycleStatus === 'active'
}
