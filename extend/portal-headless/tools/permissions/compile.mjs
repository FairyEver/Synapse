#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
const args = Object.fromEntries(process.argv.slice(2).reduce((a, value, index, values) => value.startsWith('--') ? (a.push([value.slice(2), values[index + 1] ?? '']), a) : a, []))
const readNdjson = file => readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
const candidates = readNdjson(args.candidates)
const reviews = readNdjson(args.reviews)
const capabilities = JSON.parse(readFileSync(args.capabilities, 'utf8'))
const sourceRevision = args.revision
if (!sourceRevision) throw new Error('--revision is required')
const candidateById = new Map(candidates.map(x => [x.candidateId, x]))
const capabilityById = new Map(capabilities.map(x => [x.id, x]))
const seen = new Set(); const reviewedCandidates = new Set(); const entries = []; let blocked = 0; let needsReview = 0
for (const review of reviews) {
  if (seen.has(review.capabilityId)) throw new Error(`duplicate policy for capability ${review.capabilityId}`)
  seen.add(review.capabilityId); reviewedCandidates.add(review.candidateId)
  if (!candidateById.has(review.candidateId)) throw new Error(`unknown candidate ${review.candidateId}`)
  if (!capabilityById.has(review.capabilityId) || capabilityById.get(review.capabilityId).sdkPath !== review.sdkPath) throw new Error(`capability mapping mismatch for ${review.capabilityId}`)
  if (review.sourceRevision !== sourceRevision || candidateById.get(review.candidateId).sourceRevision !== sourceRevision) throw new Error(`source revision mismatch for ${review.capabilityId}`)
  if (!Array.isArray(review.evidence) || review.evidence.length === 0) throw new Error(`review has no evidence for ${review.capabilityId}`)
  if (review.status === 'blocked') blocked++
  else if (review.status === 'needs-review') needsReview++
  else if (review.status === 'accepted') entries.push({ ...review, status: undefined, reason: undefined })
}
if (needsReview) throw new Error(`cannot compile needs-review entries (${needsReview})`)
const missing = candidates.filter(candidate => !reviewedCandidates.has(candidate.candidateId))
if (missing.length) throw new Error(`candidate records without review: ${missing.slice(0, 3).map(candidate => candidate.candidateId).join(', ')}`)
const unreviewedCapabilities = capabilities.filter(capability => !seen.has(capability.id))
if (unreviewedCapabilities.length) throw new Error(`capabilities without review: ${unreviewedCapabilities.slice(0, 3).map(capability => capability.id).join(', ')}`)
const cleaned = entries.map(({ status, reason, ...entry }) => entry)
const content = JSON.stringify(cleaned); const hash = createHash('sha256').update(content).digest('hex')
const policy = { schema: 'ph-permission-policy/v1', status: cleaned.length === capabilities.length ? 'complete' : 'incomplete', sourceRevision, revision: `${sourceRevision}:${hash.slice(0, 12)}`, contentHash: hash, counts: { accepted: cleaned.length, blocked, needsReview }, entries: cleaned }
mkdirSync(dirname(args.out), { recursive: true }); writeFileSync(args.out, JSON.stringify(policy, null, 2) + '\n')
