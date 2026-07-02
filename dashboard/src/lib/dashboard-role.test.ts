import { describe, expect, it } from 'vitest'

import {
  getDashboardHomePath,
  isDashboardAdminPath,
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
    expect(resolveDashboardRedirectForRole('user', '/admin-drive')).toBe(
      '/settings'
    )
    expect(resolveDashboardRedirectForRole('user', '/devices')).toBe(
      '/settings'
    )
    expect(resolveDashboardRedirectForRole('user', '/settings')).toBe(
      '/settings'
    )
  })

  it('recognizes current administrator route entries', () => {
    expect(isDashboardAdminPath('/admin-drive')).toBe(true)
    expect(isDashboardAdminPath('/devices')).toBe(true)
    expect(isDashboardAdminPath('/skill-repositories/admin')).toBe(true)
  })
})
