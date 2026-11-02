import { describe, expect, it } from 'vitest'
import { adminNavigation, getActiveNavigationPath, userNavigation } from './navigation'

describe('navigation selection', () => {
  it('selects exploration instead of both it and the repository list', () => {
    expect(getActiveNavigationPath(userNavigation, '/skill-repositories/explore')).toBe('/skill-repositories/explore')
  })
  it('keeps detail routes in their section', () => {
    expect(getActiveNavigationPath(userNavigation, '/skill-repositories/repo-1')).toBe('/skill-repositories')
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
