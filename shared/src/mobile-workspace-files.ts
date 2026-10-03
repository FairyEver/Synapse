/** Private, user initiated workspace reads. Handles are opaque and never authorize paths. */
export const MOBILE_WORKSPACE_FILES_VERSION = 1
export const MOBILE_WORKSPACE_FILES_LIMITS = {
  maxIdentifierLength: 120, maxCursorLength: 256, maxQueryLength: 256, maxQueryBytes: 1024,
  maxPathBytes: 4096, maxReferenceBytes: 8192, maxTimestampLength: 48,
  maxPageEntries: 100, maxPageDisplayBytes: 64 * 1024, maxEnvelopeBytes: 128 * 1024,
  maxFileSideBytes: 2 * 1024 * 1024, maxLineBytes: 8 * 1024,
  searchRequestMs: 2000, maxSearchRequestEntries: 20000, maxSearchEntries: 100000,
  maxSearchMatches: 10000, maxSearchStateBytes: 2 * 1024 * 1024,
  maxDirectoryEntries: 20000, maxDirectoryMetadataBytes: 2 * 1024 * 1024,
  gitTimeoutMs: 5000, maxGitStdoutBytes: 4 * 1024 * 1024, maxGitStderrBytes: 64 * 1024,
  maxDiffModelBytes: 4 * 1024 * 1024, maxDiffModelLines: 20000,
  maxReadsPerMobile: 2, maxQueuedReadsPerMobile: 4, maxReads: 8, maxQueuedReads: 32,
  queueTimeoutMs: 5000, maxScopesPerMobile: 1, maxScopes: 32,
  maxHandlesPerScope: 20000, maxHandles: 100000, maxCursorsPerScope: 32, maxCursors: 256,
  maxScopeMetadataBytes: 4 * 1024 * 1024, maxMetadataBytes: 16 * 1024 * 1024,
  scopeIdleMs: 600000, cursorIdleMs: 60000, requestTimeoutMs: 15000,
  maxMobileCacheBytes: 4 * 1024 * 1024, maxResultsPerMobile: 64, maxResults: 256,
  maxResultBytesPerMobile: 2 * 1024 * 1024, maxResultBytes: 16 * 1024 * 1024, resultTtlMs: 30000,
  maxControlsPerMobile: 128, maxControls: 512, maxControlBytes: 1024 * 1024, controlTtlMs: 30000,
  maxSocketBufferedBytes: 512 * 1024, maxQueuedPages: 2, maxQueuedBytes: 256 * 1024, sendQueueTtlMs: 5000,
} as const

export type MobileWorkspaceFilesScopeMode = "currentDirectory" | "repository"
export type MobileWorkspaceFilesGitUnavailableReason = "not_git_repository" | "git_unavailable" | "external_filter_required" | "permission_denied" | "unsafe_path" | "limit_exceeded"
export type MobileWorkspaceFilesChangeRange = "unstaged" | "staged"
export type MobileWorkspaceFilesCompletion = "complete" | "partial" | "truncated"
export type MobileWorkspaceFilesContentState = "available" | "binary" | "unsupported_encoding" | "external_filter_required" | "unsupported_platform" | "absent" | "gitlink" | "conflict" | "type_change" | "limit_exceeded" | "special_file"
export type MobileWorkspaceFilesErrorCode = "invalid_request" | "invalid_scope" | "invalid_cursor" | "request_conflict" | "permission_denied" | "unsafe_path" | "special_file" | "not_git_repository" | "git_unavailable" | "scope_stale" | "content_stale" | "cursor_expired" | "session_ended" | "binary" | "unsupported_encoding" | "external_filter_required" | "unsupported_platform" | "absent" | "gitlink" | "limit_exceeded" | "truncated" | "busy" | "transport_backpressure" | "deadline_exceeded" | "desktop_offline" | "relay_failed" | "unsupported_version"

type Envelope = { readonly v: 1; readonly intentId: string; readonly kind: "workspaceFiles"; readonly filesVersion: 1; readonly sessionId: string }
type Scoped = { readonly scopeId: string; readonly expectedContextVersion: string }
type Cursor = { readonly cursor?: string }
type ContentCursor = Cursor & { readonly expectedContentVersion?: string }
export type MobileWorkspaceFilesPreviewTarget =
  | { readonly source: "disk"; readonly entryId: string }
  | { readonly source: "change"; readonly changeId: string; readonly changeSetVersion: string; readonly side: "before" | "after" }
