import { describe, expect, it } from 'vitest'

import { getUsersTableError } from './users-page-error'

describe('getUsersTableError', () => {
  it('uses only the users query error for the table error state', () => {
    const usersError = new Error('用户列表失败')
    const modulePermissionsError = new Error('模块权限失败')

    expect(getUsersTableError(true, usersError)).toBe(usersError)
    expect(getUsersTableError(false, modulePermissionsError)).toBeNull()
  })
})
