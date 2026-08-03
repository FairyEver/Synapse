import type {
  DriveSyncBindingStatus,
  DriveSyncConflictResolutionAction,
  DriveSyncExcludeRulesDto,
  DriveSyncInitialDirection,
  DriveSyncOperationStatus,
} from "@synapse/shared" with { "resolution-mode": "import" }
import type { Migration, NamespaceSchema } from "../types"

export interface DriveSyncBindingEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1 | 2 | 3
  ownerUserId?: string
  initialDirection?: DriveSyncInitialDirection
  initialPhase?: "transfer" | "reconcile" | "replay" | null
  initialCursor?: string | null
  driveItemId: string
  remoteParentId?: string | null
  driveItemName: string
  kind: "file" | "folder"
  drivePathHint: string | null
  localPath: string
  status: DriveSyncBindingStatus
  remoteCursor: string | null
  lastSyncedAt: string | null
  lastError: string | null
  excludeRules: DriveSyncExcludeRulesDto
  createdAt: string
  updatedAt: string
}

export interface DriveSyncBaselineEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1 | 2
  bindingId: string
  relativePath: string
  kind: "file" | "folder"
  remoteItemId: string
  remoteVersionId: string | null
  remoteEtag: string | null
  localSize: number | null
  localMtimeMs: number | null
  localHash: string | null
  lastSyncedAt: string
  deletedAt: string | null
}

export interface DriveSyncOperationEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1 | 2
  bindingId: string
  kind: DriveSyncOperationKind
  status: DriveSyncOperationStatus
  driveItemId: string | null
  relativePath: string
  localPath: string | null
  remotePathHint: string | null
  message: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  attemptCount?: number
  nextRetryAt?: string | null
  completedBytes?: number | null
  totalBytes?: number | null
  remoteItemKind?: "file" | "folder" | null
  source?: "local" | "remote" | "initialization" | "manual"
  snapshotPath?: string | null
  snapshotHash?: string | null
  snapshotSize?: number | null
  snapshotMtimeMs?: number | null
  completedRemoteMutations?: DriveChangeType[]
}

export interface DriveSyncConflictEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1 | 2
  bindingId: string
  driveItemId: string | null
  relativePath: string
  localPath: string | null
  remotePathHint: string | null
  type: DriveSyncConflictType
  status: DriveSyncConflictStatus
  localSnapshot: Record<string, unknown> | null
  remoteSnapshot: Record<string, unknown> | null
  resolution: DriveSyncConflictResolutionAction | null
  createdAt: string
  resolvedAt: string | null
}

export interface DriveSyncStateEntryV1 extends Record<string, unknown> {
  schemaVersion: 1 | 2
  ownerUserId?: string | null
  health: DriveSyncHealth
  lastCursor: string | null
  lastStartedAt: string | null
  lastStoppedAt: string | null
  lastError: string | null
  updatedAt: string
  healthByOwner?: Record<string, DriveSyncOwnerHealthState>
}

export interface DriveSyncOwnerHealthState {
  health: DriveSyncHealth
  lastCursor: string | null
  lastStartedAt: string | null
  lastStoppedAt: string | null
  lastError: string | null
  updatedAt: string
}

type DriveSyncOperationKind =
  | "download"
  | "upload"
  | "delete_local"
  | "delete_remote"
  | "move_local"
  | "move_remote"
  | "scan"
  | "resync"

type DriveSyncConflictType =
  | "both_modified"
  | "delete_vs_modify"
  | "type_mismatch"
  | "metadata_mismatch"
  | "path_conflict"

type DriveSyncConflictStatus = "open" | "resolved" | "ignored"
type DriveSyncHealth = "idle" | "syncing" | "retrying" | "paused" | "error"
type DriveChangeType = "created" | "content_updated" | "renamed" | "moved" | "trashed" | "restored" | "deleted"

const clearCollectionV1Migration: readonly Migration[] = [{ from: 1, to: 2, migrate: () => [] }]
const bindingMigrations: readonly Migration[] = [
  ...clearCollectionV1Migration,
  {
    from: 2,
    to: 3,
    migrate: (data: unknown) => Array.isArray(data)
      ? data.map((value) => migrateBindingV2ToV3(value))
      : data,
  },
]
const resetStateV1Migration: readonly Migration[] = [{
  from: 1,
  to: 2,
  migrate: () => ({
    schemaVersion: 2,
    ownerUserId: null,
    health: "idle",
    lastCursor: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
    healthByOwner: {},
  }),
}]
const bindingStatuses = new Set<string>(["initializing", "active", "paused", "conflict", "error", "removed"])
const operationStatuses = new Set<string>(["pending", "running", "succeeded", "retry_wait", "conflict", "error"])
const itemKinds = new Set<string>(["file", "folder"])
const operationKinds = new Set<string>(["download", "upload", "delete_local", "delete_remote", "move_local", "move_remote", "scan", "resync"])
const conflictTypes = new Set<string>(["both_modified", "delete_vs_modify", "type_mismatch", "metadata_mismatch", "path_conflict"])
const conflictStatuses = new Set<string>(["open", "resolved", "ignored"])
const conflictResolutions = new Set<string>(["keep_local", "keep_remote", "keep_both", "confirm_delete", "skip"])
const healthValues = new Set<string>(["idle", "syncing", "retrying", "paused", "error"])
const initialDirections = new Set<string>(["remote_to_local", "local_to_remote", "bind_existing"])
const operationSources = new Set<string>(["local", "remote", "initialization", "manual"])
const driveChangeTypes = new Set<string>(["created", "content_updated", "renamed", "moved", "trashed", "restored", "deleted"])

