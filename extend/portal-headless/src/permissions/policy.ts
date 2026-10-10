import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { permissionCapabilityRegistry, permissionRegistryHash } from './registry.js'
import { permissionSourceRevision, readPermissionSource } from './source.js'

export type PermissionExpression =
  | { kind: 'code'; code: string }
  | { kind: 'all' | 'any' | 'none'; rules: PermissionExpression[] }
export type ContextRule = { evaluator: string; args?: Record<string, unknown> }
export type EvidenceRef = { file: string; line: number; snippet: string }
export type EndpointRef = { method: string; path: string; sourceFile: string; line: number }
export type UnresolvedRef = { file: string; line: number; kind: string; expression: string }
export type PermissionCandidate = {
  candidateId: string; pagePath: string; routeFile: string | null; actionFiles: string[]
  capabilityIds: string[]; endpointRefs: EndpointRef[]
  keywordHits: Array<EvidenceRef & { keyword: string }>
  importTrail: string[]; sourceRevision: string; unresolved: UnresolvedRef[]
}
export type PermissionReview = {
  candidateId: string; capabilityId: string; sdkPath: string
  pageChain: PermissionExpression; actionChain: PermissionExpression
  contextRules: ContextRule[]; evidence: EvidenceRef[]; sdkEvidence: EvidenceRef[]; endpointRefs: EndpointRef[]
  /** Empty all is allowed only with an explicit, evidenced Web absence-of-guard conclusion. */
  unrestricted?: { page?: string; action?: string }
  status: 'accepted' | 'blocked' | 'needs-review'; reason: string; sourceRevision: string
}
export type PermissionPolicyEntry = Omit<PermissionReview, 'status' | 'reason'>
export type PermissionPolicy = {
  schema: 'ph-permission-policy/v2'; status: 'complete' | 'incomplete'; sourceRevision: string
  sdkSourceRevision: string; registryHash: string; revision: string; contentHash: string
  counts: { accepted: number; blocked: number; needsReview: number }
  entries: PermissionPolicyEntry[]; blocked: Array<{ capabilityId: string; candidateId: string; reason: string }>
}
const here = dirname(fileURLToPath(import.meta.url))
const sdkRoot = join(here, '../..')
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function keys(value: Record<string, unknown>, allowed: string[]): void { check(Object.keys(value).every(key => allowed.includes(key)), 'unexpected policy field') }

