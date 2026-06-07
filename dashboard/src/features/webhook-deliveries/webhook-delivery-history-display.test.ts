import { WEBHOOK_DELIVERY_STATUS, type WebhookDeliveryHistoryDto } from '@synapse/shared'
import { describe, expect, it } from 'vitest'
import {
  formatWebhookDeliveryClientSummary,
  formatWebhookDeliveryHistoryBody,
  getWebhookDeliveryHistoryStatusBadgeVariant,
  getWebhookHistoryDisplayName,
} from './webhook-delivery-history-display'

function row(input: Partial<WebhookDeliveryHistoryDto> = {}): WebhookDeliveryHistoryDto {
  return {
    id: 'delivery-1',
    webhookId: 'webhook-1',
    method: 'POST',
    path: '/webhooks/wh_public/***',
    query: {},
    headers: {},
    bodyKind: 'json',
    bodySize: 12,
    receivedAt: '2026-06-07T09:00:00.000Z',
    onlineClientCount: 2,
    sentClientCount: 2,
    failedClientCount: 0,
    acknowledgedClientCount: 1,
    clientReceipts: [],
    status: WEBHOOK_DELIVERY_STATUS.sent,
    webhook: {
      id: 'webhook-1',
      publicId: 'wh_public',
      name: 'GitHub',
    },
    ...input,
  }
}

describe('webhook delivery history display helpers', () => {
  it('uses the delivery-time webhook snapshot name', () => {
    expect(getWebhookHistoryDisplayName(row({
      webhook: {
        id: 'webhook-1',
        publicId: 'wh_public',
        name: 'Old name',
        currentName: 'New name',
      },
    }))).toBe('Old name')
  })

  it('formats compact client and body summaries', () => {
    expect(formatWebhookDeliveryClientSummary(row())).toBe('1/2/2')
    expect(formatWebhookDeliveryHistoryBody(row())).toBe('json · 12 B')
  })

  it('maps delivery status to badge variants', () => {
    expect(getWebhookDeliveryHistoryStatusBadgeVariant(WEBHOOK_DELIVERY_STATUS.delivered)).toBe('default')
    expect(getWebhookDeliveryHistoryStatusBadgeVariant(WEBHOOK_DELIVERY_STATUS.broadcastFailed)).toBe('destructive')
    expect(getWebhookDeliveryHistoryStatusBadgeVariant(WEBHOOK_DELIVERY_STATUS.noOnlineClients)).toBe('secondary')
  })
})
