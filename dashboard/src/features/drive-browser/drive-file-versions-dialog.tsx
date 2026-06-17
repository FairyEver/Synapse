import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DriveFileVersionDto, DriveFileVersionSource } from '@synapse/shared'
import { Download, Loader2, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { driveFileVersionsApi } from '@/lib/api'
import { formatDriveBrowserBytes, formatDriveBrowserDate } from './shared/drive-format'

const versionPageSize = 100

type ConfirmTarget =
  | { action: 'restore'; version: DriveFileVersionDto }
  | { action: 'delete'; version: DriveFileVersionDto }
  | null

export function DriveFileVersionsDialog({
  itemId,
  open,
  onOpenChange,
}: {
  readonly itemId: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null)
  const versionsQuery = useQuery({
    queryKey: ['drive-file-versions', itemId],
    queryFn: () => driveFileVersionsApi.list(itemId, { limit: versionPageSize }),
    enabled: open,
  })
  const invalidateVersionState = () => {
    void queryClient.invalidateQueries({ queryKey: ['drive-file-versions', itemId] })
    void queryClient.invalidateQueries({ queryKey: ['drive-browser'] })
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
    onSuccess: () => {
      setConfirmTarget(null)
      invalidateVersionState()
      toast.success('已删除')
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
        <DialogContent className='flex max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-3xl'>
          <DialogHeader className='shrink-0 px-5 pt-5'>
            <DialogTitle>历史版本</DialogTitle>
          </DialogHeader>
          <div className='flex min-h-0 flex-1 flex-col px-5 pb-5'>
            <DriveFileVersionContent
              itemId={itemId}
              versions={versionsQuery.data?.items ?? []}
              loading={versionsQuery.isLoading}
              error={versionsQuery.error instanceof Error ? versionsQuery.error.message : null}
              pinningVersionId={pinMutation.variables?.versionId ?? null}
              pinning={pinMutation.isPending}
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
  pinningVersionId,
  pinning,
  onPin,
  onRestore,
  onDelete,
}: {
  readonly itemId: string
  readonly versions: readonly DriveFileVersionDto[]
  readonly loading: boolean
  readonly error: string | null
  readonly pinningVersionId: string | null
  readonly pinning: boolean
  readonly onPin: (version: DriveFileVersionDto) => void
  readonly onRestore: (version: DriveFileVersionDto) => void
  readonly onDelete: (version: DriveFileVersionDto) => void
}) {
  if (loading) {
    return (
      <div className='grid min-h-0 flex-1 gap-3'>
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-16 w-full' />
      </div>
    )
  }
  if (error) return <div className='min-h-0 flex-1 rounded-md border p-4 text-sm text-destructive'>{error}</div>
  if (versions.length === 0) return <div className='min-h-0 flex-1 rounded-md border p-4 text-sm text-muted-foreground'>暂无历史版本</div>

  return (
    <ScrollArea className='min-h-0 flex-1 pr-3'>
      <div className='grid gap-2'>
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
      </div>
    </ScrollArea>
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
  return (
    <div className='flex min-w-0 flex-col gap-3 rounded-md border p-3 md:flex-row md:items-center md:justify-between'>
      <div className='min-w-0 flex-1 space-y-2'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <span className='shrink-0 text-sm font-medium tabular-nums'>v{version.versionNumber}</span>
          {version.isCurrent ? <Badge>当前</Badge> : null}
          {version.isPinned ? <Badge variant='outline'>保留</Badge> : null}
          {version.deletePending ? <Badge variant='secondary'>待清理</Badge> : null}
          <Badge variant='outline'>{driveVersionSourceLabel(version.source)}</Badge>
        </div>
        <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
          <span className='shrink-0 tabular-nums'>{formatDriveBrowserBytes(version.size)}</span>
          <span className='min-w-0 truncate tabular-nums' title={formatDriveBrowserDate(version.createdAt)}>
            {formatDriveBrowserDate(version.createdAt)}
          </span>
        </div>
      </div>
      <div className='flex shrink-0 flex-wrap gap-2 md:justify-end'>
        <Button asChild variant='outline' size='sm' className='shrink-0'>
          <a href={driveFileVersionsApi.downloadUrl(itemId, version.id)}>
            <Download data-icon='inline-start' />
            下载
          </a>
        </Button>
        {!version.isCurrent ? (
          <Button type='button' variant='outline' size='sm' className='shrink-0' onClick={() => onRestore(version)}>
            <RotateCcw data-icon='inline-start' />
            恢复
          </Button>
        ) : null}
        {!version.isCurrent ? (
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='shrink-0'
            disabled={pinning}
            onClick={() => onPin(version)}
          >
            {pinning ? <Loader2 className='animate-spin' data-icon='inline-start' /> : version.isPinned ? <PinOff data-icon='inline-start' /> : <Pin data-icon='inline-start' />}
            {version.isPinned ? '取消保留' : '保留'}
          </Button>
        ) : null}
        {!version.isCurrent ? (
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='shrink-0 text-destructive hover:text-destructive'
            onClick={() => onDelete(version)}
          >
            <Trash2 data-icon='inline-start' />
            删除
          </Button>
        ) : null}
      </div>
    </div>
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
