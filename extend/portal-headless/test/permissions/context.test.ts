import { describe, expect, it, vi } from 'vitest'
import { loadPermissionContext } from '../../src/permissions/context.js'
import type { PortalSession } from '../../src/session/session.js'

describe('permission context', () => {
  it('loads systems on every decision rather than using cached tenant-system data', async () => {
    let useSystem = '11, 12'
    const request = vi.fn(async () => ({ useSystem }))
    const session = { key: { tenantId: 'tenant' }, credential: { tenantId: 'tenant', token: 'synthetic' }, request, get: () => [99], has: () => true } as unknown as PortalSession
    const rules = [{ evaluator: 'system', args: { id: 11 } }]
    expect(await loadPermissionContext(session, rules)).toEqual({ tenantId: 'tenant', systemIds: [11, 12] })
    useSystem = '12'
    expect(await loadPermissionContext(session, rules)).toEqual({ tenantId: 'tenant', systemIds: [12] })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledWith({ url: '/admin-api/system/tenant/get', method: 'get', params: { id: 'tenant' } })
  })
})
