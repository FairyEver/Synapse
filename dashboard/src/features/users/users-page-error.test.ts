import { describe, expect, it } from 'vitest'

import { getUsersTableError, getUsersTableLoading } from './users-page-error'

describe('getUsersTableError', () => {
  it('uses users query errors first and surfaces module permission definition failures', () => {
    const usersError = new Error('用户列表失败')
    const modulePermissionsError = new Error('模块权限失败')

    expect(
      getUsersTableError(true, usersError, true, modulePermissionsError)
    ).toBe(usersError)
    expect(
      getUsersTableError(false, null, true, modulePermissionsError)
    ).toBe(modulePermissionsError)
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
