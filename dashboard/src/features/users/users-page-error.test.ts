import { describe, expect, it } from 'vitest'

import {
  getUsersLiveClientStatusError,
  getUsersTableError,
  getUsersTableLoading,
} from './users-page-error'

describe('getUsersTableError', () => {
  it('returns users query errors only', () => {
    const usersError = new Error('用户列表失败')

    expect(getUsersTableError(true, usersError)).toBe(usersError)
    expect(getUsersTableError(false, null)).toBeNull()
  })
})

describe('getUsersLiveClientStatusError', () => {
  it('returns live client snapshot errors separately from the users table error', () => {
    const liveClientsError = new Error('客户端快照失败')

    expect(getUsersLiveClientStatusError(true, liveClientsError)).toBe(
      liveClientsError
    )
    expect(getUsersLiveClientStatusError(false, null)).toBeNull()
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
