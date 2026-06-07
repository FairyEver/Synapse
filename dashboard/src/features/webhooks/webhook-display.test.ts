import { WEBHOOK_DELIVERY_STATUS } from '@synapse/shared'
import { describe, expect, it } from 'vitest'
import {
  formatOptionalWebhookDateTime,
  getWebhookCardPageState,
  getWebhookDeliveryStatusLabel,
  getWebhookReceiptStatusLabel,
  getWebhookUrlDisplayState,
} from './webhook-display'

describe('webhook display helpers', () => {
  it('always masks webhook URLs in the list', () => {
    expect(getWebhookUrlDisplayState({
      url: 'https://synapse.test/webhooks/wh_public/whsec_secret',
      maskedUrl: 'https://synapse.test/webhooks/wh_public/***',
    })).toEqual({
      kind: 'masked',
      label: 'https://synapse.test/webhooks/wh_public/***',
      copyValue: null,
    })

    expect(getWebhookUrlDisplayState({
      url: null,
      maskedUrl: 'https://synapse.test/webhooks/wh_public/***',
    })).toEqual({
      kind: 'masked',
      label: 'https://synapse.test/webhooks/wh_public/***',
      copyValue: null,
    })
  })

  it('uses precise delivery status labels', () => {
    expect(getWebhookDeliveryStatusLabel(WEBHOOK_DELIVERY_STATUS.received)).toBe('已接收')
    expect(getWebhookDeliveryStatusLabel(WEBHOOK_DELIVERY_STATUS.noOnlineClients)).toBe('无在线客户端')
    expect(getWebhookDeliveryStatusLabel(WEBHOOK_DELIVERY_STATUS.sent)).toBe('已投递')
    expect(getWebhookDeliveryStatusLabel(WEBHOOK_DELIVERY_STATUS.delivered)).toBe('客户端已收到')
    expect(getWebhookDeliveryStatusLabel(WEBHOOK_DELIVERY_STATUS.broadcastFailed)).toBe('投递失败')
  })

  it('labels client receipt statuses', () => {
    expect(getWebhookReceiptStatusLabel('sent')).toBe('已投递')
    expect(getWebhookReceiptStatusLabel('acknowledged')).toBe('已收到')
    expect(getWebhookReceiptStatusLabel('send_failed')).toBe('投递失败')
  })

  it('formats optional webhook date times', () => {
    expect(formatOptionalWebhookDateTime(undefined)).toBe('-')
    expect(formatOptionalWebhookDateTime('2026-06-07T02:03:04.000Z')).toBe(
      new Date('2026-06-07T02:03:04.000Z').toLocaleString('zh-CN')
    )
  })

  it('returns bounded page state for webhook cards', () => {
    const webhooks = Array.from({ length: 5 }, (_, index) => ({
      id: `id-${index + 1}`,
    }))

    expect(getWebhookCardPageState(webhooks, 1, 2)).toEqual({
      pageCount: 3,
      pageData: [{ id: 'id-1' }, { id: 'id-2' }],
    })
    expect(getWebhookCardPageState(webhooks, 4, 2)).toEqual({
      pageCount: 3,
      pageData: [{ id: 'id-5' }],
    })
    expect(getWebhookCardPageState([], 1, 20)).toEqual({
      pageCount: 1,
      pageData: [],
    })
  })
})
