import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { permissionCapabilityRegistry } from '../../src/permissions/registry.js'
import { permissionSourceRevision } from '../../src/permissions/source.js'
import { sdkPathOf } from '../../src/capabilities/invoke.js'
import { compilePermissionPolicy, type PermissionReview } from '../../src/permissions/policy.js'

export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ph-policy-'))
  mkdirSync(join(root, 'app'), { recursive: true })
  writeFileSync(join(root, 'app/page.vue'), "permissionCheck('page')\nhttp.post('/org/hrposttype/save', body)\n")
  const candidates = permissionCapabilityRegistry().map(cap => ({
    candidateId: `c:${cap.id}`, pagePath: cap.pagePath, capabilityIds: [cap.id], routeFile: 'app/page.vue', actionFiles: ['app/page.vue'],
    endpointRefs: [{ method: 'post', path: '/org/hrposttype/save', sourceFile: 'app/page.vue', line: 2 }],
    keywordHits: [], importTrail: [], sourceRevision: 'r', unresolved: [],
  }))
  const reviews = candidates.map(candidate => ({
    candidateId: candidate.candidateId, capabilityId: candidate.capabilityIds[0]!, sdkPath: sdkPathOf(candidate.capabilityIds[0]!)!,
    pageChain: { kind: 'code', code: 'page' }, actionChain: { kind: 'code', code: 'action' }, contextRules: [],
    endpointRefs: candidate.endpointRefs, evidence: [{ file: 'app/page.vue', line: 1, snippet: "permissionCheck('page')" }, { file: 'app/page.vue', line: 2, snippet: "http.post('/org/hrposttype/save', body)" }],
    sdkEvidence: [{ file: 'src/capabilities/hr-post-type.ts', line: 47, snippet: "await request({ url: `${ROOT}/save`, method: 'post', data: draft(input) })" }],
    status: candidate.capabilityIds[0] === 'hr-post-type-create' ? 'accepted' : 'blocked', reason: 'Synthetic test evidence', sourceRevision: 'r',
  })) as PermissionReview[]
  const sourceRevision = permissionSourceRevision(root)
  for (const row of [...candidates, ...reviews]) row.sourceRevision = sourceRevision
  return { root, candidates, reviews, sourceRevision }
}
export function policyFixture() {
  const input = fixture()
  return compilePermissionPolicy({ candidates: input.candidates, reviews: input.reviews, sourceRevision: input.sourceRevision, sourceRoot: input.root } as Parameters<typeof compilePermissionPolicy>[0])
}
