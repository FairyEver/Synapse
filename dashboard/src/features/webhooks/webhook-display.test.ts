import { describe, expect, it } from 'vitest'

import {
  getWebhookDeliveryStatusBadgeVariant,
  getWebhookDeliveryStatusLabel,
} from './webhook-display'

describe('webhook delivery status display', () => {
  it('maps known delivery statuses to user-facing labels', () => {
    expect(getWebhookDeliveryStatusLabel('accepted')).toBe('已转发')
    expect(getWebhookDeliveryStatusLabel('rejected')).toBe('已拒绝')
    expect(getWebhookDeliveryStatusLabel('received')).toBe('已接收')
    expect(getWebhookDeliveryStatusLabel('broadcast_failed')).toBe('转发失败')
  })

  it('shows an empty delivery state when there is no latest delivery status', () => {
    expect(getWebhookDeliveryStatusLabel(undefined)).toBe('无记录')
    expect(getWebhookDeliveryStatusBadgeVariant(undefined)).toBe('outline')
  })

  it('uses the existing badge variants for delivery states', () => {
    expect(getWebhookDeliveryStatusBadgeVariant('accepted')).toBe('default')
    expect(getWebhookDeliveryStatusBadgeVariant('received')).toBe('outline')
    expect(getWebhookDeliveryStatusBadgeVariant('rejected')).toBe('secondary')
    expect(getWebhookDeliveryStatusBadgeVariant('broadcast_failed')).toBe(
      'destructive'
    )
  })
})
