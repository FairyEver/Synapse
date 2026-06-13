import { describe, expect, it } from 'vitest'

import { getUsersTableError, getUsersTableLoading } from './users-page-error'

describe('getUsersTableError', () => {
  it('returns users query errors only', () => {
    const usersError = new Error('用户列表失败')

    expect(getUsersTableError(true, usersError)).toBe(usersError)
    expect(getUsersTableError(false, null)).toBeNull()
  })
})

describe('getUsersTableLoading', () => {
  it('does not mask user query errors', () => {
    expect(
      getUsersTableLoading({
        isUsersError: true,
        isUsersLoading: false,
      })
    ).toBe(false)
  })

  it('keeps the table loading while users are still loading', () => {
    expect(
      getUsersTableLoading({
        isUsersError: false,
        isUsersLoading: true,
      })
    ).toBe(true)
  })
})
