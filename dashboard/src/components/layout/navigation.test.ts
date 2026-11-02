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
  it('keeps detail routes in their section', () => {
    expect(getActiveNavigationPath(userNavigation, '/settings/api-keys')).toBe('/settings')
    expect(getActiveNavigationPath(adminNavigation, '/teams/team-1')).toBe('/teams')
  })
  it('does not select external or similarly prefixed routes', () => {
    expect(getActiveNavigationPath(userNavigation, '/game/')).toBeUndefined()
    expect(getActiveNavigationPath(userNavigation, '/webhooks-other')).toBeUndefined()
  })
  it('keeps the game page available without a Console navigation entry', () => {
    expect(userNavigation.some((item) => item.path === '/game/')).toBe(false)
  })
})
