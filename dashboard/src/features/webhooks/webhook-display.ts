import type { WebhookDeliveryStatus } from '@synapse/shared'

type WebhookDeliveryStatusBadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'

const deliveryStatusLabel: Record<WebhookDeliveryStatus, string> = {
  accepted: '已转发',
  rejected: '已拒绝',
  broadcast_failed: '转发失败',
}

const deliveryStatusBadgeVariant: Record<
  WebhookDeliveryStatus,
  WebhookDeliveryStatusBadgeVariant
> = {
  accepted: 'default',
  rejected: 'secondary',
  broadcast_failed: 'destructive',
}

export function getWebhookDeliveryStatusLabel(
  status: WebhookDeliveryStatus | undefined
) {
  return status ? deliveryStatusLabel[status] : '无记录'
}

export function getWebhookDeliveryStatusBadgeVariant(
  status: WebhookDeliveryStatus | undefined
): WebhookDeliveryStatusBadgeVariant {
  return status ? deliveryStatusBadgeVariant[status] : 'outline'
}