export function validatePermissionExpression(value: unknown, unrestricted?: string, depth = 0): asserts value is PermissionExpression {
  check(record(value) && depth <= 32, 'invalid permission expression')
  if (value.kind === 'code') { keys(value, ['kind', 'code']); check(nonempty(value.code), 'permission code is required'); return }
  keys(value, ['kind', 'rules'])
  check(['all', 'any', 'none'].includes(String(value.kind)) && Array.isArray(value.rules) && value.rules.length <= 1000, 'invalid permission expression')
  check(value.rules.length > 0 || (value.kind === 'all' && depth === 0 && nonempty(unrestricted)), 'empty expression requires evidenced unrestricted conclusion')
  for (const rule of value.rules) validatePermissionExpression(rule, undefined, depth + 1)
}
export function validateContextRule(value: unknown): asserts value is ContextRule {
  check(record(value), 'invalid context rule'); keys(value, ['evaluator', 'args'])
  check(typeof value.evaluator === 'string' && ['tenant', 'system', 'shop', 'state', 'config'].includes(value.evaluator), 'unregistered evaluator')
  check(record(value.args), 'context evaluator args are required')
  const args = value.args
  if (['tenant', 'system', 'shop'].includes(value.evaluator)) {
    keys(args, ['id']); check(nonempty(args.id) || (typeof args.id === 'number' && Number.isFinite(args.id)), 'context id is required')
  } else {
    keys(args, value.evaluator === 'config' ? ['key', 'value'] : ['value'])
    check(typeof args.value === 'boolean' || typeof args.value === 'string' || (typeof args.value === 'number' && Number.isFinite(args.value)), 'context value is required')
    if (value.evaluator === 'config') check(nonempty(args.key) && !['__proto__', 'prototype', 'constructor'].includes(args.key), 'config key is required')
  }
}
function validateEvidence(value: unknown): asserts value is EvidenceRef {
  check(record(value) && nonempty(value.file) && Number.isSafeInteger(value.line) && Number(value.line) > 0 && nonempty(value.snippet), 'invalid source evidence')
  keys(value, ['file', 'line', 'snippet'])
}
function verifyEvidence(evidence: EvidenceRef, root: string): void {
  validateEvidence(evidence)
  const line = readPermissionSource(root, evidence.file).split(/\r?\n/)[evidence.line - 1]
  check(line !== undefined && line.trim() === evidence.snippet.trim(), 'source evidence does not match file and line')
}
function validateEndpoint(value: unknown): asserts value is EndpointRef {
  check(record(value) && ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(String(value.method)) && nonempty(value.path) && value.path.startsWith('/') && nonempty(value.sourceFile) && Number.isSafeInteger(value.line) && Number(value.line) > 0, 'invalid endpoint reference')
  keys(value, ['method', 'path', 'sourceFile', 'line'])
}
function validateEntry(value: unknown): asserts value is PermissionPolicyEntry {
  check(record(value), 'invalid policy entry')
  keys(value, ['candidateId', 'capabilityId', 'sdkPath', 'pageChain', 'actionChain', 'contextRules', 'evidence', 'sdkEvidence', 'endpointRefs', 'sourceRevision', 'unrestricted'])
  for (const field of ['candidateId', 'capabilityId', 'sdkPath', 'sourceRevision']) check(nonempty(value[field]), `missing ${field}`)
  if (value.unrestricted !== undefined) { check(record(value.unrestricted), 'invalid unrestricted conclusion'); keys(value.unrestricted, ['page', 'action']); for (const reason of Object.values(value.unrestricted)) check(nonempty(reason), 'unrestricted conclusion requires reason') }
  const unrestricted = value.unrestricted as PermissionReview['unrestricted']
  validatePermissionExpression(value.pageChain, unrestricted?.page)
  validatePermissionExpression(value.actionChain, unrestricted?.action)
  check(Array.isArray(value.contextRules), 'invalid context rules'); value.contextRules.forEach(validateContextRule)
  for (const field of ['evidence', 'sdkEvidence']) { check(Array.isArray(value[field]) && value[field].length > 0, 'accepted review needs source and SDK evidence'); (value[field] as unknown[]).forEach(validateEvidence) }
  check(Array.isArray(value.endpointRefs) && value.endpointRefs.length > 0, 'accepted review needs endpoint references'); value.endpointRefs.forEach(validateEndpoint)
}
export function evaluatePermissionExpression(expression: PermissionExpression, permissions: ReadonlySet<string>): boolean {
  switch (expression.kind) {
    case 'code': return permissions.has(expression.code)
    case 'all': return expression.rules.every(rule => evaluatePermissionExpression(rule, permissions))
    case 'any': return expression.rules.some(rule => evaluatePermissionExpression(rule, permissions))
    case 'none': return expression.rules.every(rule => !evaluatePermissionExpression(rule, permissions))
    default: return false
  }
}
function hashPolicy(policy: Omit<PermissionPolicy, 'contentHash' | 'revision'>): string { return createHash('sha256').update(JSON.stringify(policy)).digest('hex') }

