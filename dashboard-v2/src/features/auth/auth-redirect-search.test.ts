import { describe, expect, it } from 'vitest'

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
})