export type MobileWorkspaceFilesIntent = Envelope & (
  | { readonly operation: "open"; readonly scopeMode: MobileWorkspaceFilesScopeMode }
  | (Scoped & { readonly operation: "refresh" })
  | (Scoped & Cursor & { readonly operation: "directory"; readonly directoryEntryId: string })
  | (Scoped & Cursor & { readonly operation: "search"; readonly query: string })
  | (Scoped & Cursor & { readonly operation: "changes"; readonly changeRange: MobileWorkspaceFilesChangeRange })
  | (Scoped & ContentCursor & { readonly operation: "diff"; readonly changeSetVersion: string; readonly changeId: string })
  | (Scoped & ContentCursor & { readonly operation: "preview"; readonly target: MobileWorkspaceFilesPreviewTarget })
  | (Scoped & { readonly operation: "reference"; readonly entryId: string })
  | { readonly operation: "cancel"; readonly targetIntentId: string; readonly scopeId?: string }
  | { readonly operation: "close"; readonly scopeId: string }
)
export type MobileWorkspaceFilesOperation = MobileWorkspaceFilesIntent["operation"]
export interface MobileWorkspaceFilesScope {
  readonly scopeId: string; readonly rootEntryId: string; readonly scopeMode: MobileWorkspaceFilesScopeMode
  readonly rootDisplayName: string; readonly contextVersion: string; readonly expiresAt: string; readonly gitAvailable: boolean
  readonly gitUnavailableReason?: MobileWorkspaceFilesGitUnavailableReason
}
export interface MobileWorkspaceFilesMetadata { readonly sizeBytes: number | null; readonly modifiedAt: string | null }
export interface MobileWorkspaceFilesEntry {
  readonly entryId: string; readonly name: string; readonly relativePath: string
  readonly kind: "file" | "directory" | "symlink" | "special"
  readonly metadata: MobileWorkspaceFilesMetadata
  readonly canPreview: boolean; readonly canReference: boolean
  readonly unavailableReason?: MobileWorkspaceFilesContentState
}
export interface MobileWorkspaceFilesStatistics {
  readonly fileCount: number | null; readonly additions: number | null; readonly deletions: number | null
  readonly collectionComplete: boolean; readonly statsComplete: boolean
}
export interface MobileWorkspaceFilesChange {
  readonly changeId: string; readonly changeRange: MobileWorkspaceFilesChangeRange
  readonly relativePath: string; readonly oldRelativePath?: string
  readonly status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict" | "type_changed" | "gitlink"
  readonly additions: number | null; readonly deletions: number | null
  readonly statsComplete: boolean; readonly contentState: MobileWorkspaceFilesContentState
  readonly canPreviewBefore: boolean; readonly canPreviewAfter: boolean
  readonly oldGitlink?: string; readonly newGitlink?: string
}
export interface MobileWorkspaceFilesPage {
  readonly pageIndex: number; readonly nextCursor: string | null; readonly completion: MobileWorkspaceFilesCompletion
  readonly truncatedReason?: string
}
export interface MobileWorkspaceFilesDirectoryPage extends MobileWorkspaceFilesPage {
  readonly directoryVersion: string; readonly entries: readonly MobileWorkspaceFilesEntry[]; readonly collectionComplete: boolean
}
export interface MobileWorkspaceFilesSearchPage extends MobileWorkspaceFilesPage {
  readonly searchVersion: string; readonly entries: readonly MobileWorkspaceFilesEntry[]
  readonly scanComplete: boolean; readonly scannedEntries: number; readonly collectionComplete: boolean
}
export interface MobileWorkspaceFilesChangesPage extends MobileWorkspaceFilesPage {
  readonly changeSetVersion: string; readonly changeRange: MobileWorkspaceFilesChangeRange
  readonly ranges: { readonly unstaged: MobileWorkspaceFilesStatistics; readonly staged: MobileWorkspaceFilesStatistics }
  readonly entries: readonly MobileWorkspaceFilesChange[]; readonly collectionComplete: boolean; readonly statsComplete: boolean
}
export interface MobileWorkspaceFilesDiffLine {
  readonly kind: "context" | "addition" | "deletion" | "meta"
  readonly oldLineNumber: number | null; readonly newLineNumber: number | null; readonly text: string; readonly truncated: boolean
}
export interface MobileWorkspaceFilesDiffHunk {
  readonly hunkId: string; readonly oldStart: number; readonly oldCount: number; readonly newStart: number; readonly newCount: number
  readonly lineOffset: number; readonly continued: boolean; readonly lines: readonly MobileWorkspaceFilesDiffLine[]
}
export interface MobileWorkspaceFilesDiffPage extends MobileWorkspaceFilesPage {
  readonly contentVersion: string; readonly changeId: string; readonly contentState: MobileWorkspaceFilesContentState
  readonly hunks: readonly MobileWorkspaceFilesDiffHunk[]; readonly additions: number | null; readonly deletions: number | null
  readonly statsComplete: boolean; readonly contentComplete: boolean
}
export interface MobileWorkspaceFilesPreviewLine { readonly lineNumber: number; readonly text: string; readonly truncated: boolean }
export interface MobileWorkspaceFilesPreviewPage extends MobileWorkspaceFilesPage {
  readonly contentVersion: string; readonly source: "disk" | "change"; readonly side?: "before" | "after"
  readonly name: string; readonly relativePath: string; readonly metadata: MobileWorkspaceFilesMetadata
  readonly contentState: MobileWorkspaceFilesContentState; readonly lines: readonly MobileWorkspaceFilesPreviewLine[]
  readonly contentComplete: boolean; readonly format: "text" | "markdown"
}
type ResultEnvelope = { readonly filesVersion: 1; readonly sessionId: string; readonly scopeId?: string; readonly contextVersion?: string; readonly readAt: string }
export type MobileWorkspaceFilesResult = ResultEnvelope & (
  | { readonly operation: "open" | "refresh"; readonly data: MobileWorkspaceFilesScope }
  | { readonly operation: "directory"; readonly data: MobileWorkspaceFilesDirectoryPage }
  | { readonly operation: "search"; readonly data: MobileWorkspaceFilesSearchPage }
  | { readonly operation: "changes"; readonly data: MobileWorkspaceFilesChangesPage }
  | { readonly operation: "diff"; readonly data: MobileWorkspaceFilesDiffPage }
  | { readonly operation: "preview"; readonly data: MobileWorkspaceFilesPreviewPage }
  | { readonly operation: "reference"; readonly data: { readonly referenceText: string; readonly contextVersion: string } }
  | { readonly operation: "cancel"; readonly data: { readonly status: "cancelled" | "alreadyCompleted" | "notFound"; readonly closedScopeId?: string } }
  | { readonly operation: "close"; readonly data: { readonly status: "closed" | "alreadyClosed"; readonly pendingCancellationCount: number } }
)

