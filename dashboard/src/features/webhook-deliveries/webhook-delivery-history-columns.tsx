import type { WebhookDeliveryHistoryDto } from '@synapse/shared'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getWebhookDeliveryStatusLabel } from '@/features/webhooks/webhook-display'
import {
  formatWebhookDeliveryClientSummary,
  formatWebhookDeliveryHistoryBody,
  formatWebhookDeliveryHistoryDateTime,
  getWebhookDeliveryHistoryStatusBadgeVariant,
  getWebhookHistoryDisplayName,
} from './webhook-delivery-history-display'

type BuildColumnsInput = {
  mode: 'user' | 'admin'
  onOpenDetail: (delivery: WebhookDeliveryHistoryDto) => void
}

export function buildWebhookDeliveryHistoryColumns({
  mode,
  onOpenDetail,
}: BuildColumnsInput): ColumnDef<WebhookDeliveryHistoryDto>[] {
  const columns: ColumnDef<WebhookDeliveryHistoryDto>[] = [
    {
      accessorKey: 'receivedAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='时间' />
      ),
      cell: ({ row }) =>
        formatWebhookDeliveryHistoryDateTime(row.original.receivedAt),
    },
    {
      id: 'webhook',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Webhook' />
      ),
      cell: ({ row }) => (
        <div className='flex min-w-0 flex-col gap-1'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate font-medium'>
              {getWebhookHistoryDisplayName(row.original)}
            </span>
            {row.original.webhook.deletedAt ? (
              <Badge variant='secondary'>已删除</Badge>
            ) : null}
          </div>
          <span className='truncate font-mono text-xs text-muted-foreground'>
            {row.original.webhook.publicId}
          </span>
        </div>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'method',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='方法' />
      ),
      cell: ({ row }) => <Badge variant='outline'>{row.original.method}</Badge>,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='状态' />
      ),
      cell: ({ row }) => (
        <Badge
          variant={getWebhookDeliveryHistoryStatusBadgeVariant(
            row.original.status
          )}
        >
          {getWebhookDeliveryStatusLabel(row.original.status)}
        </Badge>
      ),
    },
    {
      id: 'clients',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='客户端' />
      ),
      cell: ({ row }) => formatWebhookDeliveryClientSummary(row.original),
      enableSorting: false,
      meta: {
        thClassName: 'text-right',
        tdClassName: 'text-right tabular-nums',
      },
    },
    {
      id: 'body',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Body' />
      ),
      cell: ({ row }) => formatWebhookDeliveryHistoryBody(row.original),
      enableSorting: false,
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <Button
          variant='ghost'
          className='h-8 px-2'
          onClick={() => onOpenDetail(row.original)}
        >
          详情
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
      meta: { thClassName: 'text-right', tdClassName: 'text-right' },
    },
  ]

  if (mode === 'admin') {
    columns.splice(1, 0, {
      id: 'user',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='用户' />
      ),
      cell: ({ row }) => row.original.user?.email ?? '-',
      enableSorting: false,
    })
  }

  return columns
}
