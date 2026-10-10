import { describe, expect, it, vi } from 'vitest'
import { loadPermissionContext } from '../../src/permissions/context.js'
import { SessionStore } from '../../src/session/store.js'
import { createPortalBaseDataRegistry } from '../../src/session/base-data.js'
import type { PortalRequest } from '../../src/session/types.js'

describe('permission context', () => {
  it('reuses tenant systems until the session data is explicitly invalidated', async () => {
    let useSystem = '11, 12'
    const request = vi.fn(async ({ url }: { url: string }) => url.endsWith('getUserTenantsByPage') ? { list: [{ id: 'tenant' }], total: 1 } : { useSystem })
    const store = new SessionStore({ registry: createPortalBaseDataRegistry(), createRequest: () => request as PortalRequest })
    const session = await store.acquire({ userId: 'user', tenantId: 'tenant', credential: { tenantId: 'tenant', token: 'synthetic' } })
    const rules = [{ evaluator: 'system', args: { id: 11 } }]
    expect(await loadPermissionContext(session, rules)).toEqual({ tenantId: 'tenant', systemIds: [11, 12] })
    useSystem = '12'
    expect(await loadPermissionContext(session, rules)).toEqual({ tenantId: 'tenant', systemIds: [11, 12] })
    expect(request.mock.calls.filter(([input]) => input.url.endsWith('/tenant/get'))).toHaveLength(1)
    session.invalidate('tenant-system')
    expect(await loadPermissionContext(session, rules)).toEqual({ tenantId: 'tenant', systemIds: [12] })
    expect(request.mock.calls.filter(([input]) => input.url.endsWith('/tenant/get'))).toHaveLength(2)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: '/admin-api/system/tenant/get', method: 'get', params: { id: 'tenant' } }))
  })
})
