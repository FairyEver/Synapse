import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from './auth-store'

async function importAuthStore() {
  const { useAuthStore } = await import('./auth-store')
  return useAuthStore
}

const sampleUser: AuthUser = {
  email: 'user@example.com',
  handle: 'user',
  role: 'user',
  sessionId: 'session-1',
}

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('starts unauthenticated without a user', async () => {
    const useAuthStore = await importAuthStore()

    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.isAuthenticated).toBe(false)
  })

  it('updates the signed-in user via setUser', async () => {
    const useAuthStore = await importAuthStore()

    useAuthStore.getState().auth.setUser(sampleUser)

    expect(useAuthStore.getState().auth.user).toEqual(sampleUser)
    expect(useAuthStore.getState().auth.isAuthenticated).toBe(true)
  })

  it('setUser clears authentication when called with null', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore.getState().auth.setUser(sampleUser)

    useAuthStore.getState().auth.setUser(null)

    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.isAuthenticated).toBe(false)
  })

  it('reset clears the signed-in user', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore.getState().auth.setUser(sampleUser)

    useAuthStore.getState().auth.reset()

    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.isAuthenticated).toBe(false)
  })
})
