import type { DragEvent, ReactNode } from 'react'
import type { DriveBrowserItemDto, DriveBrowserSnapshotDto } from '@synapse/shared'
import { Archive, Loader2, MoreHorizontal, Trash2 } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDriveBrowserSize } from '@/features/drive-browser/shared/drive-format'
import { DriveBrowserItemIcon } from '@/features/drive-browser/shared/drive-icons'
import { navigateDriveBrowserUrl, type DriveBrowserNavigate } from '@/features/drive-browser/shared/drive-navigation'

export type DriveConsoleSystemView = 'files' | 'public-assets' | 'trash'

export function DriveFileTable({
  snapshot,
  activeView,
  onOpenSystemView,
  onDelete,
  onMove,
  onRename,
  onShare,
  onNavigate = navigateDriveBrowserUrl,
  onDropFiles,
  onLoadMoreChildren,
  loadingMoreChildren = false,
  loadMoreChildrenError = null,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly activeView: DriveConsoleSystemView
  readonly onOpenSystemView: (view: DriveConsoleSystemView) => void
  readonly onDelete: (item: DriveBrowserItemDto, trigger: HTMLElement) => void
  readonly onMove: (item: DriveBrowserItemDto) => void
  readonly onRename: (item: DriveBrowserItemDto) => void
  readonly onShare: (item: DriveBrowserItemDto) => void
  readonly onNavigate?: DriveBrowserNavigate
  readonly onDropFiles: (files: readonly File[]) => void
  readonly onLoadMoreChildren?: () => void
  readonly loadingMoreChildren?: boolean
  readonly loadMoreChildrenError?: string | null
}) {
  if (activeView !== 'files') return null

  const rootSystemRows = snapshot.breadcrumbs.length <= 1
  const canLoadMoreChildren = Boolean(snapshot.childrenPage?.hasMore && onLoadMoreChildren)
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files ?? [])
    onDropFiles(files)
  }

  return (
    <div
      data-testid='drive-console-dropzone'
      data-drive-telemetry-event='web.drive.file.drop'
      className='rounded-lg border bg-background'
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={handleDrop}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className='w-28 text-right'>大小</TableHead>
            <TableHead className='w-40 text-right'>更新时间</TableHead>
            <TableHead className='w-56 text-right' aria-label='操作' />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rootSystemRows ? (
            <>
              <SystemRow icon={<Archive className='size-4 text-muted-foreground' />} name='公开素材' onOpen={() => onOpenSystemView('public-assets')} />
              <SystemRow icon={<Trash2 className='size-4 text-muted-foreground' />} name='回收站' onOpen={() => onOpenSystemView('trash')} />
            </>
          ) : null}
          {snapshot.children.map((item) => (
            <DriveFileRow
              key={item.id}
              item={item}
              onDelete={onDelete}
              onMove={onMove}
              onRename={onRename}
              onShare={onShare}
              onNavigate={onNavigate}
            />
          ))}
        </TableBody>
      </Table>
      {canLoadMoreChildren || loadMoreChildrenError ? (
        <div className='flex flex-col items-center gap-2 border-t px-3 py-3'>
          {canLoadMoreChildren ? (
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={loadingMoreChildren}
              onClick={onLoadMoreChildren}
            >
              {loadingMoreChildren ? <Loader2 data-icon='inline-start' className='animate-spin' /> : null}
              {loadingMoreChildren ? '加载中' : '加载更多'}
            </Button>
          ) : null}
          {loadMoreChildrenError ? <div className='text-sm text-destructive'>{loadMoreChildrenError}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function SystemRow({ icon, name, onOpen }: { readonly icon: ReactNode; readonly name: string; readonly onOpen: () => void }) {
  return (
    <TableRow data-drive-telemetry-event='web.drive.system-view.open' className='cursor-pointer' onClick={onOpen}>
      <TableCell>
        <div className='flex min-w-0 items-center gap-2'>
          {icon}
          <span className='truncate font-medium'>{name}</span>
        </div>
      </TableCell>
      <TableCell className='text-right text-muted-foreground'>-</TableCell>
      <TableCell className='text-right text-muted-foreground'>-</TableCell>
      <TableCell aria-label={`${name} 操作`} />
    </TableRow>
  )
}

function DriveFileRow({
  item,
  onDelete,
  onMove,
  onRename,
  onShare,
  onNavigate,
}: {
  readonly item: DriveBrowserItemDto
  readonly onDelete: (item: DriveBrowserItemDto, trigger: HTMLElement) => void
  readonly onMove: (item: DriveBrowserItemDto) => void
  readonly onRename: (item: DriveBrowserItemDto) => void
  readonly onShare: (item: DriveBrowserItemDto) => void
  readonly onNavigate: DriveBrowserNavigate
}) {
  return (
    <TableRow
      data-drive-telemetry-event='web.drive.item.open'
      role='link'
      tabIndex={0}
      className='cursor-pointer'
      onClick={() => onNavigate(item.browserUrl)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === 'Enter') onNavigate(item.browserUrl)
      }}
    >
      <TableCell>
        <div className='flex min-w-0 items-center gap-2'>
          <DriveBrowserItemIcon item={item} />
          <span className='min-w-0 truncate font-medium'>{item.name}</span>
        </div>
      </TableCell>
      <TableCell className='text-right tabular-nums text-muted-foreground'>{formatDriveBrowserSize(item)}</TableCell>
      <TableCell className='text-right tabular-nums text-muted-foreground'><RelativeTime value={item.updatedAt} className='tabular-nums' /></TableCell>
      <TableCell>
        <div className='flex justify-end gap-1'>
          <Button data-drive-telemetry-event='web.drive.share.open' type='button' variant='ghost' size='sm' onClick={(event) => {
            event.stopPropagation()
            onShare(item)
          }}>
            分享
          </Button>
          <Button data-drive-telemetry-event='web.drive.item.preview' type='button' variant='ghost' size='sm' onClick={(event) => {
            event.stopPropagation()
            onNavigate(item.browserUrl)
          }}>
            预览
          </Button>
          <Button data-drive-delete-action data-drive-item-id={item.id} data-drive-telemetry-event='web.drive.item.delete-open' type='button' variant='ghost' size='sm' onClick={(event) => {
            event.stopPropagation()
            onDelete(item, event.currentTarget)
          }}>
            删除
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                data-drive-telemetry-event='web.drive.item.actions.open'
                type='button'
                variant='ghost'
                size='icon'
                className='size-8'
                aria-label={`${item.name} 更多操作`}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-drive-telemetry-scope='portal' align='end' onClick={(event) => event.stopPropagation()}>
              <DropdownMenuGroup>
                <DropdownMenuItem data-drive-telemetry-event='web.drive.item.rename-open' onClick={() => onRename(item)}>
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem data-drive-telemetry-event='web.drive.item.move-open' onClick={() => onMove(item)}>
                  移动
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}
