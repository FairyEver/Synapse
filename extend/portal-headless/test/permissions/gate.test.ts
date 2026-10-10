import { describe, expect, it } from 'vitest'
import { createPermissionGate, PermissionDeniedError } from '../../src/permissions/gate.js'
import type { PermissionPolicy } from '../../src/permissions/policy.js'

const base: PermissionPolicy = { schema: 'ph-permission-policy/v1', status: 'complete', sourceRevision: 'r', revision: 'r:1', contentHash: '1', counts: { accepted: 1, blocked: 0, needsReview: 0 }, entries: [{ candidateId: 'c', capabilityId: 'cap', sdkPath: 'x', pageChain: { kind: 'code', code: 'page' }, actionChain: { kind: 'all', rules: [{ kind: 'code', code: 'action' }] }, contextRules: [{ evaluator: 'shop', args: { id: 7 } }], evidence: [{ file: 'x', line: 1, snippet: 'x' }], sourceRevision: 'r' }] }

describe('permission gate', () => {
  it('rejects before target request when page/action/context is not satisfied', async () => {
    let targetRequests = 0
    const gate = createPermissionGate({ policy: base, request: async <T>() => { targetRequests++; return [] as unknown as T }, permissionCodes: async () => new Set(['page']), evaluators: { shop: () => true } })
    await expect(gate.assert('cap')).rejects.toBeInstanceOf(PermissionDeniedError)
    expect(targetRequests).toBe(0)
  })
  it('accepts only a complete reviewed policy', async () => {
    let permissionRequests = 0
    const gate = createPermissionGate({ policy: base, request: async <T>() => { permissionRequests++; return { data: ['page', 'action'] } as unknown as T }, evaluators: { shop: () => true } })
    await gate.assert('cap')
    expect(permissionRequests).toBe(1)
    await expect(createPermissionGate({ policy: { ...base, status: 'incomplete' }, request: async <T>() => [] as unknown as T }).assert('cap')).rejects.toThrow(/incomplete/)
  })
})
