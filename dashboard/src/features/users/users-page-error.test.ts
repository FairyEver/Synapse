import { describe, expect, it } from 'vitest'

import { getUsersTableError, getUsersTableLoading } from './users-page-error'

describe('getUsersTableError', () => {
  it('uses only the users query error for the table error state', () => {
    const usersError = new Error('用户列表失败')
    const modulePermissionsError = new Error('模块权限失败')

    expect(getUsersTableError(true, usersError)).toBe(usersError)
    expect(getUsersTableError(false, modulePermissionsError)).toBeNull()
  })
})

describe('getUsersTableLoading', () => {
  it('does not mask user query errors with module permission loading', () => {
    expect(
      getUsersTableLoading({
        isUsersError: true,
        isUsersLoading: false,
        isModulePermissionDefinitionsLoading: true,
      })
    ).toBe(false)
  })

  it('keeps the table loading while required data is still loading', () => {
    expect(
      getUsersTableLoading({
        isUsersError: false,
        isUsersLoading: false,
        isModulePermissionDefinitionsLoading: true,
      })
    ).toBe(true)
  })
})
