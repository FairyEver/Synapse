import type { DragEvent, ReactNode } from 'react'
import type { DriveBrowserItemDto, DriveBrowserSnapshotDto } from '@synapse/shared'
import { Archive, MoreHorizontal, Trash2 } from 'lucide-react'
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
  onPublishSite,
  onRename,
  onShare,
  onNavigate = navigateDriveBrowserUrl,
  onDropFiles,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly activeView: DriveConsoleSystemView
  readonly onOpenSystemView: (view: DriveConsoleSystemView) => void
  readonly onDelete: (item: DriveBrowserItemDto) => void
  readonly onMove: (item: DriveBrowserItemDto) => void
  readonly onPublishSite: (item: DriveBrowserItemDto) => void
  readonly onRename: (item: DriveBrowserItemDto) => void
  readonly onShare: (item: DriveBrowserItemDto) => void
  readonly onNavigate?: DriveBrowserNavigate
  readonly onDropFiles: (files: readonly File[]) => void
}) {
  if (activeView !== 'files') return null

  const rootSystemRows = snapshot.breadcrumbs.length <= 1
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files ?? [])
    onDropFiles(files)
  }

  return (
    <div
      data-testid='drive-console-dropzone'
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
              onPublishSite={onPublishSite}
              onRename={onRename}
              onShare={onShare}
              onNavigate={onNavigate}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SystemRow({ icon, name, onOpen }: { readonly icon: ReactNode; readonly name: string; readonly onOpen: () => void }) {
  return (
    <TableRow className='cursor-pointer' onClick={onOpen}>
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
  onPublishSite,
  onRename,
  onShare,
  onNavigate,
}: {
  readonly item: DriveBrowserItemDto
  readonly onDelete: (item: DriveBrowserItemDto) => void
  readonly onMove: (item: DriveBrowserItemDto) => void
  readonly onPublishSite: (item: DriveBrowserItemDto) => void
  readonly onRename: (item: DriveBrowserItemDto) => void
  readonly onShare: (item: DriveBrowserItemDto) => void
  readonly onNavigate: DriveBrowserNavigate
}) {
  return (
    <TableRow
      role='link'
      tabIndex={0}
      className='cursor-pointer'
      onClick={() => onNavigate(item.browserUrl)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onNavigate(item.browserUrl)
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
          <Button type='button' variant='ghost' size='sm' onClick={(event) => {
            event.stopPropagation()
            onShare(item)
          }}>
            分享
          </Button>
          <Button type='button' variant='ghost' size='sm' onClick={(event) => {
            event.stopPropagation()
            onNavigate(item.browserUrl)
          }}>
            预览
          </Button>
          <Button type='button' variant='ghost' size='sm' onClick={(event) => {
            event.stopPropagation()
            onDelete(item)
          }}>
            删除
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
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
            <DropdownMenuContent align='end' onClick={(event) => event.stopPropagation()}>
              <DropdownMenuGroup>
                {item.type === 'folder' ? (
                  <DropdownMenuItem onClick={() => onPublishSite(item)}>
                    发布站点
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => onRename(item)}>
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMove(item)}>
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
