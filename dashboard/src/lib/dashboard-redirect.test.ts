import { describe, expect, it } from 'vitest'

import { normalizeDashboardRedirect } from './dashboard-redirect'

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