export function compilePermissionPolicy(input: { candidates: PermissionCandidate[]; reviews: PermissionReview[]; sourceRoot: string; sourceRevision: string; availableContextEvaluators?: readonly string[] }): PermissionPolicy {
  check(input.sourceRevision === permissionSourceRevision(input.sourceRoot), 'source revision does not match current Portal source')
  const capabilities = permissionCapabilityRegistry()
  const candidateById = new Map<string, PermissionCandidate>()
  for (const candidate of input.candidates) {
    check(record(candidate) && nonempty(candidate.candidateId) && typeof candidate.pagePath === 'string' && Array.isArray(candidate.capabilityIds) && Array.isArray(candidate.unresolved) && Array.isArray(candidate.endpointRefs) && Array.isArray(candidate.actionFiles) && Array.isArray(candidate.importTrail) && Array.isArray(candidate.keywordHits) && (candidate.routeFile === null || nonempty(candidate.routeFile)), 'invalid candidate schema')
    check(!candidateById.has(candidate.candidateId), 'duplicate candidate')
    check(candidate.sourceRevision === input.sourceRevision, 'candidate source revision mismatch')
    candidate.endpointRefs.forEach(validateEndpoint)
    candidateById.set(candidate.candidateId, candidate)
  }
  const capabilityById = new Map(capabilities.map(capability => [capability.id, capability]))
  const seen = new Set<string>(); const reviewed = new Set<string>(); const conflicts = new Map<string, string>()
  const entries: PermissionPolicyEntry[] = []; const blocked: PermissionPolicy['blocked'] = []
  for (const review of input.reviews) {
    check(record(review) && ['accepted', 'blocked', 'needs-review'].includes(review.status) && nonempty(review.reason), 'invalid review status or reason')
    keys(review, ['candidateId', 'capabilityId', 'sdkPath', 'pageChain', 'actionChain', 'contextRules', 'evidence', 'sdkEvidence', 'endpointRefs', 'sourceRevision', 'unrestricted', 'status', 'reason'])
    check(!seen.has(review.capabilityId), `duplicate policy for capability ${review.capabilityId}`)
    seen.add(review.capabilityId); reviewed.add(review.candidateId)
    const candidate = candidateById.get(review.candidateId); const capability = capabilityById.get(review.capabilityId)
    check(candidate && capability && capability.sdkPath === review.sdkPath && candidate.capabilityIds.includes(review.capabilityId) && candidate.pagePath === capability.pagePath, 'capability/candidate/SDK mapping mismatch')
    check(review.sourceRevision === input.sourceRevision, 'review source revision mismatch')
    check(review.status !== 'needs-review', 'cannot compile needs-review entries')
    if (review.status === 'blocked') { blocked.push({ capabilityId: review.capabilityId, candidateId: review.candidateId, reason: review.reason }); continue }
    const { status: _status, reason: _reason, ...entry } = review
    validateEntry(entry)
    check(review.contextRules.every(rule => (input.availableContextEvaluators ?? ['tenant', 'system']).includes(rule.evaluator)), 'business context has no registered server resolver; mark review blocked')
    check(candidate.unresolved.length === 0 && candidate.routeFile !== null, 'accepted candidate has unresolved source or route')
    const files = new Set([candidate.routeFile, ...candidate.actionFiles, ...candidate.importTrail])
    for (const evidence of review.evidence) { check(files.has(evidence.file), 'evidence is outside candidate import/route trail'); verifyEvidence(evidence, input.sourceRoot) }
    check(review.evidence.some(ref => ref.file === candidate.routeFile), 'route evidence is required')
    for (const evidence of review.sdkEvidence) { check(evidence.file.startsWith('src/'), 'SDK evidence must reference SDK source'); verifyEvidence(evidence, sdkRoot) }
    for (const endpoint of review.endpointRefs) {
      check(candidate.endpointRefs.some(ref => JSON.stringify(ref) === JSON.stringify(endpoint)), 'endpoint not found in candidate')
      check(review.evidence.some(ref => ref.file === endpoint.sourceFile && ref.line === endpoint.line), 'endpoint requires call-site evidence')
      const key = `${capability.httpInstance}:${endpoint.method}:${endpoint.path}`
      const chain = JSON.stringify([review.pageChain, review.actionChain, review.contextRules])
      check(!conflicts.has(key) || conflicts.get(key) === chain, 'conflicting permission chains for endpoint')
      conflicts.set(key, chain)
    }
    entries.push(entry)
  }
  check([...candidateById.keys()].every(id => reviewed.has(id)), 'candidate records without review')
  check(capabilities.every(capability => seen.has(capability.id)), 'capabilities without review')
  entries.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId)); blocked.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))
  const body: Omit<PermissionPolicy, 'contentHash' | 'revision'> = { schema: 'ph-permission-policy/v2', status: 'complete', sourceRevision: input.sourceRevision,
    sdkSourceRevision: permissionSourceRevision(join(sdkRoot, 'src')), registryHash: permissionRegistryHash(), counts: { accepted: entries.length, blocked: blocked.length, needsReview: 0 }, entries, blocked }
  const contentHash = hashPolicy(body)
  return { ...body, contentHash, revision: `${input.sourceRevision}:${contentHash.slice(0, 12)}` }
}