export const driveSyncBindingsSchema: NamespaceSchema<DriveSyncBindingEntryV1> = {
  name: "drive.sync.bindings",
  backend: "sqlite",
  currentVersion: 3,
  migrations: bindingMigrations,
  validate: isDriveSyncBindingEntryV1,
  encrypted: false,
}

export const driveSyncBaselineSchema: NamespaceSchema<DriveSyncBaselineEntryV1> = {
  name: "drive.sync.baseline",
  backend: "sqlite",
  currentVersion: 2,
  migrations: clearCollectionV1Migration,
  validate: isDriveSyncBaselineEntryV1,
  encrypted: false,
}

export const driveSyncOperationsSchema: NamespaceSchema<DriveSyncOperationEntryV1> = {
  name: "drive.sync.operations",
  backend: "sqlite",
  currentVersion: 2,
  migrations: clearCollectionV1Migration,
  validate: isDriveSyncOperationEntryV1,
  encrypted: false,
}

export const driveSyncConflictsSchema: NamespaceSchema<DriveSyncConflictEntryV1> = {
  name: "drive.sync.conflicts",
  backend: "sqlite",
  currentVersion: 2,
  migrations: clearCollectionV1Migration,
  validate: isDriveSyncConflictEntryV1,
  encrypted: false,
}

export const driveSyncStateSchema: NamespaceSchema<DriveSyncStateEntryV1> = {
  name: "drive.sync.state",
  backend: "json",
  currentVersion: 2,
  migrations: resetStateV1Migration,
  validate: isDriveSyncStateEntryV1,
  encrypted: false,
  defaults: () => ({
    schemaVersion: 2,
    ownerUserId: null,
    health: "idle",
    lastCursor: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
    healthByOwner: {},
  }),
}

function isDriveSyncBindingEntryV1(value: unknown): value is DriveSyncBindingEntryV1 {
  if (!isRecord(value)) return false
  const versionValid = value.schemaVersion === 1 || value.schemaVersion === 2 || value.schemaVersion === 3
  const ownershipValid = value.schemaVersion === 1
    || (isNonEmptyString(value.ownerUserId)
      && isStringEnum(value.initialDirection, initialDirections)
      && isNullableString(value.remoteParentId))
  const initializationValid = value.schemaVersion !== 3 || (
    (value.initialPhase === null || value.initialPhase === "transfer" || value.initialPhase === "reconcile" || value.initialPhase === "replay")
    && isNullableCursor(value.initialCursor)
  )
  return versionValid
    && ownershipValid
    && initializationValid
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.driveItemId)
    && isNonEmptyString(value.driveItemName)
    && isStringEnum(value.kind, itemKinds)
    && isNullableString(value.drivePathHint)
    && isNonEmptyString(value.localPath)
    && isStringEnum(value.status, bindingStatuses)
    && isNullableCursor(value.remoteCursor)
    && isNullableIsoDateString(value.lastSyncedAt)
    && isNullableString(value.lastError)
    && isDriveSyncExcludeRules(value.excludeRules)
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
}

function migrateBindingV2ToV3(value: unknown): unknown {
  if (!isRecord(value) || value.schemaVersion !== 2) return value
  return {
    ...value,
    schemaVersion: 3,
    initialPhase: value.status === "initializing" ? "reconcile" : null,
    initialCursor: null,
  }
}

function isDriveSyncBaselineEntryV1(value: unknown): value is DriveSyncBaselineEntryV1 {
  if (!isRecord(value)) return false
  return (value.schemaVersion === 1 || value.schemaVersion === 2)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.bindingId)
    && isSafeRelativePath(value.relativePath)
    && isStringEnum(value.kind, itemKinds)
    && isNonEmptyString(value.remoteItemId)
    && isNullableString(value.remoteVersionId)
    && isNullableString(value.remoteEtag)
    && isNullableNonNegativeNumber(value.localSize)
    && isNullableNonNegativeNumber(value.localMtimeMs)
    && isNullableString(value.localHash)
    && isIsoDateString(value.lastSyncedAt)
    && isNullableIsoDateString(value.deletedAt)
}

