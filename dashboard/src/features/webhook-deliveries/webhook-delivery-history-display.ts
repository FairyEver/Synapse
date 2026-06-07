import type { WebhookDeliveryHistoryDto, WebhookDeliveryStatus } from '@synapse/shared'

export type HistoryStatusBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export function getWebhookHistoryDisplayName(delivery: Pick<WebhookDeliveryHistoryDto, 'webhook'>) {
  return delivery.webhook.name
}

export function formatWebhookDeliveryClientSummary(
  delivery: Pick<WebhookDeliveryHistoryDto, 'acknowledgedClientCount' | 'sentClientCount' | 'onlineClientCount'>
) {
  return `${delivery.acknowledgedClientCount}/${delivery.sentClientCount}/${delivery.onlineClientCount}`
}

export function formatWebhookDeliveryHistoryBody(
  delivery: Pick<WebhookDeliveryHistoryDto, 'bodyKind' | 'bodySize'>
) {
  return `${delivery.bodyKind} · ${delivery.bodySize} B`
}

export function getWebhookDeliveryHistoryStatusBadgeVariant(
  status: WebhookDeliveryStatus
): HistoryStatusBadgeVariant {
  if (status === 'delivered') return 'default'
  if (status === 'broadcast_failed') return 'destructive'
  if (status === 'received' || status === 'sent') return 'outline'
  return 'secondary'
}

export function formatWebhookDeliveryHistoryDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}
