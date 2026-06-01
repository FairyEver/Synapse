import { describe, expect, it, vi } from 'vitest'

import { performDashboardSignOut } from './dashboard-sign-out'

describe('performDashboardSignOut', () => {
  it('calls server logout before clearing local auth and navigating to sign in', async () => {
    const logout = vi.fn().mockResolvedValue({ ok: true })
    const reset = vi.fn()
    const navigate = vi.fn()

    await performDashboardSignOut({
      currentPath: '/dashboard/users?page=2',
      logout,
      reset,
      navigate,
    })

    expect(logout).toHaveBeenCalledOnce()
    expect(reset).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith({
      to: '/sign-in',
      search: { redirect: '/users?page=2' },
      replace: true,
    })
    expect(logout.mock.invocationCallOrder[0]).toBeLessThan(
      reset.mock.invocationCallOrder[0] ?? 0
    )
  })

  it('still clears local auth and navigates when server logout fails', async () => {
    const logout = vi.fn().mockRejectedValue(new Error('offline'))
    const reset = vi.fn()
    const navigate = vi.fn()

    await performDashboardSignOut({
      currentPath: '/dashboard/settings',
      logout,
      reset,
      navigate,
    })

    expect(reset).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith({
      to: '/sign-in',
      search: { redirect: '/settings' },
      replace: true,
    })
  })
})
