import { useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { DriveFileVersionDto, DriveFileVersionSource } from '@synapse/shared'
import { Download, Loader2, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { driveFileVersionsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDriveBrowserBytes } from './shared/drive-format'

const versionPageSize = 100
const versionWindowPageCount = 2
const versionSkeletonRows = [0, 1, 2] as const

type ConfirmTarget =
  | { action: 'restore'; version: DriveFileVersionDto }
  | { action: 'delete'; version: DriveFileVersionDto }
  | null

export function DriveFileVersionsDialog({
  itemId,
  open,
  onChanged,
  onOpenChange,
}: {
  readonly itemId: string
  readonly open: boolean
  readonly onChanged?: () => void | Promise<unknown>
  readonly onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null)
  const versionsQuery = useInfiniteQuery({
    queryKey: ['drive-file-versions', itemId],
    queryFn: ({ pageParam }) => driveFileVersionsApi.list(itemId, { offset: pageParam, limit: versionPageSize }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.page.nextOffset ?? undefined,
    maxPages: versionWindowPageCount,
    enabled: open,
  })
  const versions = versionsQuery.data?.pages.flatMap((page) => page.items) ?? []
  const invalidateVersionState = () => {
    void queryClient.invalidateQueries({ queryKey: ['drive-file-versions', itemId] })
    void queryClient.invalidateQueries({ queryKey: ['drive-browser'] })
    void Promise.resolve(onChanged?.()).catch(() => undefined)
  }
  const restoreMutation = useMutation({
    mutationFn: (versionId: string) => driveFileVersionsApi.restore(itemId, versionId),
    onSuccess: () => {
      setConfirmTarget(null)
      invalidateVersionState()
      toast.success('已恢复')
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const deleteMutation = useMutation({
    mutationFn: (versionId: string) => driveFileVersionsApi.delete(itemId, versionId),
    onSuccess: (result) => {
      setConfirmTarget(null)
      invalidateVersionState()
      toast.success(result.deletePending ? '清理中' : '已删除')
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const pinMutation = useMutation({
    mutationFn: ({ versionId, isPinned }: { versionId: string; isPinned: boolean }) =>
      driveFileVersionsApi.updatePin(itemId, versionId, isPinned),
    onSuccess: () => {
      invalidateVersionState()
      toast.success('已保存')
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const confirming = restoreMutation.isPending || deleteMutation.isPending
  const confirmTitle = confirmTarget?.action === 'restore' ? '恢复版本' : '删除版本'
  const confirmText = confirmTarget?.action === 'restore' ? '恢复' : '删除'
  const confirmDesc = confirmTarget?.action === 'restore'
    ? `将 v${confirmTarget.version.versionNumber} 恢复为当前版本。`
    : `删除 v${confirmTarget?.version.versionNumber ?? ''} 后无法恢复。`

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='sm:max-w-3xl'>
          <DialogHeader className='text-start'>
            <DialogTitle className='pr-8'>历史版本</DialogTitle>
          </DialogHeader>
          <div className='h-105 w-[calc(100%+0.75rem)] overflow-y-auto py-1 pe-3'>
            <DriveFileVersionContent
              itemId={itemId}
              versions={versions}
              loading={versionsQuery.isLoading}
              error={versions.length === 0 && versionsQuery.error instanceof Error ? versionsQuery.error.message : null}
              loadMoreError={
                versions.length > 0 && versionsQuery.isFetchNextPageError && versionsQuery.error instanceof Error
                  ? versionsQuery.error.message
                  : null
              }
              pinningVersionId={pinMutation.variables?.versionId ?? null}
              pinning={pinMutation.isPending}
              hasMore={versionsQuery.hasNextPage}
              loadingMore={versionsQuery.isFetchingNextPage}
              onRetry={() => {
                void versionsQuery.refetch()
              }}
              onLoadMore={() => {
                void versionsQuery.fetchNextPage()
              }}
              onPin={(version) => pinMutation.mutate({ versionId: version.id, isPinned: !version.isPinned })}
              onRestore={(version) => setConfirmTarget({ action: 'restore', version })}
              onDelete={(version) => setConfirmTarget({ action: 'delete', version })}
            />
          </div>
        </DialogContent>
      </Dialog>
      {confirmTarget ? (
        <ConfirmDialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setConfirmTarget(null)
          }}
          title={confirmTitle}
          desc={confirmDesc}
          cancelBtnText='取消'
          confirmText={confirmText}
          destructive={confirmTarget.action === 'delete'}
          isLoading={confirming}
          handleConfirm={() => {
            if (confirmTarget.action === 'restore') {
              restoreMutation.mutate(confirmTarget.version.id)
              return
            }
            deleteMutation.mutate(confirmTarget.version.id)
          }}
        />
      ) : null}
    </>
  )
}

export function DriveFileVersionContent({
  itemId,
  versions,
  loading,
  error,
  loadMoreError,
  pinningVersionId,
  pinning,
  hasMore,
  loadingMore,
  onRetry,
  onLoadMore,
  onPin,
  onRestore,
  onDelete,
}: {
  readonly itemId: string
  readonly versions: readonly DriveFileVersionDto[]
  readonly loading: boolean
  readonly error: string | null
  readonly loadMoreError: string | null
  readonly pinningVersionId: string | null
  readonly pinning: boolean
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly onRetry: () => void
  readonly onLoadMore: () => void
  readonly onPin: (version: DriveFileVersionDto) => void
  readonly onRestore: (version: DriveFileVersionDto) => void
  readonly onDelete: (version: DriveFileVersionDto) => void
}) {
  if (loading) {
    return (
      <DriveFileVersionTableFrame>
        <DriveFileVersionTable skeleton />
      </DriveFileVersionTableFrame>
    )
  }
  if (error) {
    return (
      <div className='flex min-h-48 flex-1 flex-col items-center justify-center gap-3 rounded-md border p-4 text-center'>
        <div className='grid gap-1 text-sm'>
          <div className='font-medium'>读取失败</div>
          <div className='text-muted-foreground'>{error}</div>
        </div>
        <Button type='button' variant='outline' size='sm' onClick={onRetry}>
          重试
        </Button>
      </div>
    )
  }
  if (versions.length === 0) {
    return (
      <div className='flex min-h-48 flex-1 items-center justify-center rounded-md border p-4 text-sm text-muted-foreground'>
        暂无历史版本
      </div>
    )
  }

  return (
    <DriveFileVersionTableFrame>
      <DriveFileVersionTable>
        {versions.map((version) => (
          <DriveFileVersionRow
            key={version.id}
            itemId={itemId}
            version={version}
            pinning={pinning && pinningVersionId === version.id}
            onPin={onPin}
            onRestore={onRestore}
            onDelete={onDelete}
          />
        ))}
      </DriveFileVersionTable>
      {hasMore || loadMoreError ? (
        <div className='grid justify-items-center gap-2 border-t p-2'>
          {loadMoreError ? (
            <div className='text-center text-sm text-destructive'>
              加载更多失败：{loadMoreError}
            </div>
          ) : null}
          {hasMore ? (
            <Button type='button' variant='outline' size='sm' disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? <Loader2 className='animate-spin' /> : null}
              {loadingMore ? '加载中' : '加载更多'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </DriveFileVersionTableFrame>
  )
}

function DriveFileVersionTableFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className='rounded-md border'>
      {children}
    </div>
  )
}

function DriveFileVersionTable({
  children,
  skeleton = false,
}: {
  readonly children?: ReactNode
  readonly skeleton?: boolean
}) {
  return (
    <Table className='min-w-[680px] table-fixed'>
      <TableHeader>
        <TableRow>
          <TableHead className='w-40'>版本</TableHead>
          <TableHead className='w-24'>来源</TableHead>
          <TableHead className='w-24 text-right'>大小</TableHead>
          <TableHead className='w-44'>创建时间</TableHead>
          <TableHead className='w-40 text-right' aria-label='操作' />
        </TableRow>
      </TableHeader>
      <TableBody>
        {skeleton ? <DriveFileVersionTableSkeleton /> : children}
      </TableBody>
    </Table>
  )
}

function DriveFileVersionTableSkeleton() {
  return (
    <>
      {versionSkeletonRows.map((row) => (
        <TableRow key={row}>
          <TableCell>
            <div className='flex items-center gap-2'>
              <Skeleton className='h-4 w-10' />
              <Skeleton className='h-5 w-12' />
            </div>
          </TableCell>
          <TableCell><Skeleton className='h-5 w-12' /></TableCell>
          <TableCell><Skeleton className='ml-auto h-4 w-14' /></TableCell>
          <TableCell><Skeleton className='h-4 w-32' /></TableCell>
          <TableCell><Skeleton className='ml-auto h-8 w-28' /></TableCell>
        </TableRow>
      ))}
    </>
  )
}

function DriveFileVersionRow({
  itemId,
  version,
  pinning,
  onPin,
  onRestore,
  onDelete,
}: {
  readonly itemId: string
  readonly version: DriveFileVersionDto
  readonly pinning: boolean
  readonly onPin: (version: DriveFileVersionDto) => void
  readonly onRestore: (version: DriveFileVersionDto) => void
  readonly onDelete: (version: DriveFileVersionDto) => void
}) {
  const canDownload = !version.deletePending
  const canModify = !version.isCurrent && !version.deletePending

  return (
    <TableRow>
      <TableCell>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='shrink-0 font-medium tabular-nums'>v{version.versionNumber}</span>
          <DriveFileVersionBadges version={version} />
        </div>
      </TableCell>
      <TableCell>
        <Badge variant='outline'>{driveVersionSourceLabel(version.source)}</Badge>
      </TableCell>
      <TableCell className='text-right tabular-nums text-muted-foreground'>
        {formatDriveBrowserBytes(version.size)}
      </TableCell>
      <TableCell className='truncate tabular-nums text-muted-foreground'>
        <RelativeTime value={version.createdAt} />
      </TableCell>
      <TableCell>
        <div className='flex items-center justify-end gap-1'>
          {canDownload ? (
            <DriveVersionActionButton
              href={driveFileVersionsApi.downloadUrl(itemId, version.id)}
              label={`下载 v${version.versionNumber}`}
              tooltip='下载'
            >
              <Download />
            </DriveVersionActionButton>
          ) : null}
          {canModify ? (
            <DriveVersionActionButton
              label={`恢复 v${version.versionNumber}`}
              tooltip='恢复'
              onClick={() => onRestore(version)}
            >
              <RotateCcw />
            </DriveVersionActionButton>
          ) : null}
          {canModify ? (
            <DriveVersionActionButton
              disabled={pinning}
              label={version.isPinned ? `取消保留 v${version.versionNumber}` : `保留 v${version.versionNumber}`}
              tooltip={version.isPinned ? '取消保留' : '保留'}
              onClick={() => onPin(version)}
            >
              {pinning ? <Loader2 className='animate-spin' /> : version.isPinned ? <PinOff /> : <Pin />}
            </DriveVersionActionButton>
          ) : null}
          {canModify && !version.isPinned ? (
            <DriveVersionActionButton
              destructive
              label={`删除 v${version.versionNumber}`}
              tooltip='删除'
              onClick={() => onDelete(version)}
            >
              <Trash2 />
            </DriveVersionActionButton>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function DriveFileVersionBadges({ version }: { readonly version: DriveFileVersionDto }) {
  return (
    <div className='flex min-w-0 items-center gap-1'>
      {version.isCurrent ? <Badge>当前</Badge> : null}
      {version.isPinned ? <Badge variant='outline'>保留</Badge> : null}
      {version.deletePending ? <Badge variant='secondary'>待清理</Badge> : null}
    </div>
  )
}

function DriveVersionActionButton({
  children,
  destructive = false,
  disabled = false,
  href,
  label,
  onClick,
  tooltip,
}: {
  readonly children: ReactNode
  readonly destructive?: boolean
  readonly disabled?: boolean
  readonly href?: string
  readonly label: string
  readonly onClick?: () => void
  readonly tooltip: string
}) {
  const className = cn('size-8', destructive && 'text-destructive hover:text-destructive')
  const button = href ? (
    <Button asChild variant='ghost' size='icon' className={className} aria-label={label}>
      <a href={href}>{children}</a>
    </Button>
  ) : (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      className={className}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {button}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function driveVersionSourceLabel(source: DriveFileVersionSource) {
  const labels: Record<DriveFileVersionSource, string> = {
    upload: '上传',
    online_edit: '编辑',
    restore: '恢复',
  }
  return labels[source]
}
