import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type PermissionExpression =
  | { kind: 'code'; code: string }
  | { kind: 'all'; rules: PermissionExpression[] }
  | { kind: 'any'; rules: PermissionExpression[] }
  | { kind: 'none'; rules: PermissionExpression[] }

export type ContextRule = { evaluator: string; args?: Record<string, unknown> }
export type EvidenceRef = { file: string; line: number; snippet: string }
export type PermissionCandidate = {
  candidateId: string; pagePath: string; routeFile: string | null; actionFiles: string[]
  endpointRefs: Array<{ method: string; path: string; sourceFile: string; line: number }>
  keywordHits: Array<{ file: string; line: number; keyword: string; snippet: string }>
  importTrail: string[]; sourceRevision: string
}
export type PermissionReview = {
  candidateId: string; capabilityId: string; sdkPath: string
  pageChain: PermissionExpression; actionChain: PermissionExpression
  contextRules: ContextRule[]; evidence: EvidenceRef[]
  status: 'accepted' | 'blocked' | 'needs-review'; reason: string; sourceRevision: string
}
export type PermissionPolicyEntry = Omit<PermissionReview, 'status' | 'reason' | 'candidateId'> & { candidateId: string }
export type PermissionPolicy = {
  schema: 'ph-permission-policy/v1'; status: 'complete' | 'incomplete'; sourceRevision: string
  revision: string; contentHash: string; counts: { accepted: number; blocked: number; needsReview: number }
  entries: PermissionPolicyEntry[]
}

export function evaluatePermissionExpression (expression: PermissionExpression, permissions: ReadonlySet<string>): boolean {
  if (expression.kind === 'code') return permissions.has(expression.code)
  if (expression.kind === 'all') return expression.rules.every(rule => evaluatePermissionExpression(rule, permissions))
  if (expression.kind === 'any') return expression.rules.some(rule => evaluatePermissionExpression(rule, permissions))
  return expression.rules.every(rule => !evaluatePermissionExpression(rule, permissions))
}

export function compilePermissionPolicy (input: {
  candidates: PermissionCandidate[]; reviews: PermissionReview[]; capabilities: Array<{ id: string; sdkPath: string }>; sourceRevision: string
}): PermissionPolicy {
  const candidateById = new Map(input.candidates.map(candidate => [candidate.candidateId, candidate]))
  const capabilityById = new Map(input.capabilities.map(capability => [capability.id, capability]))
  const seen = new Set<string>()
  const reviewedCandidates = new Set<string>()
  let blocked = 0; let needsReview = 0
  const entries: PermissionPolicyEntry[] = []
  for (const review of input.reviews) {
    if (seen.has(review.capabilityId)) throw new Error(`duplicate policy for capability ${review.capabilityId}`)
    seen.add(review.capabilityId)
    reviewedCandidates.add(review.candidateId)
    const candidate = candidateById.get(review.candidateId)
    if (candidate === undefined) throw new Error(`review references unknown candidate ${review.candidateId}`)
    if (candidate.sourceRevision !== input.sourceRevision || review.sourceRevision !== input.sourceRevision) throw new Error(`source revision mismatch for ${review.capabilityId}`)
    const capability = capabilityById.get(review.capabilityId)
    if (capability === undefined || capability.sdkPath !== review.sdkPath) throw new Error(`capability mapping mismatch for ${review.capabilityId}`)
    if (review.evidence.length === 0) throw new Error(`review has no evidence for ${review.capabilityId}`)
    if (review.status === 'blocked') { blocked++; continue }
    if (review.status === 'needs-review') { needsReview++; continue }
    entries.push({ candidateId: review.candidateId, capabilityId: review.capabilityId, sdkPath: review.sdkPath, pageChain: review.pageChain, actionChain: review.actionChain, contextRules: review.contextRules, evidence: review.evidence, sourceRevision: review.sourceRevision })
  }
  if (needsReview > 0) throw new Error(`cannot compile needs-review entries (${needsReview})`)
  const missing = input.candidates.filter(candidate => !reviewedCandidates.has(candidate.candidateId))
  if (missing.length > 0) throw new Error(`candidate records without review: ${missing.slice(0, 3).map(candidate => candidate.candidateId).join(', ')}`)
  const unreviewedCapabilities = input.capabilities.filter(capability => !seen.has(capability.id))
  if (unreviewedCapabilities.length > 0) throw new Error(`capabilities without review: ${unreviewedCapabilities.slice(0, 3).map(capability => capability.id).join(', ')}`)
  const canonical = JSON.stringify(entries)
  const contentHash = createHash('sha256').update(canonical).digest('hex')
  return { schema: 'ph-permission-policy/v1', status: entries.length === input.capabilities.length ? 'complete' : 'incomplete', sourceRevision: input.sourceRevision, revision: `${input.sourceRevision}:${contentHash.slice(0, 12)}`, contentHash, counts: { accepted: entries.length, blocked, needsReview }, entries }
}

export function loadGeneratedPermissionPolicy (): PermissionPolicy {
  // Runtime builds keep generated artifacts beside src or beside dist; both paths are checked.
  const here = dirname(new URL(import.meta.url).pathname)
  const candidates = [join(here, '../../generated/permission-policy.json'), join(here, '../../../generated/permission-policy.json')]
  const file = candidates.find(existsSync)
  if (file === undefined) throw new Error('generated/permission-policy.json is missing; refusing remote capability calls')
  return JSON.parse(readFileSync(file, 'utf8')) as PermissionPolicy
}
