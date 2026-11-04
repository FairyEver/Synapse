import { describe, expect, it } from 'vitest'
import { adminNavigation, getActiveNavigationPath, userNavigation } from './navigation'

describe('navigation selection', () => {
  it('uses one Webhook entry for configuration, records and detail', () => {
    expect(userNavigation.filter((item) => item.path.startsWith('/webhook'))).toMatchObject([
      { title: 'Webhook', path: '/webhooks' },
    ])
    expect(getActiveNavigationPath(userNavigation, '/webhooks/hook-1')).toBe('/webhooks')
    expect(adminNavigation.some((item) => item.path === '/webhook-deliveries')).toBe(true)
  })
  it('adds one ordinary Skill Hub entry and keeps detail under it', () => {
    expect(userNavigation.filter((item) => item.path.startsWith('/skill-hub'))).toMatchObject([{ title: 'Skill Hub', path: '/skill-hub' }])
    expect(getActiveNavigationPath(userNavigation, '/skill-hub/skill_1')).toBe('/skill-hub')
    expect(adminNavigation.some((item) => item.path.includes('skill-hub'))).toBe(false)
  })
  it('keeps detail routes in their section', () => {
    expect(getActiveNavigationPath(userNavigation, '/settings/api-keys')).toBe('/settings')
    expect(getActiveNavigationPath(adminNavigation, '/teams/team-1')).toBe('/teams')
  })
  it('does not select external or similarly prefixed routes', () => {
    expect(getActiveNavigationPath(userNavigation, '/unrecognized/')).toBeUndefined()
    expect(getActiveNavigationPath(userNavigation, '/webhooks-other')).toBeUndefined()
  })
})
