import type { ReactNode } from 'react'
import type { WebhookDeliveryHistoryDto } from '@synapse/shared'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  getWebhookDeliveryStatusLabel,
  getWebhookReceiptStatusLabel,
} from '@/features/webhooks/webhook-display'
import {
  formatWebhookDeliveryHistoryBody,
  formatWebhookDeliveryHistoryDateTime,
  getWebhookDeliveryHistoryStatusBadgeVariant,
} from './webhook-delivery-history-display'

type DetailSheetProps = {
  delivery: WebhookDeliveryHistoryDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WebhookDeliveryHistoryDetailSheet({
  delivery,
  open,
  onOpenChange,
}: DetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{delivery?.webhook.name ?? '详情'}</SheetTitle>
        </SheetHeader>
        {delivery ? (
          <div className='flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 text-sm'>
            <div className='flex flex-wrap items-center gap-2'>
              <Badge variant='outline'>{delivery.method}</Badge>
              <Badge
                variant={getWebhookDeliveryHistoryStatusBadgeVariant(
                  delivery.status
                )}
              >
                {getWebhookDeliveryStatusLabel(delivery.status)}
              </Badge>
              {delivery.webhook.deletedAt ? (
                <Badge variant='secondary'>已删除</Badge>
              ) : null}
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
            <JsonBlock label='Query' value={delivery.query} />
            <JsonBlock label='Headers' value={delivery.headers} />
            {delivery.bodyPreview ? (
              <div className='grid gap-1'>
                <span className='text-xs font-medium text-muted-foreground'>
                  Body Preview
                </span>
                <pre className='max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap'>
                  {delivery.bodyPreview}
                </pre>
              </div>
            ) : null}
            {delivery.clientReceipts.length ? (
              <div className='grid gap-2'>
                <span className='text-xs font-medium text-muted-foreground'>
                  客户端
                </span>
                <div className='grid gap-2'>
                  {delivery.clientReceipts.map((receipt) => (
                    <div
                      key={receipt.id}
                      className='flex flex-wrap items-center gap-2'
                    >
                      <span>{receipt.deviceName}</span>
                      <Badge variant='outline'>
                        {getWebhookReceiptStatusLabel(receipt.status)}
                      </Badge>
                      <span className='text-muted-foreground'>
                        {formatWebhookDeliveryHistoryDateTime(
                          receipt.acknowledgedAt ?? receipt.sentAt
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {delivery.error ? (
              <div className='text-destructive'>{delivery.error}</div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function DetailField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className='grid gap-1'>
      <span className='text-xs font-medium text-muted-foreground'>{label}</span>
      <div className='break-all'>{children}</div>
    </div>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className='grid gap-1'>
      <span className='text-xs font-medium text-muted-foreground'>{label}</span>
      <pre className='max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap'>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
