import type { DashboardWebhookDto, WebhookDeliveryClientReceiptStatus, WebhookDeliveryStatus } from '@synapse/shared'

type WebhookUrlLike = Pick<DashboardWebhookDto, 'url' | 'maskedUrl'>

export function getWebhookUrlDisplayState(webhook: WebhookUrlLike) {
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
  page: number,
  pageSize: number
) {
  const safePageSize = Math.max(1, pageSize)
  const pageCount = Math.max(1, Math.ceil(webhooks.length / safePageSize))
  const boundedPage = Math.min(Math.max(1, page), pageCount)
  const start = (boundedPage - 1) * safePageSize

  return {
    pageCount,
    pageData: webhooks.slice(start, start + safePageSize),
  }
}

export function getWebhookDeliveryStatusLabel(status: WebhookDeliveryStatus) {
  switch (status) {
    case 'received':
      return '已接收'
    case 'no_online_clients':
      return '无在线客户端'
    case 'sent':
      return '已投递'
    case 'delivered':
      return '客户端已收到'
    case 'broadcast_failed':
      return '投递失败'
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
