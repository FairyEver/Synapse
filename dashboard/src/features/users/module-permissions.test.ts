import { describe, expect, it } from 'vitest'

import {
  formatModulePermissionSummary,
  togglePermissionKey,
} from './module-permissions'

describe('module permission helpers', () => {
  it('toggles permission keys without mutating the current set', () => {
    const current = new Set(['module.workflow'])

    const next = togglePermissionKey(current, 'module.database', true)
    const removed = togglePermissionKey(next, 'module.workflow', false)

    expect([...current]).toEqual(['module.workflow'])
    expect([...next]).toEqual(['module.workflow', 'module.database'])
    expect([...removed]).toEqual(['module.database'])
  })

  it('summarizes permission keys with known labels', () => {
    expect(
      formatModulePermissionSummary(
        ['module.workflow', 'module.database'],
        [
          { key: 'module.database', label: '数据库', group: '基础', sortOrder: 2, status: 'active' },
          { key: 'module.workflow', label: '工作流', group: '基础', sortOrder: 1, status: 'active' },
        ]
      )
    ).toBe('工作流、数据库')
  })
})
