import { describe, expect, it, vi } from 'vitest'
import { compilePermissionPolicy } from '../../src/permissions/policy.js'
import { createPermissionGate } from '../../src/permissions/gate.js'
import { fixture, policyFixture } from './fixture.js'

describe('permission review regressions', () => {
  it('allows accepted capabilities even when other capabilities are explicitly blocked', async () => {
    const policy = policyFixture()
    expect(policy.status).toBe('complete')
    const gate = createPermissionGate({ policy, sourcePin: { sourceRevision: policy.sourceRevision, sdkSourceRevision: policy.sdkSourceRevision }, request: vi.fn(), permissionCodes: async () => new Set(['page', 'action']) } as Parameters<typeof createPermissionGate>[0])
    await expect(gate.assert('hr-post-type-create')).resolves.toBeUndefined()
    await expect(gate.assert('hr-post-type-list')).rejects.toThrow()
  })
  it.each(['status', 'evidence', 'endpoint', 'dynamic', 'context'])('rejects malformed %s before publishing', kind => {
    const input = fixture()
    const review = input.reviews.find(row => row.status === 'accepted')!
    if (kind === 'status') (review as unknown as { status: string }).status = 'surprise'
    if (kind === 'evidence') review.evidence[0]!.file = 'missing.vue'
    if (kind === 'endpoint') input.candidates.find(c => c.candidateId === review.candidateId)!.endpointRefs = []
    if (kind === 'dynamic') input.candidates.find(c => c.candidateId === review.candidateId)!.unresolved.push({ expression: 'dynamicPermission' } as never)
    if (kind === 'context') review.contextRules = [{ evaluator: 'shop' }]
    expect(() => compilePermissionPolicy({ ...input, sourceRoot: input.root, sourceRevision: input.sourceRevision } as Parameters<typeof compilePermissionPolicy>[0])).toThrow()
  })
  it.each(['revision', 'sdkRevision', 'registry', 'hash', 'prototype', 'context'])('fails closed for %s without permission or target requests', async kind => {
    const policy = policyFixture()
    const sourcePin = { sourceRevision: policy.sourceRevision, sdkSourceRevision: policy.sdkSourceRevision }
    if (kind === 'revision') policy.sourceRevision = 'old'
    if (kind === 'sdkRevision') policy.sdkSourceRevision = 'old'
    if (kind === 'registry') policy.registryHash = 'old'
    if (kind === 'hash') policy.contentHash = 'wrong'
    if (kind === 'prototype') policy.entries[0]!.contextRules = [{ evaluator: 'toString' }]
    if (kind === 'context') policy.entries[0]!.contextRules = [{ evaluator: 'shop' }]
    const request = vi.fn()
    await expect(createPermissionGate({ policy, sourcePin, request } as Parameters<typeof createPermissionGate>[0]).assert('hr-post-type-create')).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
