import { createHmac, randomBytes } from "node:crypto"
import { isAbsoluteLocalPath } from "../error-sanitize"

/** Export-local aliases preserve equality without exposing paths or a reusable path hash. */
export function createExportEvidenceProjection(): (value: unknown) => unknown {
  const salt = randomBytes(32)
  const ancestors = new WeakSet<object>()
  const alias = (value: string) => `resource-${createHmac("sha256", salt).update(value).digest("hex").slice(0, 20)}`
  const project = (value: unknown): unknown => {
    if (typeof value === "string" && /^\s*(?:\[|{)/.test(value)) {
      try { return JSON.stringify(project(JSON.parse(value))) } catch { return value }
    }
    if (!value || typeof value !== "object") return value
    if (ancestors.has(value)) return "[Circular]"
    ancestors.add(value)
    try {
    if (Array.isArray(value)) return value.map(project)
    const row = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(row)) {
      output[key] = project(item)
      if (typeof item === "string" && /(?:path|directory|root)$/i.test(key) && (item.startsWith("/") || isAbsoluteLocalPath(item))) {
        output[`${key}ResourceId`] = alias(item)
      }
    }
    // Preserve both source fields; do not invent zero when an older export lacks a size.
    if (row.type === "image" || typeof row.mimeType === "string" || typeof row.mediaType === "string") {
      const size = numericSize(row.byteSize) ?? numericSize(row.size) ?? numericSize(row.originalSize)
      output.normalizedByteSize = size ?? null
      output.sizeConflict = numericSize(row.byteSize) !== undefined && numericSize(row.size) !== undefined && row.byteSize !== row.size
    }
    return output
    } finally { ancestors.delete(value) }
  }
  return project
}
function numericSize(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Mechanical source statistics; missing IDs and zero usage are never failure evidence. */
export function summarizeSourceEvidence(history: readonly { content?: string; metadata?: Record<string, unknown> }[]) {
  const sessions = new Set<string>()
  let missingSessionIds = 0, attachmentReferences = 0, knownAttachmentBytes = 0, unknownAttachmentSizes = 0, conflictingAttachmentSizes = 0
  let cancelledRecords = 0, failedRecords = 0, apiErrorTextMentions = 0
  for (const entry of history) {
    const metadata = entry.metadata ?? {}
    const id = metadata.sdkSessionId
    if (typeof id === "string" && id.trim() && !/^(?:\?|unknown|null|undefined|\[redacted\])$/i.test(id.trim())) sessions.add(id)
    else missingSessionIds += 1
    for (const attachment of Array.isArray(metadata.attachments) ? metadata.attachments : []) {
      if (!attachment || typeof attachment !== "object") continue
      const a = attachment as Record<string, unknown>
      attachmentReferences += 1
      const bytes = numericSize(a.byteSize) ?? numericSize(a.size)
      if (bytes === undefined) unknownAttachmentSizes += 1
      else knownAttachmentBytes += bytes
      if (numericSize(a.byteSize) !== undefined && numericSize(a.size) !== undefined && a.byteSize !== a.size) conflictingAttachmentSizes += 1
    }
    const outcome = metadata.turnOutcome as { status?: unknown } | undefined
    if (outcome?.status === "cancelled") cancelledRecords += 1
    if (outcome?.status === "failed") failedRecords += 1
    apiErrorTextMentions += (entry.content?.match(/API Error/g) ?? []).length
  }
  return { source: "persisted-history", distinctKnownSdkSessionIds: sessions.size, missingOrUnknownSessionIdRecords: missingSessionIds,
    attachmentReferences, knownAttachmentBytes, unknownAttachmentSizes, conflictingAttachmentSizes,
    cancelledOutcomeRecords: cancelledRecords, failedOutcomeRecords: failedRecords, apiErrorTextMentions,
    semantics: "Attachment totals count references, not unique files. Outcome counts count records, not turns. API Error text mentions may quote older runs. Usage totals are cumulative, not current context. Missing and zero usage do not establish failure." }
}
