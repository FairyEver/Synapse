import type { DashboardWebhookDto } from '@synapse/shared'
import { describe, expect, it } from 'vitest'

import { getWebhookDeliveriesHref, removeDeletedWebhookFromCache } from './index'

function webhook(id: string): DashboardWebhookDto {
  return {
    id,
    publicId: `wh_${id}`,
    name: id,
    enabled: true,
    maskedUrl: `https://synapse.test/webhooks/wh_${id}/***`,
    createdAt: '2026-06-06T10:00:00.000Z',
    updatedAt: '2026-06-06T10:00:00.000Z',
  }
}

describe('removeDeletedWebhookFromCache', () => {
  it('builds a filtered history href for a webhook', () => {
    expect(getWebhookDeliveriesHref('webhook-1')).toBe(
      '/webhook-deliveries?webhookId=webhook-1'
    )
    expect(getWebhookDeliveriesHref('webhook/with space')).toBe(
      '/webhook-deliveries?webhookId=webhook%2Fwith+space'
    )
  })

  it('removes the webhook id supplied by the delete mutation variables', () => {
    expect(removeDeletedWebhookFromCache([webhook('keep'), webhook('delete')], 'delete'))
      .toEqual([webhook('keep')])
  })

  it('handles an empty cache', () => {
    expect(removeDeletedWebhookFromCache(undefined, 'delete')).toEqual([])
  })
})
