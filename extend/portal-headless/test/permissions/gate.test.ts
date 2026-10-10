import { describe, expect, it, vi } from 'vitest'
import { createPermissionGate, PermissionDeniedError } from '../../src/permissions/gate.js'
import { compilePermissionPolicy } from '../../src/permissions/policy.js'
import { fixture, policyFixture } from './fixture.js'
import type { PortalRequest } from '../../src/session/types.js'

function reviewed(contextRules: Parameters<typeof compilePermissionPolicy>[0]['reviews'][number]['contextRules']) {
  const input = fixture()
  input.reviews.find(row => row.status === 'accepted')!.contextRules = contextRules
  return compilePermissionPolicy({ ...input, sourceRoot: input.root, availableContextEvaluators: ['tenant', 'system', 'shop', 'state', 'config'] })
}
const pin = (policy: ReturnType<typeof policyFixture>) => ({ sourceRevision: policy.sourceRevision, sdkSourceRevision: policy.sdkSourceRevision })
describe('permission gate', () => {
  it('checks live permissions on each call and denies before target request', async () => {
    const policy = policyFixture(); let codes = ['page', 'action']
    const request = vi.fn(async <T>() => codes as T)
    const audit = vi.fn()
    const gate = createPermissionGate({ policy, sourcePin: pin(policy), request: request as PortalRequest, onDenied: audit })
    await gate.assert('hr-post-type-create')
    codes = ['page']
    await expect(gate.assert('hr-post-type-create')).rejects.toBeInstanceOf(PermissionDeniedError)
    codes = []
    await expect(gate.assert('hr-post-type-create')).rejects.toThrow('page permission')
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls.every(call => (call as unknown as [{ url: string }])[0].url.endsWith('permissionsNotBySystem'))).toBe(true)
    expect(audit).toHaveBeenCalledWith({ capabilityId: 'hr-post-type-create', policyRevision: policy.revision, failedRule: 'action permission chain' })
  })
  it.each([
    { evaluator: 'tenant', args: { id: 'tenant' } }, { evaluator: 'system', args: { id: 11 } },
    { evaluator: 'shop', args: { id: 7 } }, { evaluator: 'state', args: { value: 'ready' } },
    { evaluator: 'config', args: { key: 'enabled', value: true } },
  ])('rejects missing and mismatched trusted $evaluator context', async rule => {
    const policy = reviewed([rule]); const request = vi.fn()
    const options = { policy, sourcePin: pin(policy), request, permissionCodes: async () => new Set(['page', 'action']) }
    await expect(createPermissionGate(options).assert('hr-post-type-create')).rejects.toThrow('context rule')
    await expect(createPermissionGate({ ...options, context: async () => ({ tenantId: 'other', systemIds: [9], shopId: 8, state: 'other', config: { enabled: false } }) }).assert('hr-post-type-create')).rejects.toThrow('context rule')
    await createPermissionGate({ ...options, context: async () => ({ tenantId: 'tenant', systemIds: [11], shopId: 7, state: 'ready', config: { enabled: true } }) }).assert('hr-post-type-create')
    expect(request).not.toHaveBeenCalled()
  })
  it('denies null policies, invalid permission payloads and resolver errors', async () => {
    await expect(createPermissionGate({ policy: null, request: vi.fn() }).assert('hr-post-type-create')).rejects.toThrow('policy')
    const policy = policyFixture()
    await expect(createPermissionGate({ policy, sourcePin: pin(policy), request: async <T>() => ({ data: ['page', 'action'] }) as T }).assert('hr-post-type-create')).rejects.toThrow('current permissions unavailable')
    const contextual = reviewed([{ evaluator: 'shop', args: { id: 7 } }])
    await expect(createPermissionGate({ policy: contextual, sourcePin: pin(contextual), request: vi.fn(), permissionCodes: async () => new Set(['page', 'action']), context: async () => { throw new Error('secret') } }).assert('hr-post-type-create')).rejects.toThrow('trusted business context unavailable')
  })
})

describe('trusted context availability', () => {
  it('cannot publish a shop condition until a server resolver is registered', () => {
    const input = fixture()
    input.reviews.find(row => row.status === 'accepted')!.contextRules = [{ evaluator: 'shop', args: { id: 7 } }]
    expect(() => compilePermissionPolicy({ ...input, sourceRoot: input.root })).toThrow('no registered server resolver')
  })
})
