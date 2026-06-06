import { describe, expect, it } from 'vitest'

import { getSidebarData } from './sidebar-data'

function collectUrls(data: ReturnType<typeof getSidebarData>) {
  return data.navGroups.flatMap((group) =>
    group.items.flatMap((item) =>
      item.url ? [item.url] : item.items.map((subItem) => subItem.url)
    )
  )
}

describe('getSidebarData', () => {
  it('keeps settings available for normal users', () => {
    const data = getSidebarData({
      email: 'user@example.com',
      displayName: 'Ada Lovelace',
      modulePermissions: [],
      role: 'user',
      sessionId: 'session-1',
    })

    expect(data.user.profileUrl).toBeUndefined()
    expect(data.user.name).toBe('Ada Lovelace')
    expect(collectUrls(data)).toContain('/webhooks')
    expect(collectUrls(data)).toContain('/settings')
    expect(collectUrls(data)).not.toContain('/me')
  })

  it('does not expose normal-user profile entry to admins', () => {
    const data = getSidebarData({
      email: 'admin@example.com',
      displayName: null,
      modulePermissions: [],
      role: 'admin',
      sessionId: 'session-1',
    })

    expect(data.user.profileUrl).toBeUndefined()
    expect(data.user.name).toBe('admin@example.com')
    expect(collectUrls(data)).not.toContain('/webhooks')
    expect(collectUrls(data)).not.toContain('/me')
  })
})
