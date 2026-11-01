import { describe, expect, it } from 'vitest'
import { isRootPublicDashboardRedirect } from '@/lib/dashboard-redirect'

import {
  buildAuthRedirectSearch,
  normalizeAuthRedirect,
} from './auth-redirect-search'

describe('auth redirect search', () => {
  it('keeps internal redirects for auth links', () => {
    const redirectTo = normalizeAuthRedirect('/settings')

    expect(redirectTo).toBe('/settings')
    expect(buildAuthRedirectSearch(redirectTo)).toEqual({
      redirect: '/settings',
    })
  })

  it('omits unsafe redirects from auth links', () => {
    const redirectTo = normalizeAuthRedirect('javascript:alert(1)')

    expect(redirectTo).toBeUndefined()
    expect(buildAuthRedirectSearch(redirectTo)).toEqual({})
  })

  describe.each(['console', 'dashboard'])('legacy %s auth returns', (prefix) => {
    it.each(['items', 'folders'])('preserves the independent %s target across auth links and repeated normalization', (kind) => {
      const redirectTo = normalizeAuthRedirect(`/${prefix}/drive/${kind}/doc?surface=console&versions=1#comment`)

      expect(redirectTo).toBe('/drive/items/doc?surface=standalone&versions=1#comment')
      expect(buildAuthRedirectSearch(redirectTo)).toEqual({ redirect: '/drive/items/doc?surface=standalone&versions=1#comment' })
      expect(normalizeAuthRedirect(redirectTo)).toBe(redirectTo)
      expect(isRootPublicDashboardRedirect(redirectTo)).toBe(true)
    })
  })
})
