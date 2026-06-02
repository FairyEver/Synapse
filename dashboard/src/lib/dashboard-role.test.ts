import { describe, expect, it } from 'vitest'

import {
  getDashboardHomePath,
  resolveDashboardRedirectForRole,
} from './dashboard-role'

describe('dashboard role routing', () => {
  it('sends administrators and normal users to their own dashboard home', () => {
    expect(getDashboardHomePath('admin')).toBe('/system')
    expect(getDashboardHomePath('user')).toBe('/settings')
  })

  it('keeps normal users away from administrator redirects', () => {
    expect(resolveDashboardRedirectForRole('user', '/system')).toBe('/settings')
    expect(resolveDashboardRedirectForRole('user', '/users?page=2')).toBe(
      '/settings'
    )
    expect(resolveDashboardRedirectForRole('user', '/settings')).toBe(
      '/settings'
    )
  })
})
