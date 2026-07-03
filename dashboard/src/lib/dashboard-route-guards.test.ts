import { beforeEach, describe, expect, it } from 'vitest'

import { requireDashboardAdmin, requireDashboardUser } from './dashboard-route-guards'
import { useAuthStore } from '@/stores/auth-store'

function signInAs(role: 'admin' | 'user') {
  useAuthStore.getState().auth.setUser({
    email: `${role}@example.com`,
    handle: role,
    role,
    sessionId: `${role}-session`,
  })
}

function captureRedirect(action: () => void) {
  try {
    action()
    return null
  } catch (error) {
    return error as { readonly options?: { readonly to?: string } }
  }
}

describe('dashboard route guards', () => {
  beforeEach(() => {
    useAuthStore.getState().auth.reset()
  })

  it('allows admins through admin routes and redirects normal users', () => {
    signInAs('admin')
    expect(() => requireDashboardAdmin()).not.toThrow()

    signInAs('user')
    expect(captureRedirect(requireDashboardAdmin)).toMatchObject({
      options: { to: '/settings' },
    })
  })

  it('allows normal users through user routes and redirects admins', () => {
    signInAs('user')
    expect(() => requireDashboardUser()).not.toThrow()

    signInAs('admin')
    expect(captureRedirect(requireDashboardUser)).toMatchObject({
      options: { to: '/system' },
    })
  })
})
