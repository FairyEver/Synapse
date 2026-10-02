// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAdminAuthStore } from '@/stores/admin-auth-store'
import { adminRouteTree } from './admin-routes'

const imports = vi.hoisted(() => ({ system: 0, telemetry: 0 }))

vi.mock('@/features/system', () => {
  imports.system += 1
  return { default: () => null }
})
vi.mock('@/features/telemetry', () => {
  imports.telemetry += 1
  return { default: () => null }
})

describe('admin route page loading', () => {
  afterEach(() => useAdminAuthStore.getState().auth.reset())

  it('retains the auth guard and loads only the requested admin page', async () => {
    useAdminAuthStore.getState().auth.reset()
    const router = createRouter({
      routeTree: adminRouteTree,
      history: createMemoryHistory({ initialEntries: ['/system'] }),
      context: { queryClient: new QueryClient() },
      defaultPendingMinMs: 0,
    })

    expect(imports).toEqual({ system: 0, telemetry: 0 })
    await router.load()
    expect(router.state.location.pathname).toBe('/access')
    expect(imports).toEqual({ system: 0, telemetry: 0 })

    useAdminAuthStore.getState().auth.setSession({
      sessionId: 'admin-session',
      actorLabel: '平台管理员',
      expiresAt: '2026-10-02T20:00:00.000Z',
    })
    await router.navigate({ to: '/system' })
    expect(router.state.location.pathname).toBe('/system')
    expect(imports).toEqual({ system: 1, telemetry: 0 })

    await router.navigate({ to: '/telemetry' })
    expect(router.state.location.pathname).toBe('/telemetry')
    expect(imports).toEqual({ system: 1, telemetry: 1 })

    useAdminAuthStore.getState().auth.reset()
    await router.navigate({ to: '/system' })
    expect(router.state.location.pathname).toBe('/access')
  })
})
