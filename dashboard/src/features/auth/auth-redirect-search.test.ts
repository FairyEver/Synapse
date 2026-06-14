import { describe, expect, it } from 'vitest'

import {
  appendAuthRedirectToUrl,
  buildAuthRedirectSearch,
  normalizeAuthRedirect,
} from './auth-redirect-search'

describe('auth redirect search', () => {
  it('keeps team invitation redirects for auth links', () => {
    const redirectTo = normalizeAuthRedirect('/team-invite?token=invite_123')

    expect(redirectTo).toBe('/team-invite?token=invite_123')
    expect(buildAuthRedirectSearch(redirectTo)).toEqual({
      redirect: '/team-invite?token=invite_123',
    })
  })

  it('omits unsafe redirects from auth links', () => {
    const redirectTo = normalizeAuthRedirect('https://example.com/team-invite?token=invite_123')

    expect(redirectTo).toBeUndefined()
    expect(buildAuthRedirectSearch(redirectTo)).toEqual({})
  })

  it('appends safe redirects to password reset links', () => {
    expect(
      appendAuthRedirectToUrl(
        'https://app.example.com/console/reset-password?token=reset_123',
        '/team-invite?token=invite_123'
      )
    ).toBe(
      'https://app.example.com/console/reset-password?token=reset_123&redirect=%2Fteam-invite%3Ftoken%3Dinvite_123'
    )
  })
})
