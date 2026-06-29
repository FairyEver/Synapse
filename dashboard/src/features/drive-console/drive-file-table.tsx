import type { ReactNode } from 'react'
import type { DriveBrowserItemDto, DriveBrowserSnapshotDto } from '@synapse/shared'
import { Image, Trash2 } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
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

export type DriveConsoleSystemView = 'files' | 'public-assets' | 'trash'

export function DriveFileTable({
  snapshot,
  activeView,
  onOpenSystemView,
  onDelete,
  onMove,
  onRename,
  onShare,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly activeView: DriveConsoleSystemView
  readonly onOpenSystemView: (view: DriveConsoleSystemView) => void
  readonly onDelete: (item: DriveBrowserItemDto) => void
  readonly onMove: (item: DriveBrowserItemDto) => void
  readonly onRename: (item: DriveBrowserItemDto) => void
  readonly onShare: (item: DriveBrowserItemDto) => void
}) {
  if (activeView !== 'files') return null

  const rootSystemRows = snapshot.breadcrumbs.length <= 1
  return (
    <div className='rounded-lg border bg-background'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className='w-28 text-right'>大小</TableHead>
            <TableHead className='w-40 text-right'>更新时间</TableHead>
            <TableHead className='w-52 text-right' aria-label='操作' />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rootSystemRows ? (
            <>
              <SystemRow icon={<Image className='size-4 text-muted-foreground' />} name='公开素材' onOpen={() => onOpenSystemView('public-assets')} />
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
  onRename,
  onShare,
}: {
  readonly item: DriveBrowserItemDto
  readonly onDelete: (item: DriveBrowserItemDto) => void
  readonly onMove: (item: DriveBrowserItemDto) => void
  readonly onRename: (item: DriveBrowserItemDto) => void
  readonly onShare: (item: DriveBrowserItemDto) => void
}) {
  return (
    <TableRow
      role='link'
      tabIndex={0}
      className='cursor-pointer'
      onClick={() => window.location.assign(item.browserUrl)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') window.location.assign(item.browserUrl)
      }}
    >
      <TableCell>
        <div className='flex min-w-0 items-center gap-2'>
          <DriveBrowserItemIcon item={item} />
          <span className='min-w-0 truncate font-medium'>{item.name}</span>
        </div>
      </TableCell>
      <TableCell className='text-right text-muted-foreground'>{formatDriveBrowserSize(item)}</TableCell>
      <TableCell className='text-right text-muted-foreground'><RelativeTime value={item.updatedAt} /></TableCell>
      <TableCell className='text-right'>
        <Button type='button' variant='ghost' size='sm' onClick={(event) => {
          event.stopPropagation()
          onShare(item)
        }}>
          分享
        </Button>
        <Button type='button' variant='ghost' size='sm' onClick={(event) => {
          event.stopPropagation()
          window.location.assign(item.browserUrl)
        }}>
          预览
        </Button>
        <Button type='button' variant='ghost' size='sm' onClick={(event) => {
          event.stopPropagation()
          onDelete(item)
        }}>
          删除
        </Button>
        <Button type='button' variant='ghost' size='sm' onClick={(event) => {
          event.stopPropagation()
          onMove(item)
        }}>
          移动
        </Button>
        <Button type='button' variant='ghost' size='sm' onClick={(event) => {
          event.stopPropagation()
          onRename(item)
        }}>
          更多
        </Button>
      </TableCell>
    </TableRow>
  )
}
