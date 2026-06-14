import { describe, expect, it } from 'vitest'

import { buildDashboardRedirectPath, normalizeDashboardRedirect } from './dashboard-redirect'

describe('buildDashboardRedirectPath', () => {
  it('keeps search and hash from the current location', () => {
    expect(buildDashboardRedirectPath({
      pathname: '/console/content-store/install',
      search: '?session=install_123',
      hash: '#retry',
    })).toBe('/console/content-store/install?session=install_123#retry')
  })
})

describe('normalizeDashboardRedirect', () => {
  it('strips the console basepath from redirects', () => {
    expect(normalizeDashboardRedirect('/console/users?page=2')).toBe(
      '/users?page=2'
    )
    expect(normalizeDashboardRedirect('/console')).toBe('/')
  })

  it('keeps legacy dashboard redirects normalized', () => {
    expect(normalizeDashboardRedirect('/dashboard/users?page=2')).toBe(
      '/users?page=2'
    )
    expect(normalizeDashboardRedirect('/dashboard')).toBe('/')
  })

  it('keeps router-relative redirects unchanged', () => {
    expect(normalizeDashboardRedirect('/settings')).toBe('/settings')
  })

  it('rejects external redirects', () => {
    expect(normalizeDashboardRedirect('https://example.com/dashboard/users')).toBeUndefined()
  })
})
