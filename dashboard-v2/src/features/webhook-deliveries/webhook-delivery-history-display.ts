import type { WebhookDeliveryHistoryDto, WebhookDeliveryStatus } from '@synapse/shared'

export type HistoryStatusColor = 'success' | 'default' | 'danger' | 'accent'

export type WebhookDeliveryHistoryQueryDraft = {
  page: number
  pageSize: number
  sortBy: string
  sortOrder: 'asc' | 'desc'
  webhookId?: string
  status?: string
  from?: string
  to?: string
  user?: string
  userId?: string
}

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

export function getWebhookDeliveryHistoryStatusColor(
  status: WebhookDeliveryStatus
): HistoryStatusColor {
  if (status === 'delivered') return 'success'
  if (status === 'broadcast_failed') return 'danger'
  if (status === 'received' || status === 'sent') return 'accent'
  return 'default'
}

export function formatWebhookDeliveryHistoryDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

export function buildWebhookDeliveryHistoryQuery(
  input: WebhookDeliveryHistoryQueryDraft
) {
  return {
    page: input.page,
    pageSize: input.pageSize,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    ...(input.webhookId?.trim() ? { webhookId: input.webhookId.trim() } : {}),
    ...(input.status?.trim() ? { status: input.status.trim() } : {}),
    ...(input.from?.trim() ? { from: input.from.trim() } : {}),
    ...(input.to?.trim() ? { to: input.to.trim() } : {}),
    ...(input.user?.trim() ? { user: input.user.trim() } : {}),
    ...(input.userId?.trim() ? { userId: input.userId.trim() } : {}),
  }
}
