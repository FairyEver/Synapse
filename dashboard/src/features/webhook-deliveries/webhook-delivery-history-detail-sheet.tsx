import { Chip, Drawer } from '@heroui/react';
import type { ReactNode } from 'react';
import type { WebhookDeliveryHistoryDto } from '@synapse/shared';
import { getWebhookDeliveryStatusLabel, getWebhookReceiptStatusLabel, } from '@/features/webhooks/webhook-display';
import { formatWebhookDeliveryHistoryBody, formatWebhookDeliveryHistoryDateTime, getWebhookDeliveryHistoryStatusColor, } from './webhook-delivery-history-display';
type DetailSheetProps = {
    delivery: WebhookDeliveryHistoryDto | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};
export function WebhookDeliveryHistoryDetailSheet({ delivery, open, onOpenChange, }: DetailSheetProps) {
    return (<Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right"><Drawer.Dialog className='sm:max-w-xl'><Drawer.CloseTrigger />
        <Drawer.Header className='pe-10'>
          <Drawer.Heading className='min-w-0 wrap-anywhere'>{delivery?.webhook.name ?? '详情'}</Drawer.Heading>
        </Drawer.Header>
        {delivery ? (<Drawer.Body className='flex flex-col gap-4'>
            <div className='flex flex-wrap items-center gap-2'>
              <Chip color="default">{delivery.method}</Chip>
              <Chip color={getWebhookDeliveryHistoryStatusColor(delivery.status)}>
                {getWebhookDeliveryStatusLabel(delivery.status)}
              </Chip>
              {delivery.webhook.deletedAt ? (<Chip color="default">已删除</Chip>) : null}
            </div>
            <DetailField label='时间'>
              {formatWebhookDeliveryHistoryDateTime(delivery.receivedAt)}
            </DetailField>
            <DetailField label='Public ID'>
              {delivery.webhook.publicId}
            </DetailField>
            <DetailField label='路径'>{delivery.path}</DetailField>
            <DetailField label='客户端'>
              已确认 {delivery.acknowledgedClientCount} / 已发送{' '}
              {delivery.sentClientCount} / 在线 {delivery.onlineClientCount}
            </DetailField>
            <DetailField label='Body'>
              {formatWebhookDeliveryHistoryBody(delivery)}
            </DetailField>
            <JsonBlock label='Query' value={delivery.query}/>
            <JsonBlock label='Headers' value={delivery.headers}/>
            {delivery.bodyPreview ? (<div className='grid gap-1'>
                <span className='text-xs font-medium text-muted'>
                  Body Preview
                </span>
                <pre className='max-h-48 overflow-auto rounded-md bg-surface-secondary p-2 text-xs whitespace-pre-wrap'>
                  {delivery.bodyPreview}
                </pre>
              </div>) : null}
            {delivery.clientReceipts.length ? (<div className='grid gap-2'>
                <span className='text-xs font-medium text-muted'>
                  客户端
                </span>
                <div className='grid gap-2'>
                  {delivery.clientReceipts.map((receipt) => (<div key={receipt.id} className='flex flex-wrap items-center gap-2'>
                      <span>{receipt.deviceName}</span>
                      <Chip color="default">
                        {getWebhookReceiptStatusLabel(receipt.status)}
                      </Chip>
                      <span className='text-muted'>
                        {formatWebhookDeliveryHistoryDateTime(receipt.acknowledgedAt ?? receipt.sentAt)}
                      </span>
                    </div>))}
                </div>
              </div>) : null}
            {delivery.error ? (<div className='text-danger'>{delivery.error}</div>) : null}
          </Drawer.Body>) : null}
      </Drawer.Dialog></Drawer.Content>
    </Drawer.Backdrop>);
}
function DetailField({ label, children, }: {
    label: string;
    children: ReactNode;
}) {
    return (<div className='grid gap-1'>
      <span className='text-xs font-medium text-muted'>{label}</span>
      <div className='break-all'>{children}</div>
    </div>);
}
function JsonBlock({ label, value }: {
    label: string;
    value: unknown;
}) {
    return (<div className='grid gap-1'>
      <span className='text-xs font-medium text-muted'>{label}</span>
      <pre className='max-h-48 overflow-auto rounded-md bg-surface-secondary p-2 text-xs whitespace-pre-wrap'>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>);
}
