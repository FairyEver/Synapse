import { describe, expect, it } from 'vitest'
import { compilePermissionPolicy, evaluatePermissionExpression, type PermissionReview, type PermissionPolicy } from '../../src/permissions/policy.js'

const evidence = [{ file: 'app/page.vue', line: 10, snippet: 'permissionCheck(\'menu:create\')' }]
const accepted: PermissionReview = {
  candidateId: 'c-1', capabilityId: 'menu-create', sdkPath: 'settingMenu.create',
  pageChain: { kind: 'code', code: 'menu:create' },
  actionChain: { kind: 'all', rules: [{ kind: 'code', code: 'menu:create' }] },
  contextRules: [], evidence, status: 'accepted', reason: '源码证据完整', sourceRevision: 'rev-1',
}
const candidate = { candidateId: 'c-1', pagePath: '/setting/menu', routeFile: 'route.ts', actionFiles: ['page.vue'], endpointRefs: [{ method: 'post', path: '/admin-api/sys/menu/create', sourceFile: 'page.vue', line: 20 }], keywordHits: [], importTrail: [], sourceRevision: 'rev-1' }

describe('permission policy', () => {
  it('evaluates all/any/none without executing arbitrary code', () => {
    expect(evaluatePermissionExpression({ kind: 'all', rules: [{ kind: 'code', code: 'a' }, { kind: 'code', code: 'b' }] }, new Set(['a', 'b']))).toBe(true)
    expect(evaluatePermissionExpression({ kind: 'any', rules: [{ kind: 'code', code: 'a' }, { kind: 'code', code: 'b' }] }, new Set(['b']))).toBe(true)
    expect(evaluatePermissionExpression({ kind: 'none', rules: [{ kind: 'code', code: 'a' }] }, new Set(['a']))).toBe(false)
  })

  it('compiles only accepted reviews and rejects missing or conflicting evidence', () => {
    const policy = compilePermissionPolicy({ candidates: [candidate], reviews: [accepted], capabilities: [{ id: 'menu-create', sdkPath: 'settingMenu.create' }], sourceRevision: 'rev-1' })
    expect(policy.status).toBe('complete')
    expect(policy.entries[0]?.capabilityId).toBe('menu-create')
    expect(() => compilePermissionPolicy({ candidates: [candidate], reviews: [{ ...accepted, status: 'needs-review' }], capabilities: [{ id: 'menu-create', sdkPath: 'settingMenu.create' }], sourceRevision: 'rev-1' })).toThrow(/needs-review/)
    expect(() => compilePermissionPolicy({ candidates: [candidate], reviews: [accepted], capabilities: [{ id: 'other', sdkPath: 'x' }], sourceRevision: 'rev-1' })).toThrow(/candidateId|capability/)
  })
})
