import type { DashboardWebhookDto, WebhookDeliveryClientReceiptStatus, WebhookDeliveryStatus } from '@synapse/shared'

type WebhookUrlLike = Pick<DashboardWebhookDto, 'url' | 'maskedUrl'>

const compactWebhookCardFieldLabels = [
  '最近触发',
  '触发状态',
] as const

export function getCompactWebhookCardFieldLabels() {
  return compactWebhookCardFieldLabels
}

export function findWebhookById<T extends { readonly id: string }>(
  webhooks: readonly T[],
  webhookId: string
): T | null {
  return webhooks.find((webhook) => webhook.id === webhookId) ?? null
}

export function getWebhookUrlDisplayState(webhook: WebhookUrlLike) {
  if (webhook.url) {
    return {
      kind: 'full' as const,
      label: webhook.url,
      copyValue: webhook.url,
    }
  }

  return {
    kind: 'masked' as const,
    label: webhook.maskedUrl,
    copyValue: null,
  }
}

export function formatOptionalWebhookDateTime(value: string | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-'
}

export function getWebhookCardPageState<T>(
  webhooks: readonly T[],
  total: number,
  pageSize: number
) {
  const safePageSize = Math.max(1, pageSize)
  const pageCount = Math.max(1, Math.ceil(total / safePageSize))

  return {
    pageCount,
    pageData: webhooks,
  }
}

export function getWebhookDeliveryStatusLabel(status: WebhookDeliveryStatus) {
  switch (status) {
    case 'received':
      return '服务端已接收'
    case 'no_online_clients':
      return '无在线桌面端'
    case 'sent':
      return '已发送到桌面端'
    case 'delivered':
      return '桌面端已确认'
    case 'broadcast_failed':
      return '发送失败'
    case 'rejected':
      return '已拒绝'
  }
}

export function getWebhookReceiptStatusLabel(status: WebhookDeliveryClientReceiptStatus) {
  switch (status) {
    case 'sent':
      return '已投递'
    case 'acknowledged':
      return '已收到'
    case 'send_failed':
      return '投递失败'
  }
}
