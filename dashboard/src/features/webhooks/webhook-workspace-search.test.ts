import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { Route as legacyHistoryRoute } from '@/routes/_authenticated/webhook-deliveries'
import { webhookWorkspaceSearchSchema } from './webhook-workspace-search'

describe('unified Webhook navigation', () => {
  it('redirects bookmarked history URLs without losing filters or pagination', () => {
    const search = { webhookId: 'deleted-hook', status: 'sent', page: 3, pageSize: 20, from: '2026-11-01', to: '2026-11-02', sortBy: 'method', sortOrder: 'asc' as const }
    try {
      legacyHistoryRoute.options.beforeLoad?.({ search } as never)
      expect.unreachable('legacy history must redirect')
    } catch (result) {
      expect(isRedirect(result)).toBe(true)
      expect(result).toMatchObject({ options: { to: '/webhooks/', replace: true, search: { ...search, tab: 'deliveries' } } })
    }
  })

  it('preserves creation links and tab-specific history state', () => {
    expect(webhookWorkspaceSearchSchema.parse({ action: 'create' })).toEqual({ action: 'create' })
    expect(webhookWorkspaceSearchSchema.parse({ tab: 'deliveries', status: 'delivered', page: '2', webhookId: 'hook-1' })).toEqual({ tab: 'deliveries', status: 'delivered', page: 2, webhookId: 'hook-1' })
    expect(webhookWorkspaceSearchSchema.parse({ tab: 'unknown', page: -1, pageSize: 500 })).toEqual({ tab: undefined, page: undefined, pageSize: undefined })
  })
})