function isDriveSyncOperationEntryV1(value: unknown): value is DriveSyncOperationEntryV1 {
  if (!isRecord(value)) return false
  const progressValid = value.schemaVersion === 1 || (
    isNonNegativeInteger(value.attemptCount)
    && isNullableIsoDateString(value.nextRetryAt)
    && isNullableNonNegativeNumber(value.completedBytes)
    && isNullableNonNegativeNumber(value.totalBytes)
    && (value.remoteItemKind === null || isStringEnum(value.remoteItemKind, itemKinds))
    && isStringEnum(value.source, operationSources)
    && isNullableString(value.snapshotPath)
    && isNullableString(value.snapshotHash)
    && isNullableNonNegativeNumber(value.snapshotSize)
    && isNullableNonNegativeNumber(value.snapshotMtimeMs)
    && (value.completedRemoteMutations === undefined
      || (Array.isArray(value.completedRemoteMutations)
        && value.completedRemoteMutations.every((item) => isStringEnum(item, driveChangeTypes))))
    && isValidProgressPair(value.completedBytes, value.totalBytes)
  )
  return (value.schemaVersion === 1 || value.schemaVersion === 2)
    && progressValid
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.bindingId)
    && isStringEnum(value.kind, operationKinds)
    && isStringEnum(value.status, operationStatuses)
    && isNullableString(value.driveItemId)
    && typeof value.relativePath === "string"
    && isNullableString(value.localPath)
    && isNullableString(value.remotePathHint)
    && isNullableString(value.message)
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
    && isNullableIsoDateString(value.startedAt)
    && isNullableIsoDateString(value.completedAt)
}

function isValidProgressPair(completedBytes: unknown, totalBytes: unknown): boolean {
  if (completedBytes === null || totalBytes === null) return true
  return typeof completedBytes === "number" && typeof totalBytes === "number" && completedBytes <= totalBytes
}

function isDriveSyncConflictEntryV1(value: unknown): value is DriveSyncConflictEntryV1 {
  if (!isRecord(value)) return false
  return (value.schemaVersion === 1 || value.schemaVersion === 2)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.bindingId)
    && isNullableString(value.driveItemId)
    && typeof value.relativePath === "string"
    && isNullableString(value.localPath)
    && isNullableString(value.remotePathHint)
    && isStringEnum(value.type, conflictTypes)
    && isStringEnum(value.status, conflictStatuses)
    && isNullableRecord(value.localSnapshot)
    && isNullableRecord(value.remoteSnapshot)
    && (value.resolution === null || isStringEnum(value.resolution, conflictResolutions))
    && isIsoDateString(value.createdAt)
    && isNullableIsoDateString(value.resolvedAt)
}

function isDriveSyncStateEntryV1(value: unknown): value is DriveSyncStateEntryV1 {
  if (!isRecord(value)) return false
  return (value.schemaVersion === 1 || value.schemaVersion === 2)
    && (value.schemaVersion === 1 || isNullableString(value.ownerUserId))
    && isStringEnum(value.health, healthValues)
    && isNullableCursor(value.lastCursor)
    && isNullableIsoDateString(value.lastStartedAt)
    && isNullableIsoDateString(value.lastStoppedAt)
    && isNullableString(value.lastError)
    && isIsoDateString(value.updatedAt)
    && (value.schemaVersion === 1 || isDriveSyncOwnerHealthMap(value.healthByOwner))
}

function isDriveSyncOwnerHealthMap(value: unknown): value is Record<string, DriveSyncOwnerHealthState> {
  if (!isRecord(value)) return false
  return Object.entries(value).every(([ownerUserId, state]) =>
    ownerUserId.length > 0
    && isRecord(state)
    && isStringEnum(state.health, healthValues)
    && isNullableCursor(state.lastCursor)
    && isNullableIsoDateString(state.lastStartedAt)
    && isNullableIsoDateString(state.lastStoppedAt)
    && isNullableString(state.lastError)
    && isIsoDateString(state.updatedAt),
  )
}

function isStringEnum(value: unknown, values: ReadonlySet<string>): value is string {
  return typeof value === "string" && values.has(value)
}

function isNullableCursor(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isDriveSyncExcludeRules(value: unknown): value is DriveSyncExcludeRulesDto {
  if (!isRecord(value)) return false
  return isStringArray(value.forced)
    && isStringArray(value.defaults)
    && isStringArray(value.importedGitignore)
    && isStringArray(value.user)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string") return false
  if (value === "") return true
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(value)) return false
  const segments = value.split(/[\\/]+/u)
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function isNullableRecord(value: unknown): value is Record<string, unknown> | null {
  return value === null || isRecord(value)
}

function isNullableIsoDateString(value: unknown): value is string | null {
  return value === null || isIsoDateString(value)
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
