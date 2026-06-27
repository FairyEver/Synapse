import type { DashboardWebhookDto } from '@synapse/shared'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { DataTableColumnHeader } from '@/components/data-table'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getWebhookDeliveryStatusLabel,
} from './webhook-display'

type BuildWebhookColumnsInput = {
  onEdit: (webhook: DashboardWebhookDto) => void
  onToggle: (webhook: DashboardWebhookDto) => void
  onResetSecret: (webhook: DashboardWebhookDto) => void
  onOpenDeliveries: (webhook: DashboardWebhookDto) => void
  onDelete: (webhook: DashboardWebhookDto) => void
}

export function buildWebhookColumns({
  onEdit,
  onToggle,
  onResetSecret,
  onOpenDeliveries,
  onDelete,
}: BuildWebhookColumnsInput): ColumnDef<DashboardWebhookDto>[] {
  return [
    {
      id: 'webhook',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Webhook' />
      ),
      cell: ({ row }) => (
        <span className='block max-w-80 truncate font-medium'>
          {row.original.name}
        </span>
      ),
      enableSorting: false,
      meta: {
        tdClassName: 'min-w-56',
      },
    },
    {
      accessorKey: 'enabled',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='状态' />
      ),
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? 'default' : 'secondary'}>
          {row.original.enabled ? '启用' : '停用'}
        </Badge>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'lastDeliveryAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='最近触发' />
      ),
      cell: ({ row }) => (
        <span className='tabular-nums'>
          <RelativeTime value={row.original.lastDeliveryAt} />
        </span>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'lastDeliveryStatus',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='触发状态' />
      ),
      cell: ({ row }) =>
        row.original.lastDeliveryStatus ? (
          <Badge variant='outline'>
            {getWebhookDeliveryStatusLabel(row.original.lastDeliveryStatus)}
          </Badge>
        ) : (
          <span className='text-muted-foreground'>-</span>
        ),
      enableSorting: false,
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const webhook = row.original

        return (
          <div className='flex justify-end gap-1'>
            <Button asChild variant='ghost' className='h-8 px-2'>
              <Link
                to='/webhooks/$webhookId'
                params={{ webhookId: webhook.id }}
              >
                详情
              </Link>
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-8'
                  aria-label='Webhook 操作'
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => onOpenDeliveries(webhook)}>
                    查看记录
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEdit(webhook)}>
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onToggle(webhook)}>
                    {webhook.enabled ? '停用' : '启用'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onResetSecret(webhook)}>
                    重置 secret
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant='destructive'
                    onClick={() => onDelete(webhook)}
                  >
                    删除
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
      meta: {
        thClassName: 'text-right',
        tdClassName: 'text-right',
      },
    },
  ]
}
