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
  it('keeps personal center available for normal users', () => {
    const data = getSidebarData({
      email: 'user@example.com',
      modulePermissions: [],
      role: 'user',
      sessionId: 'session-1',
    })

    expect(data.user.profileUrl).toBe('/me')
    expect(collectUrls(data)).toContain('/me')
  })

  it('does not expose normal-user profile entry to admins', () => {
    const data = getSidebarData({
      email: 'admin@example.com',
      modulePermissions: [],
      role: 'admin',
      sessionId: 'session-1',
    })

    expect(data.user.profileUrl).toBeUndefined()
    expect(collectUrls(data)).not.toContain('/me')
  })
})
