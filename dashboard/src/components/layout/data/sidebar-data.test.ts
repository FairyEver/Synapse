import { describe, expect, it } from 'vitest'

import { Logo } from '@/assets/logo'
import { getSidebarData } from './sidebar-data'

function collectUrls(data: ReturnType<typeof getSidebarData>) {
  return data.navGroups.flatMap((group) =>
    group.items.flatMap((item) =>
      item.url ? [item.url] : item.items.map((subItem) => subItem.url)
    )
  )
}

function collectTitles(data: ReturnType<typeof getSidebarData>) {
  return data.navGroups.flatMap((group) =>
    group.items.flatMap((item) =>
      item.url ? [item.title] : item.items.map((subItem) => subItem.title)
    )
  )
}

describe('getSidebarData', () => {
  it('keeps settings available for normal users', () => {
    const data = getSidebarData({
      email: 'user@example.com',
      handle: 'ada',
      sessionId: 'session-1',
    })

    expect(data.user.profileUrl).toBeUndefined()
    expect(data.user.name).toBe('ada')
    expect(data.appTitle.name).toBe('Synapse')
    expect(data.appTitle.logo).toBe(Logo)
    expect(collectUrls(data)).toContain('/skill-repositories')
    expect(collectUrls(data)).toContain('/skill-repositories/explore')
    expect(collectUrls(data)).toContain('/drive')
    expect(collectUrls(data)).toContain('/webhooks')
    expect(collectUrls(data)).toContain('/webhook-deliveries')
    expect(collectUrls(data)).toContain('/my-devices')
    expect(collectUrls(data)).toContain('/settings')
    expect(collectUrls(data)).not.toContain('/devices')
    expect(collectUrls(data)).not.toContain('/admin-drive')
    expect(collectTitles(data)).toContain('网盘')
    expect(collectTitles(data)).toContain('我的 Skills')
    expect(collectTitles(data)).toContain('探索 Skills')
    expect(collectUrls(data)).not.toContain('/me')
  })

  it('does not expose system administration in the ordinary-user sidebar', () => {
    const urls = collectUrls(getSidebarData(null))

    expect(urls).not.toContain('/users')
    expect(urls).not.toContain('/devices')
    expect(urls).not.toContain('/admin-drive')
    expect(urls).not.toContain('/system')
    expect(urls).not.toContain('/audit-logs')
  })
})
