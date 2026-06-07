import { WEBHOOK_DELIVERY_STATUS } from '@synapse/shared'
import { describe, expect, it } from 'vitest'
import {
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
})
