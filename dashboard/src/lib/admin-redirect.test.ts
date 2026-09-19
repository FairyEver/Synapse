import { describe, expect, it } from 'vitest'
import { normalizeAdminRedirect } from './admin-redirect'

describe('normalizeAdminRedirect', () => {
  it('keeps only allowlisted administrator paths', () => {
    expect(normalizeAdminRedirect('/users?page=2#active')).toBe('/users?page=2#active')
    expect(normalizeAdminRedirect('/admin/users?page=2#active')).toBe('/users?page=2#active')
    expect(normalizeAdminRedirect('/drive/')).toBe('/drive/')
    expect(normalizeAdminRedirect('/telemetry?identity=anonymous')).toBe('/telemetry?identity=anonymous')
    expect(normalizeAdminRedirect('/teams')).toBe('/teams')
    expect(normalizeAdminRedirect('/teams/team-1')).toBe('/teams/team-1')
    expect(normalizeAdminRedirect('/admin/teams/team-1')).toBe('/teams/team-1')
    expect(normalizeAdminRedirect('/invitations')).toBeUndefined()
    expect(normalizeAdminRedirect('/teams/team-1/members')).toBeUndefined()
    expect(normalizeAdminRedirect('/unknown')).toBeUndefined()
    expect(normalizeAdminRedirect('/users/child')).toBeUndefined()
  })

  it('rejects external and scheme-relative redirects', () => {
    expect(normalizeAdminRedirect('https://example.com/users')).toBeUndefined()
    expect(normalizeAdminRedirect('//example.com/users')).toBeUndefined()
    expect(normalizeAdminRedirect(undefined)).toBeUndefined()
  })
})
