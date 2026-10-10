import { describe, expect, it } from 'vitest'
import { compilePermissionPolicy, evaluatePermissionExpression } from '../../src/permissions/policy.js'
import { fixture } from './fixture.js'

describe('permission policy', () => {
  it('evaluates all/any/none with Web semantics', () => {
    expect(evaluatePermissionExpression({ kind: 'all', rules: [{ kind: 'code', code: 'a' }, { kind: 'code', code: 'b' }] }, new Set(['a', 'b']))).toBe(true)
    expect(evaluatePermissionExpression({ kind: 'any', rules: [{ kind: 'code', code: 'a' }, { kind: 'code', code: 'b' }] }, new Set(['b']))).toBe(true)
    expect(evaluatePermissionExpression({ kind: 'none', rules: [{ kind: 'code', code: 'a' }] }, new Set(['a']))).toBe(false)
  })
  it.each(['coverage', 'duplicate', 'conflict', 'source', 'sdk', 'unrestricted', 'pending'])('rejects %s at compile time', kind => {
    const input = fixture()
    const accepted = input.reviews.find(row => row.status === 'accepted')!
    if (kind === 'coverage') input.reviews.pop()
    if (kind === 'duplicate') input.reviews.push(accepted)
    if (kind === 'conflict') { const other = input.reviews.find(row => row.capabilityId === 'hr-post-type-list')!; other.status = 'accepted'; other.actionChain = { kind: 'code', code: 'other' } }
    if (kind === 'source') accepted.sourceRevision = 'old'
    if (kind === 'sdk') accepted.sdkPath = 'fake.method'
    if (kind === 'unrestricted') accepted.pageChain = { kind: 'all', rules: [] }
    if (kind === 'pending') accepted.status = 'needs-review'
    expect(() => compilePermissionPolicy({ ...input, sourceRoot: input.root })).toThrow()
  })
})
