import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import type { ChannelRetainedItem } from '@synapse/shared/channel-contracts'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ServerDataTable } from '@/components/data-table'
import { RelativeTime } from '@/components/relative-time'
import type { ChannelsModel } from './use-channels'

const noPageChange = () => undefined

export function ChannelRetained({ model, channelId }: { model: ChannelsModel; channelId: string }) {
  const [clearTarget, setClearTarget] = useState<ChannelRetainedItem | null>(null)

  async function confirmClear() {
    if (!clearTarget) return
    try {
      await model.clearRetained.mutateAsync({ id: channelId, event: clearTarget.event })
      setClearTarget(null)
    } catch {
      // Error toast is already surfaced by useChannels mutation onError.
    }
  }

  const columns: ColumnDef<ChannelRetainedItem>[] = [
    { id: 'event', header: '事件名', enableSorting: false, cell: ({ row }) => <span className='font-mono font-medium'>{row.original.event}</span> },
    {
      id: 'payload',
      header: '最新载荷',
      enableSorting: false,
      cell: ({ row }) => (
        <pre className='max-w-md truncate font-mono text-xs text-muted' title={JSON.stringify(row.original.payload)}>
          {JSON.stringify(row.original.payload)}
        </pre>
      ),
    },
    { id: 'seq', header: 'Seq', enableSorting: false, cell: ({ row }) => <span className='font-mono tabular-nums'>{row.original.seq}</span> },
    { id: 'updatedAt', header: '更新时间', enableSorting: false, cell: ({ row }) => <RelativeTime value={row.original.updatedAt} /> },
    {
      id: 'actions',
      header: '操作',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <Button size='sm' variant='danger-soft' onPress={() => setClearTarget(row.original)}>清除</Button>
      ),
    },
  ]

  const items = model.state.data?.retained ?? []

  return (
    <div className='space-y-4'>
      <ServerDataTable
        columns={columns}
        data={items}
        isLoading={model.state.isLoading}
        error={model.state.error}
        onRetry={() => void model.state.refetch()}
        emptyMessage='暂无 Retain 状态快照'
        page={1}
        pageSize={50}
        total={items.length}
        onPageChange={noPageChange}
        onPageSizeChange={noPageChange}
        showPagination={false}
        clampPage={false}
        toolbar={
          <div className='flex justify-end'>
            <Button variant='secondary' onPress={() => void model.state.refetch()}><RefreshCw />刷新</Button>
          </div>
        }
      />

      <ConfirmDialog
        open={Boolean(clearTarget)}
        onOpenChange={(open) => !open && setClearTarget(null)}
        title='清除状态快照'
        desc={`将静默删除事件「${clearTarget?.event ?? ''}」的 Retain 快照，不向在线客户端推送新事件。`}
        confirmText='清除'
        destructive
        isLoading={model.clearRetained.isPending}
        handleConfirm={() => void confirmClear()}
      />
    </div>
  )
}