/** Validate again at the trust boundary; JSON parsing and TS casts are not validation. */
export function validatePermissionPolicy(value: unknown, expected: { sourceRevision: string; sdkSourceRevision: string }): asserts value is PermissionPolicy {
  check(record(value), 'invalid permission policy')
  keys(value, ['schema', 'status', 'sourceRevision', 'sdkSourceRevision', 'registryHash', 'counts', 'entries', 'blocked', 'contentHash', 'revision'])
  check(value.schema === 'ph-permission-policy/v2' && value.status === 'complete', 'permission policy is incomplete or unsupported')
  check(/^[a-f0-9]{64}$/.test(expected.sourceRevision) && /^[a-f0-9]{64}$/.test(expected.sdkSourceRevision) && value.sourceRevision === expected.sourceRevision && value.sdkSourceRevision === expected.sdkSourceRevision, 'permission policy source revision is stale')
  check(value.registryHash === permissionRegistryHash(), 'permission capability registry is stale')
  check(Array.isArray(value.entries) && Array.isArray(value.blocked) && record(value.counts), 'invalid policy entries/counts')
  keys(value.counts, ['accepted', 'blocked', 'needsReview'])
  check(value.counts.accepted === value.entries.length && value.counts.blocked === value.blocked.length && value.counts.needsReview === 0, 'invalid policy counts')
  const registry = new Map(permissionCapabilityRegistry().map(cap => [cap.id, cap.sdkPath])); const seen = new Set<string>()
  for (const entry of value.entries) {
    validateEntry(entry)
    check(entry.sourceRevision === value.sourceRevision && registry.get(entry.capabilityId) === entry.sdkPath && !seen.has(entry.capabilityId), 'invalid entry mapping/revision or duplicate')
    seen.add(entry.capabilityId)
  }
  for (const blocked of value.blocked) {
    check(record(blocked) && nonempty(blocked.capabilityId) && nonempty(blocked.candidateId) && nonempty(blocked.reason) && registry.has(blocked.capabilityId) && !seen.has(blocked.capabilityId), 'invalid blocked entry')
    keys(blocked, ['capabilityId', 'candidateId', 'reason']); seen.add(blocked.capabilityId)
  }
  check(seen.size === registry.size, 'incomplete capability coverage')
  const { contentHash, revision, ...body } = value
  check(contentHash === hashPolicy(body as Omit<PermissionPolicy, 'contentHash' | 'revision'>) && revision === `${value.sourceRevision}:${String(contentHash).slice(0, 12)}`, 'permission policy content hash mismatch')
}

export function loadGeneratedPermissionPolicy(): PermissionPolicy | null {
  const file = join(sdkRoot, 'generated/permission-policy.json')
  try { return JSON.parse(readFileSync(file, 'utf8')) as PermissionPolicy } catch { return null }
}
/** Source revision is pinned independently by the SDK build, never taken from the supplied policy. */
export function loadPermissionSourcePin(): { sourceRevision: string; sdkSourceRevision: string } {
  try {
    const pin = JSON.parse(readFileSync(join(sdkRoot, 'dist/permissions/source-pin.json'), 'utf8')) as Record<string, unknown>
    if (nonempty(pin.sourceRevision) && nonempty(pin.sdkSourceRevision)) return { sourceRevision: pin.sourceRevision, sdkSourceRevision: pin.sdkSourceRevision }
  } catch { /* Missing pin is an explicit fail-closed state. */ }
  return { sourceRevision: '', sdkSourceRevision: '' }
}
