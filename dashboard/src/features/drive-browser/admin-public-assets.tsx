import { useEffect, useMemo, useState } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { formatDriveBrowserDate } from './shared/drive-format'

export function AdminPublicAssets() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const [selectedAsset, setSelectedAsset] = useState<AdminDrivePublicAssetRow | null>(null)
  const sortQuery = getServerTableSortQuery(sorting)
  const listQuery = {
    page,
    pageSize,
    search: search.trim() || undefined,
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
      },
      {
        id: 'owner',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='用户' />
        ),
        cell: ({ row }) => row.original.owner.email ?? row.original.owner.userId,
        enableSorting: false,
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
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='创建时间' />
        ),
        cell: ({ row }) => formatDriveBrowserDate(row.original.createdAt),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='ghost'
              className='h-8 px-2'
              onClick={() => setSelectedAsset(row.original)}
            >
              <Eye />
              详情
            </Button>
            {canOpenPublicAsset(row.original) ? (
              <Button asChild variant='ghost' className='h-8 px-2'>
                <a href={row.original.url} target='_blank' rel='noreferrer'>
                  <Download />
                  打开
                </a>
              </Button>
            ) : (
              <Button type='button' variant='ghost' className='h-8 px-2' disabled>
                <Download />
                打开
              </Button>
            )}
          </div>
        ),
        enableSorting: false,
        meta: {
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
              placeholder='搜索'
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
    placeholderData: keepPreviousData,
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
    placeholderData: keepPreviousData,
  })

  return (
    <Dialog open={Boolean(asset)} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-5xl'>
        <DialogHeader>
          <DialogTitle>公开素材</DialogTitle>
          <DialogDescription className='sr-only'>
            查看公开素材详情、访问日志和历史版本。
          </DialogDescription>
        </DialogHeader>
        {asset ? (
          <Tabs defaultValue='detail' className='min-h-0'>
            <TabsList>
              <TabsTrigger value='detail'>详情</TabsTrigger>
              <TabsTrigger value='logs'>访问日志</TabsTrigger>
              <TabsTrigger value='revisions'>历史版本</TabsTrigger>
            </TabsList>
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
          <DetailRow label='创建时间' value={formatDriveBrowserDate(asset.createdAt)} />
          <DetailRow label='更新时间' value={formatDriveBrowserDate(asset.updatedAt)} />
        </TableBody>
      </Table>
    </div>
  )
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string | null }) {
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
        header: '名称',
        enableHiding: false,
        cell: ({ row }) => (
          <div className='min-w-0'>
            <div className='truncate font-medium'>{row.original.name}</div>
            <div className='truncate text-sm text-muted-foreground'>{row.original.id}</div>
          </div>
        ),
      },
      {
        accessorKey: 'size',
        header: '大小',
        enableHiding: false,
        cell: ({ row }) => (
          <div className='text-right tabular-nums'>{formatDriveBytes(row.original.size)}</div>
        ),
        meta: {
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
      },
      {
        accessorKey: 'replacedAt',
        header: '替换时间',
        enableHiding: false,
        cell: ({ row }) => formatDriveBrowserDate(row.original.replacedAt),
      },
      {
        id: 'actions',
        header: '操作',
        enableHiding: false,
        cell: ({ row }) => (
          <div className='flex justify-end'>
            <Button asChild variant='ghost' className='h-8 px-2'>
              <a href={adminApi.downloadDrivePublicAssetRevisionUrl(assetId, row.original.id)}>
                <Download />
                下载
              </a>
            </Button>
          </div>
        ),
        meta: {
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
    header: '方法',
    enableHiding: false,
  },
  {
    accessorKey: 'statusCode',
    header: '状态',
    enableHiding: false,
    cell: ({ row }) => (
      <div className='text-right tabular-nums'>{row.original.statusCode}</div>
    ),
    meta: {
      thClassName: 'text-right',
      tdClassName: 'text-right',
    },
  },
  {
    accessorKey: 'bytes',
    header: '字节',
    enableHiding: false,
    cell: ({ row }) => (
      <div className='text-right tabular-nums'>{formatDriveBytes(row.original.bytes)}</div>
    ),
    meta: {
      thClassName: 'text-right',
      tdClassName: 'text-right',
    },
  },
  {
    accessorKey: 'ip',
    header: 'IP',
    enableHiding: false,
    cell: ({ row }) => row.original.ip ?? '-',
  },
  {
    accessorKey: 'referer',
    header: '来源',
    enableHiding: false,
    cell: ({ row }) => (
      <div className='max-w-64 truncate'>{row.original.referer ?? '-'}</div>
    ),
  },
  {
    accessorKey: 'accessedAt',
    header: '时间',
    enableHiding: false,
    cell: ({ row }) => formatDriveBrowserDate(row.original.accessedAt),
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
