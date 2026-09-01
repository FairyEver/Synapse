import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Loader2 } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatDriveBrowserSize } from '../shared/drive-format'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import { navigateDriveBrowserUrl, type DriveBrowserNavigate } from '../shared/drive-navigation'

export function DriveFinderList({
  snapshot,
  onNavigate = navigateDriveBrowserUrl,
  onLoadMoreChildren,
  loadingMoreChildren = false,
  loadMoreChildrenError = null,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly onNavigate?: DriveBrowserNavigate
  readonly onLoadMoreChildren?: () => void
  readonly loadingMoreChildren?: boolean
  readonly loadMoreChildrenError?: string | null
}) {
  if (snapshot.children.length === 0) {
    return (
      <div className='flex h-full min-h-72 items-center justify-center text-sm text-muted-foreground'>
        暂无文件
      </div>
    )
  }

  const canLoadMoreChildren = Boolean(snapshot.childrenPage?.hasMore && onLoadMoreChildren)

  return (
    <ScrollArea className='h-full min-h-0'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className='w-28 text-right'>大小</TableHead>
            <TableHead className='w-40'>更新时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.children.map((item) => {
            const selected = snapshot.current.id === item.id
            return (
              <TableRow
                data-drive-telemetry-event='web.drive.item.open'
                key={item.id}
                role='link'
                tabIndex={0}
                aria-current={selected ? 'page' : undefined}
                className={cn('cursor-pointer', selected && 'bg-muted')}
                onClick={() => {
                  onNavigate(item.browserUrl)
                }}
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
                <TableCell className='text-right text-muted-foreground'>
                  {formatDriveBrowserSize(item)}
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  <RelativeTime value={item.updatedAt} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {canLoadMoreChildren || loadMoreChildrenError ? (
        <div className='flex flex-col items-center gap-2 border-t px-3 py-3'>
          {canLoadMoreChildren ? (
            <Button
              data-drive-telemetry-event='web.drive.children.load-more'
              type='button'
              variant='outline'
              size='sm'
              onClick={onLoadMoreChildren}
              disabled={loadingMoreChildren}
            >
              {loadingMoreChildren ? <Loader2 data-icon='inline-start' className='animate-spin' /> : null}
              加载更多
            </Button>
          ) : null}
          {loadMoreChildrenError ? (
            <div className='text-sm text-destructive'>{loadMoreChildrenError}</div>
          ) : null}
        </div>
      ) : null}
    </ScrollArea>
  )
}
