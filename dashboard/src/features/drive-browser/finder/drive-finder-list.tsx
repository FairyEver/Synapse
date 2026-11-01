import { Button, Table } from '@heroui/react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Loader2 } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { cn } from '@/lib/utils'
import { formatDriveBrowserSize } from '../shared/drive-format'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import {
  navigateDriveBrowserUrl,
  type DriveBrowserNavigate,
} from '../shared/drive-navigation'
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
      <div className='flex h-full min-h-72 items-center justify-center text-sm text-muted'>
        暂无文件
      </div>
    )
  }
  const canLoadMoreChildren = Boolean(
    snapshot.childrenPage?.hasMore && onLoadMoreChildren
  )
  return (
    <div className={'h-full min-h-0' + ' overflow-y-auto min-h-0'}>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label='文件列表'>
            <Table.Header>
              <Table.Column isRowHeader>名称</Table.Column>
              <Table.Column className='w-28 text-right'>大小</Table.Column>
              <Table.Column className='w-40'>更新时间</Table.Column>
            </Table.Header>
            <Table.Body>
              {snapshot.children.map((item) => {
                const selected = snapshot.current.id === item.id
                return (
                  <Table.Row
                    data-drive-telemetry-event='web.drive.item.open'
                    id={item.id}
                    key={item.id}
                    textValue={item.name}
                    className={cn(
                      'cursor-pointer',
                      selected && 'bg-surface-secondary'
                    )}
                    onAction={() => onNavigate(item.browserUrl)}
                  >
                    <Table.Cell>
                      <div className='flex min-w-0 items-center gap-2'>
                        <DriveBrowserItemIcon item={item} />
                        <span className='min-w-0 truncate font-medium'>
                          {item.name}
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className='text-right text-muted'>
                      {formatDriveBrowserSize(item)}
                    </Table.Cell>
                    <Table.Cell className='text-muted'>
                      <RelativeTime value={item.updatedAt} />
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      {canLoadMoreChildren || loadMoreChildrenError ? (
        <div className='flex flex-col items-center gap-2 border-t px-3 py-3'>
          {canLoadMoreChildren ? (
            <Button
              data-drive-telemetry-event='web.drive.children.load-more'
              type='button'
              variant='outline'
              size='sm'
              onPress={onLoadMoreChildren}
              isDisabled={loadingMoreChildren}
            >
              {loadingMoreChildren ? (
                <Loader2 data-icon='inline-start' className='animate-spin' />
              ) : null}
              加载更多
            </Button>
          ) : null}
          {loadMoreChildrenError ? (
            <div className='text-sm text-danger'>{loadMoreChildrenError}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
