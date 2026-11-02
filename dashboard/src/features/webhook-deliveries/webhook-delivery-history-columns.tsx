import { Button, Chip } from '@heroui/react'
import type { WebhookDeliveryHistoryDto } from '@synapse/shared'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table'
import { LongText } from '@/components/long-text'
import { getWebhookDeliveryStatusLabel } from '@/features/webhooks/webhook-display'
import { formatWebhookDeliveryClientSummary, formatWebhookDeliveryHistoryBody, formatWebhookDeliveryHistoryDateTime, getWebhookDeliveryHistoryStatusColor, getWebhookHistoryDisplayName } from './webhook-delivery-history-display'

type BuildColumnsInput = {
  mode: 'user' | 'admin'
  onOpenDetail: (delivery: WebhookDeliveryHistoryDto) => void
  showWebhook?: boolean
}

export function buildWebhookDeliveryHistoryColumns({ mode, onOpenDetail, showWebhook = true }: BuildColumnsInput): ColumnDef<WebhookDeliveryHistoryDto>[] {
  const columns: ColumnDef<WebhookDeliveryHistoryDto>[] = [
    {
      accessorKey: 'receivedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title='接收时间' />,
      cell: ({ row }) => <span className='tabular-nums'>{formatWebhookDeliveryHistoryDateTime(row.original.receivedAt)}</span>,
      meta: { label: '接收时间', className: 'w-44' },
    },
    ...(showWebhook ? [{
      id: 'webhook', header: 'Webhook', enableSorting: false,
      cell: ({ row }) => <div className='grid min-w-0 gap-1'>
        <div className='flex min-w-0 items-center gap-2'><span className='max-w-56 truncate font-medium' title={getWebhookHistoryDisplayName(row.original)}>{getWebhookHistoryDisplayName(row.original)}</span>{row.original.webhook.deletedAt && <Chip size='sm' variant='secondary'>已删除</Chip>}</div>
        <span className='truncate font-mono text-xs text-muted'>{row.original.webhook.publicId}</span>
      </div>,
      meta: { label: 'Webhook', className: 'w-64 max-w-64' },
    } satisfies ColumnDef<WebhookDeliveryHistoryDto>] : []),
    {
      accessorKey: 'status', header: ({ column }) => <DataTableColumnHeader column={column} title='投递状态' />,
      cell: ({ row }) => <Chip variant='soft' color={getWebhookDeliveryHistoryStatusColor(row.original.status)}>{getWebhookDeliveryStatusLabel(row.original.status)}</Chip>,
      meta: { label: '投递状态' },
    },
    {
      id: 'clients', header: '桌面端回执', enableSorting: false,
      cell: ({ row }) => <span className='text-sm tabular-nums'>{formatWebhookDeliveryClientSummary(row.original)}</span>,
      meta: { label: '桌面端回执', tdClassName: 'text-right', thClassName: 'text-right' },
    },
    {
      accessorKey: 'method', header: ({ column }) => <DataTableColumnHeader column={column} title='请求' />,
      cell: ({ row }) => <div className='grid gap-1'><span className='font-mono text-sm'>{row.original.method}</span><span className='text-xs text-muted'>{formatWebhookDeliveryHistoryBody(row.original)}</span></div>,
      meta: { label: '请求' },
    },
    {
      id: 'actions', header: '操作', enableSorting: false, enableHiding: false,
      cell: ({ row }) => <Button variant='ghost' size='sm' onPress={() => onOpenDetail(row.original)}>查看详情</Button>,
      meta: { thClassName: 'text-right', tdClassName: 'text-right' },
    },
  ]
  if (mode === 'admin') columns.splice(1, 0, {
    id: 'user', header: '用户', enableSorting: false,
    cell: ({ row }) => <LongText>{row.original.user?.email ?? '-'}</LongText>,
    meta: { label: '用户', className: 'w-56 max-w-56' },
  })
  return columns
}
