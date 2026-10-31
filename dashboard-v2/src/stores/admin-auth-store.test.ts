import { beforeEach, describe, expect, it } from 'vitest'
import { useAdminAuthStore } from './admin-auth-store'

const session = {
  id: 'admin-session-1',
  expiresAt: '2026-08-01T00:00:00.000Z',
}

describe('useAdminAuthStore', () => {
  beforeEach(() => {
    useAdminAuthStore.getState().auth.reset()
  })

  it('tracks only the administrator session', () => {
    useAdminAuthStore.getState().auth.setSession(session)

    expect(useAdminAuthStore.getState().auth.session).toEqual(session)
    expect(useAdminAuthStore.getState().auth.isAuthenticated).toBe(true)
  })

  it('clears the administrator session independently', () => {
    useAdminAuthStore.getState().auth.setSession(session)
    useAdminAuthStore.getState().auth.reset()

    expect(useAdminAuthStore.getState().auth.session).toBeNull()
    expect(useAdminAuthStore.getState().auth.isAuthenticated).toBe(false)
  })
})
