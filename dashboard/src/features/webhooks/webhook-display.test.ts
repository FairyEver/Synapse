import { WEBHOOK_DELIVERY_STATUS } from '@synapse/shared'
import { describe, expect, it } from 'vitest'
import {
  findWebhookById,
  formatOptionalWebhookDateTime,
  getCompactWebhookCardFieldLabels,
  getWebhookCardPageState,
  getWebhookDeliveryStatusLabel,
  getWebhookReceiptStatusLabel,
  getWebhookUrlDisplayState,
} from './webhook-display'

describe('webhook display helpers', () => {
  it('keeps compact cards focused on high-signal fields', () => {
    expect(getCompactWebhookCardFieldLabels()).toEqual([
      '最近触发',
      '触发状态',
    ])
    expect(getCompactWebhookCardFieldLabels()).not.toContain('Public ID')
    expect(getCompactWebhookCardFieldLabels()).not.toContain('URL')
    expect(getCompactWebhookCardFieldLabels()).not.toContain('创建时间')
  })

  it('finds a webhook for detail pages by id', () => {
    const webhooks = [
      { id: 'webhook-1', name: 'A' },
      { id: 'webhook-2', name: 'B' },
    ]

    expect(findWebhookById(webhooks, 'webhook-2')).toEqual({
      id: 'webhook-2',
      name: 'B',
    })
    expect(findWebhookById(webhooks, 'missing')).toBeNull()
  })

  it('uses full webhook URLs when available', () => {
    expect(getWebhookUrlDisplayState({
      url: 'https://synapse.test/webhooks/wh_public/whsec_secret',
      maskedUrl: 'https://synapse.test/webhooks/wh_public/***',
    })).toEqual({
      kind: 'full',
      label: 'https://synapse.test/webhooks/wh_public/whsec_secret',
      copyValue: 'https://synapse.test/webhooks/wh_public/whsec_secret',
    })
  })

  it('falls back to masked webhook URLs for legacy webhooks', () => {
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
    expect(getWebhookDeliveryStatusLabel(WEBHOOK_DELIVERY_STATUS.received)).toBe('服务端已接收')
    expect(getWebhookDeliveryStatusLabel(WEBHOOK_DELIVERY_STATUS.noOnlineClients)).toBe('无在线桌面端')
    expect(getWebhookDeliveryStatusLabel(WEBHOOK_DELIVERY_STATUS.sent)).toBe('已发送到桌面端')
    expect(getWebhookDeliveryStatusLabel(WEBHOOK_DELIVERY_STATUS.delivered)).toBe('桌面端已确认')
    expect(getWebhookDeliveryStatusLabel(WEBHOOK_DELIVERY_STATUS.broadcastFailed)).toBe('发送失败')
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

    expect(getWebhookCardPageState(webhooks.slice(0, 2), 5, 2)).toEqual({
      pageCount: 3,
      pageData: [{ id: 'id-1' }, { id: 'id-2' }],
    })
    expect(getWebhookCardPageState(webhooks.slice(4, 5), 5, 2)).toEqual({
      pageCount: 3,
      pageData: [{ id: 'id-5' }],
    })
    expect(getWebhookCardPageState([], 0, 20)).toEqual({
      pageCount: 1,
      pageData: [],
    })
  })
})
