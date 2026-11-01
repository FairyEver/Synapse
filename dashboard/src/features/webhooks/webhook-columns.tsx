import { consoleHref } from '@/lib/console-href';
import { Link as HeroLink } from '@heroui/react';
import { Button, Chip, Dropdown, Separator } from '@heroui/react';
import type { DashboardWebhookDto } from '@synapse/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal } from 'lucide-react';
import { DataTableColumnHeader } from '@/components/data-table';
import { RelativeTime } from '@/components/relative-time';
import { getWebhookDeliveryStatusLabel, } from './webhook-display';
type BuildWebhookColumnsInput = {
    onEdit: (webhook: DashboardWebhookDto) => void;
    onToggle: (webhook: DashboardWebhookDto) => void;
    onResetSecret: (webhook: DashboardWebhookDto) => void;
    onOpenDeliveries: (webhook: DashboardWebhookDto) => void;
    onDelete: (webhook: DashboardWebhookDto) => void;
};
export function buildWebhookColumns({ onEdit, onToggle, onResetSecret, onOpenDeliveries, onDelete, }: BuildWebhookColumnsInput): ColumnDef<DashboardWebhookDto>[] {
    return [
        {
            id: 'webhook',
            header: ({ column }) => (<DataTableColumnHeader column={column} title='Webhook'/>),
            cell: ({ row }) => (<span className='block max-w-80 truncate font-medium'>
          {row.original.name}
        </span>),
            enableSorting: false,
            meta: { label: 'Webhook',
                tdClassName: 'min-w-56',
            },
        },
        {
            meta: { label: '状态' },
            accessorKey: 'enabled',
            header: ({ column }) => (<DataTableColumnHeader column={column} title='状态'/>),
            cell: ({ row }) => (<Chip variant={row.original.enabled ? "soft" : "secondary"}>
          {row.original.enabled ? '启用' : '停用'}
        </Chip>),
            enableSorting: false,
        },
        {
            meta: { label: '最近触发' },
            accessorKey: 'lastDeliveryAt',
            header: ({ column }) => (<DataTableColumnHeader column={column} title='最近触发'/>),
            cell: ({ row }) => (<span className='tabular-nums'>
          <RelativeTime value={row.original.lastDeliveryAt}/>
        </span>),
            enableSorting: false,
        },
        {
            meta: { label: '触发状态' },
            accessorKey: 'lastDeliveryStatus',
            header: ({ column }) => (<DataTableColumnHeader column={column} title='触发状态'/>),
            cell: ({ row }) => row.original.lastDeliveryStatus ? (<Chip variant="tertiary">
            {getWebhookDeliveryStatusLabel(row.original.lastDeliveryStatus)}
          </Chip>) : (<span className='text-muted'>-</span>),
            enableSorting: false,
        },
        {
            id: 'actions',
            cell: ({ row }) => {
                const webhook = row.original;
                return (<div className='flex justify-end gap-1'>
            <HeroLink className='h-8 px-2' href={consoleHref('/webhooks/$webhookId', { params: { webhookId: webhook.id } })}>
                详情
              </HeroLink>
            <Dropdown>
              <>
                <Button variant="ghost" isIconOnly className='size-8' aria-label='Webhook 操作'>
                  <MoreHorizontal />
                </Button>
              </>
              <Dropdown.Popover><Dropdown.Menu>
                <Dropdown.Section>
                  <Dropdown.Item onAction={() => onOpenDeliveries(webhook)} id="action-3570">
                    查看记录
                  </Dropdown.Item>
                  <Dropdown.Item onAction={() => onEdit(webhook)} id="action-3712">
                    重命名
                  </Dropdown.Item>
                  <Dropdown.Item onAction={() => onToggle(webhook)} id="action-3843">
                    {webhook.enabled ? '停用' : '启用'}
                  </Dropdown.Item>
                  <Dropdown.Item onAction={() => onResetSecret(webhook)} id="action-4004">
                    重置 secret
                  </Dropdown.Item>
                </Dropdown.Section>
                <Separator></Separator>
                <Dropdown.Section>
                  <Dropdown.Item variant="danger" onAction={() => onDelete(webhook)} id="action-4263">
                    删除
                  </Dropdown.Item>
                </Dropdown.Section>
              </Dropdown.Menu></Dropdown.Popover>
            </Dropdown>
          </div>);
            },
            enableSorting: false,
            enableHiding: false,
            meta: {
                thClassName: 'text-right',
                tdClassName: 'text-right',
            },
        },
    ];
}
