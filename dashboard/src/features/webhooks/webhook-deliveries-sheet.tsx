import type { DashboardWebhookDto, WebhookDeliveryDto } from '@synapse/shared'
import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/lib/api'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type WebhookDeliveriesSheetProps = {
  webhook: DashboardWebhookDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const deliveryStatusLabel: Record<WebhookDeliveryDto['status'], string> = {
  accepted: '已转发',
  rejected: '已拒绝',
  broadcast_failed: '转发失败',
}

export function WebhookDeliveriesSheet({
  webhook,
  open,
  onOpenChange,
}: WebhookDeliveriesSheetProps) {
  const query = useQuery({
    queryKey: ['webhook-deliveries', webhook?.id],
    queryFn: () => dashboardApi.listWebhookDeliveries(webhook!.id),
    enabled: open && Boolean(webhook),
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{webhook?.name ?? '记录'}</SheetTitle>
          <SheetDescription>最近 100 条</SheetDescription>
        </SheetHeader>
        <div className='flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4'>
          {query.isLoading ? (
            <div className='text-muted-foreground'>加载中...</div>
          ) : query.isError ? (
            <div className='flex flex-col items-start gap-2'>
              <div className='text-sm text-muted-foreground'>
                {query.error.message}
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void query.refetch()}
              >
                重试
              </Button>
            </div>
          ) : query.data?.length ? (
            query.data.map((delivery) => (
              <DeliveryItem key={delivery.id} delivery={delivery} />
            ))
          ) : (
            <div className='text-muted-foreground'>暂无数据</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DeliveryItem({ delivery }: { delivery: WebhookDeliveryDto }) {
  return (
    <div className='rounded-md border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline'>{delivery.method}</Badge>
          <Badge
            variant={
              delivery.status === 'accepted'
                ? 'default'
                : delivery.status === 'broadcast_failed'
                  ? 'destructive'
                  : 'secondary'
            }
          >
            {deliveryStatusLabel[delivery.status]}
          </Badge>
        </div>
        <span className='text-sm text-muted-foreground'>
          {formatDateTime(delivery.receivedAt)}
        </span>
      </div>
      <div className='mt-3 grid gap-1 text-sm'>
        <div className='break-all text-muted-foreground'>{delivery.path}</div>
        <div>
          客户端 {delivery.sentClientCount}/{delivery.onlineClientCount}
          {delivery.failedClientCount > 0
            ? `，失败 ${delivery.failedClientCount}`
            : ''}
        </div>
        <div className='text-muted-foreground'>
          {delivery.bodyKind} · {delivery.bodySize} B
        </div>
        {delivery.bodyPreview ? (
          <pre className='max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap'>
            {delivery.bodyPreview}
          </pre>
        ) : null}
        {delivery.error ? (
          <div className='text-sm text-destructive'>{delivery.error}</div>
        ) : null}
      </div>
    </div>
  )
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

