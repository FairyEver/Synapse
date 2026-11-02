import { Button, Chip, Dropdown, Label, Link, Separator } from '@heroui/react'
import type { DashboardWebhookDto } from '@synapse/shared'
import type { ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { consoleHref } from '@/lib/console-href'
import { RelativeTime } from '@/components/relative-time'
import { getWebhookDeliveryHistoryStatusColor } from '../webhook-deliveries/webhook-delivery-history-display'
import { getWebhookDeliveryStatusLabel } from './webhook-display'

type BuildWebhookColumnsInput = {
  onEdit: (webhook: DashboardWebhookDto) => void
  onToggle: (webhook: DashboardWebhookDto) => void
  onResetSecret: (webhook: DashboardWebhookDto) => void
  onOpenDeliveries: (webhook: DashboardWebhookDto) => void
  onDelete: (webhook: DashboardWebhookDto) => void
  isUpdating?: boolean
}

export function buildWebhookColumns({ onEdit, onToggle, onResetSecret, onOpenDeliveries, onDelete, isUpdating }: BuildWebhookColumnsInput): ColumnDef<DashboardWebhookDto>[] {
  return [
    {
      id: 'webhook', header: 'Webhook', enableSorting: false, enableHiding: false,
      cell: ({ row }) => <Link className='block max-w-80 truncate font-medium'
        href={consoleHref('/webhooks/$webhookId', { params: { webhookId: row.original.id } })}><span title={row.original.name}>{row.original.name}</span></Link>,
      meta: { label: 'Webhook', tdClassName: 'min-w-48' },
    },
    {
      accessorKey: 'enabled', header: '接收状态', enableSorting: false,
      cell: ({ row }) => <Chip color={row.original.enabled ? 'success' : 'default'} variant='soft'>{row.original.enabled ? '已启用' : '已停用'}</Chip>,
      meta: { label: '接收状态' },
    },
    {
      accessorKey: 'lastDeliveryAt', header: '最近触发', enableSorting: false,
      cell: ({ row }) => <div className='grid gap-1 text-sm'>
        {row.original.lastDeliveryStatus && <Chip variant='soft' color={getWebhookDeliveryHistoryStatusColor(row.original.lastDeliveryStatus)}>{getWebhookDeliveryStatusLabel(row.original.lastDeliveryStatus)}</Chip>}
        <span className='text-muted'>{row.original.lastDeliveryAt ? <RelativeTime value={row.original.lastDeliveryAt} /> : '尚未触发'}</span>
      </div>,
      meta: { label: '最近触发' },
    },
    {
      id: 'actions', header: '操作', enableSorting: false, enableHiding: false,
      cell: ({ row }) => {
        const webhook = row.original
        return <div className='flex items-center justify-end gap-2'>
          <Button variant='ghost' size='sm' onPress={() => onOpenDeliveries(webhook)}>触发记录</Button>
          <Dropdown>
            <Button variant='ghost' size='sm' isIconOnly aria-label={`${webhook.name} 的操作`}><MoreHorizontal /></Button>
            <Dropdown.Popover><Dropdown.Menu aria-label='Webhook 操作'>
              <Dropdown.Section>
                <Dropdown.Item id='rename' onAction={() => onEdit(webhook)}><Label>重命名</Label></Dropdown.Item>
                <Dropdown.Item id='toggle' isDisabled={isUpdating} onAction={() => onToggle(webhook)}><Label>{webhook.enabled ? '停用接收' : '启用接收'}</Label></Dropdown.Item>
              </Dropdown.Section>
              <Separator />
              <Dropdown.Section>
                <Dropdown.Item id='reset' onAction={() => onResetSecret(webhook)}><Label>重置调用地址</Label></Dropdown.Item>
                <Dropdown.Item id='delete' variant='danger' onAction={() => onDelete(webhook)}><Label>删除 Webhook</Label></Dropdown.Item>
              </Dropdown.Section>
            </Dropdown.Menu></Dropdown.Popover>
          </Dropdown>
        </div>
      },
      meta: { thClassName: 'text-right', tdClassName: 'text-right' },
    },
  ]
}