const L = MOBILE_WORKSPACE_FILES_LIMITS
const encoder = new TextEncoder()
export function mobileWorkspaceFilesUtf8Bytes(value: string): number { return encoder.encode(value).byteLength }
export function isMobileWorkspaceFilesEnvelopeWithinBudget(value: unknown): boolean {
  try { return mobileWorkspaceFilesUtf8Bytes(JSON.stringify(value)) <= L.maxEnvelopeBytes } catch { return false }
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
function id(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= L.maxIdentifierLength }
function text(value: unknown, bytes: number, empty = true): value is string { return typeof value === "string" && (empty || value.trim().length > 0) && mobileWorkspaceFilesUtf8Bytes(value) <= bytes && !value.includes("\0") }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }
function nullableCount(value: unknown): boolean { return value === null || integer(value) }
function timestamp(value: unknown): value is string { return typeof value === "string" && value.length <= L.maxTimestampLength && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) && Number.isFinite(Date.parse(value)) }
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)) }
// The wire uses `/` for directory boundaries; POSIX filenames may contain literal backslashes.
function path(value: unknown, empty = false): boolean { return text(value, L.maxPathBytes, empty) && (empty || (value as string).length > 0) && !(value as string).startsWith("/") && !(value as string).split("/").includes("..") }
function state(value: unknown): value is MobileWorkspaceFilesContentState { return ["available", "binary", "unsupported_encoding", "external_filter_required", "unsupported_platform", "absent", "gitlink", "conflict", "type_change", "limit_exceeded", "special_file"].includes(value as string) }
function optionalId(value: unknown): boolean { return value === undefined || id(value) }
function scopeMode(value: unknown): boolean { return value === "currentDirectory" || value === "repository" }
function range(value: unknown): boolean { return value === "unstaged" || value === "staged" }
function cursor(value: unknown): boolean { return value === undefined || (typeof value === "string" && value.trim().length > 0 && value.length <= L.maxCursorLength) }
export function isMobileWorkspaceFilesIntent(value: unknown): value is MobileWorkspaceFilesIntent {
  if (!record(value) || value.v !== 1 || value.kind !== "workspaceFiles" || value.filesVersion !== 1 || !id(value.intentId) || !id(value.sessionId)) return false
  const base = ["v", "kind", "filesVersion", "intentId", "sessionId", "operation"]
  if (value.operation === "open") return keys(value, [...base, "scopeMode"]) && scopeMode(value.scopeMode)
  if (value.operation === "cancel") return keys(value, [...base, "targetIntentId", "scopeId"]) && id(value.targetIntentId) && value.targetIntentId !== value.intentId && optionalId(value.scopeId)
  if (value.operation === "close") return keys(value, [...base, "scopeId"]) && id(value.scopeId)
  if (!id(value.scopeId) || !id(value.expectedContextVersion)) return false
  const scoped = [...base, "scopeId", "expectedContextVersion"]
  if (value.operation === "refresh") return keys(value, scoped)
  if (value.operation === "reference") return keys(value, [...scoped, "entryId"]) && id(value.entryId)
  if (!cursor(value.cursor)) return false
  const paged = [...scoped, "cursor"]
  if (value.operation === "directory") return keys(value, [...paged, "directoryEntryId"]) && id(value.directoryEntryId)
  if (value.operation === "search") return keys(value, [...paged, "query"]) && typeof value.query === "string" && value.query.length <= L.maxQueryLength && text(value.query, L.maxQueryBytes, false)
  if (value.operation === "changes") return keys(value, [...paged, "changeRange"]) && range(value.changeRange)
  if (!optionalId(value.expectedContentVersion) || (value.cursor !== undefined && !id(value.expectedContentVersion))) return false
  const content = [...paged, "expectedContentVersion"]
  if (value.operation === "diff") return keys(value, [...content, "changeId", "changeSetVersion"]) && id(value.changeId) && id(value.changeSetVersion)
  if (value.operation === "preview") {
    if (!keys(value, [...content, "target"]) || !record(value.target)) return false
    if (value.target.source === "disk") return keys(value.target, ["source", "entryId"]) && id(value.target.entryId)
    return value.target.source === "change" && keys(value.target, ["source", "changeId", "changeSetVersion", "side"]) && id(value.target.changeId) && id(value.target.changeSetVersion) && (value.target.side === "before" || value.target.side === "after")
  }
  return false
}
function metadata(value: unknown): boolean { return record(value) && nullableCount(value.sizeBytes) && (value.modifiedAt === null || timestamp(value.modifiedAt)) }
function entry(value: unknown): boolean {
  return record(value) && id(value.entryId) && text(value.name, L.maxPathBytes, false) && path(value.relativePath) && ["file", "directory", "symlink", "special"].includes(value.kind as string) && metadata(value.metadata) && typeof value.canPreview === "boolean" && typeof value.canReference === "boolean" && (value.unavailableReason === undefined || state(value.unavailableReason)) && (!(value.kind === "symlink" || value.kind === "special") || (!value.canPreview && !value.canReference))
}
function stats(value: unknown): boolean { return record(value) && nullableCount(value.fileCount) && nullableCount(value.additions) && nullableCount(value.deletions) && typeof value.collectionComplete === "boolean" && typeof value.statsComplete === "boolean" && (value.collectionComplete || value.fileCount === null) && (value.statsComplete || (value.additions === null && value.deletions === null)) }
function page(value: Record<string, unknown>): boolean {
  if (!integer(value.pageIndex) || !(value.nextCursor === null || (typeof value.nextCursor === "string" && value.nextCursor.length <= L.maxCursorLength && value.nextCursor.trim().length > 0))) return false
  if (!["complete", "partial", "truncated"].includes(value.completion as string)) return false
  if (value.completion === "partial" && value.nextCursor === null) return false
  if (value.completion !== "partial" && value.nextCursor !== null) return false
  return value.completion !== "truncated" ? value.truncatedReason === undefined : text(value.truncatedReason, 1024, false)
}
function array(value: unknown, validate: (item: unknown) => boolean, max: number = L.maxPageEntries): boolean { return Array.isArray(value) && value.length <= max && value.every(validate) }
function change(value: unknown): boolean {
  return record(value) && id(value.changeId) && range(value.changeRange) && path(value.relativePath) && (value.oldRelativePath === undefined || path(value.oldRelativePath)) && ["modified", "added", "deleted", "renamed", "untracked", "conflict", "type_changed", "gitlink"].includes(value.status as string) && nullableCount(value.additions) && nullableCount(value.deletions) && typeof value.statsComplete === "boolean" && state(value.contentState) && typeof value.canPreviewBefore === "boolean" && typeof value.canPreviewAfter === "boolean" && optionalId(value.oldGitlink) && optionalId(value.newGitlink)
}
function line(value: unknown): boolean { return record(value) && ["context", "addition", "deletion", "meta"].includes(value.kind as string) && nullableCount(value.oldLineNumber) && nullableCount(value.newLineNumber) && text(value.text, L.maxLineBytes) && typeof value.truncated === "boolean" }
function hunk(value: unknown): boolean { return record(value) && id(value.hunkId) && integer(value.oldStart) && integer(value.oldCount) && integer(value.newStart) && integer(value.newCount) && integer(value.lineOffset) && typeof value.continued === "boolean" && array(value.lines, line, 8192) }
function scope(value: unknown): boolean {
  return record(value) && id(value.scopeId) && id(value.rootEntryId) && scopeMode(value.scopeMode) && text(value.rootDisplayName, L.maxPathBytes, false) && id(value.contextVersion) && timestamp(value.expiresAt) && typeof value.gitAvailable === "boolean"
    && (value.gitUnavailableReason === undefined || (value.gitAvailable === false && ["not_git_repository", "git_unavailable", "external_filter_required", "permission_denied", "unsafe_path", "limit_exceeded"].includes(value.gitUnavailableReason as string)))
}
export function isMobileWorkspaceFilesResult(value: unknown): value is MobileWorkspaceFilesResult {
  if (!record(value) || value.filesVersion !== 1 || !id(value.sessionId) || !optionalId(value.scopeId) || !optionalId(value.contextVersion) || !timestamp(value.readAt) || !record(value.data)) return false
  const data = value.data
  if (!isMobileWorkspaceFilesEnvelopeWithinBudget(value)) return false
  if (mobileWorkspaceFilesUtf8Bytes(JSON.stringify(data)) > L.maxPageDisplayBytes) return false
  if (value.operation === "open" || value.operation === "refresh") return scope(data) && value.scopeId === data.scopeId && value.contextVersion === data.contextVersion
  if (value.operation === "cancel") return ["cancelled", "alreadyCompleted", "notFound"].includes(data.status as string) && optionalId(data.closedScopeId)
  if (value.operation === "close") return id(value.scopeId) && ["closed", "alreadyClosed"].includes(data.status as string) && integer(data.pendingCancellationCount)
  if (!id(value.scopeId) || !id(value.contextVersion)) return false
  if (value.operation === "reference") return text(data.referenceText, L.maxReferenceBytes, false) && id(data.contextVersion) && data.contextVersion === value.contextVersion
  if (!page(data)) return false
  if (value.operation === "directory") return id(data.directoryVersion) && array(data.entries, entry) && typeof data.collectionComplete === "boolean"
  if (value.operation === "search" && data.scanComplete === false && data.completion === "complete") return false
  if ((value.operation === "diff" || value.operation === "preview") && data.contentComplete === true && data.completion !== "complete") return false
  if (value.operation === "search") return id(data.searchVersion) && array(data.entries, entry) && typeof data.scanComplete === "boolean" && integer(data.scannedEntries) && data.scannedEntries <= L.maxSearchEntries && typeof data.collectionComplete === "boolean"
  if (value.operation === "changes") return id(data.changeSetVersion) && range(data.changeRange) && record(data.ranges) && stats(data.ranges.unstaged) && stats(data.ranges.staged) && array(data.entries, change) && typeof data.collectionComplete === "boolean" && typeof data.statsComplete === "boolean"
  if (value.operation === "diff") return id(data.contentVersion) && id(data.changeId) && state(data.contentState) && array(data.hunks, hunk, 1024) && nullableCount(data.additions) && nullableCount(data.deletions) && typeof data.statsComplete === "boolean" && typeof data.contentComplete === "boolean"
  if (value.operation === "preview") return id(data.contentVersion) && (data.source === "disk" || data.source === "change") && (data.source === "disk" ? data.side === undefined : data.side === "before" || data.side === "after") && text(data.name, L.maxPathBytes, false) && path(data.relativePath) && metadata(data.metadata) && state(data.contentState) && array(data.lines, item => record(item) && integer(item.lineNumber) && text(item.text, L.maxLineBytes) && typeof item.truncated === "boolean", 8192) && typeof data.contentComplete === "boolean" && (data.format === "text" || data.format === "markdown")
  return false
}
