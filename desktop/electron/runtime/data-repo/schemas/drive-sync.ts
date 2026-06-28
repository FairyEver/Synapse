import {
  DRIVE_SYNC_BINDING_STATUSES,
  DRIVE_SYNC_OPERATION_STATUSES,
  type DriveSyncBindingStatus,
  type DriveSyncOperationStatus,
} from "@synapse/shared"
import type { Migration, NamespaceSchema } from "../types"

export interface DriveSyncBindingEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  driveItemId: string
  driveItemName: string
  kind: "file" | "folder"
  drivePathHint: string | null
  localPath: string
  status: DriveSyncBindingStatus
  remoteCursor: string | null
  lastSyncedAt: string | null
  lastError: string | null
  excludeRules: readonly string[]
  createdAt: string
  updatedAt: string
}

export interface DriveSyncOperationEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
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
}

export interface DriveSyncConflictEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  bindingId: string
  driveItemId: string | null
  relativePath: string
  localPath: string | null
  remotePathHint: string | null
  type: DriveSyncConflictType
  status: DriveSyncConflictStatus
  localSnapshot: Record<string, unknown> | null
  remoteSnapshot: Record<string, unknown> | null
  resolution: DriveSyncConflictResolution | null
  createdAt: string
  resolvedAt: string | null
}

export interface DriveSyncStateEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
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
type DriveSyncConflictResolution = "use_local" | "use_remote" | "keep_both" | "skip"
type DriveSyncHealth = "idle" | "syncing" | "paused" | "error"

const noMigrations: readonly Migration[] = []
const bindingStatuses = new Set<string>(DRIVE_SYNC_BINDING_STATUSES)
const operationStatuses = new Set<string>(DRIVE_SYNC_OPERATION_STATUSES)
const itemKinds = new Set<string>(["file", "folder"])
const operationKinds = new Set<string>(["download", "upload", "delete_local", "delete_remote", "move_local", "move_remote", "scan", "resync"])
const conflictTypes = new Set<string>(["both_modified", "delete_vs_modify", "type_mismatch", "metadata_mismatch", "path_conflict"])
const conflictStatuses = new Set<string>(["open", "resolved", "ignored"])
const conflictResolutions = new Set<string>(["use_local", "use_remote", "keep_both", "skip"])
const healthValues = new Set<string>(["idle", "syncing", "paused", "error"])

export const driveSyncBindingsSchema: NamespaceSchema<DriveSyncBindingEntryV1> = {
  name: "drive.sync.bindings",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isDriveSyncBindingEntryV1,
  encrypted: false,
}

export const driveSyncOperationsSchema: NamespaceSchema<DriveSyncOperationEntryV1> = {
  name: "drive.sync.operations",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isDriveSyncOperationEntryV1,
  encrypted: false,
}

export const driveSyncConflictsSchema: NamespaceSchema<DriveSyncConflictEntryV1> = {
  name: "drive.sync.conflicts",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isDriveSyncConflictEntryV1,
  encrypted: false,
}

export const driveSyncStateSchema: NamespaceSchema<DriveSyncStateEntryV1> = {
  name: "drive.sync.state",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isDriveSyncStateEntryV1,
  encrypted: false,
  defaults: () => ({
    schemaVersion: 1,
    health: "idle",
    lastCursor: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  }),
}

function isDriveSyncBindingEntryV1(value: unknown): value is DriveSyncBindingEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
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
    && isStringArray(value.excludeRules)
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
}

function isDriveSyncOperationEntryV1(value: unknown): value is DriveSyncOperationEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
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

function isDriveSyncConflictEntryV1(value: unknown): value is DriveSyncConflictEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
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
  return value.schemaVersion === 1
    && isStringEnum(value.health, healthValues)
    && isNullableCursor(value.lastCursor)
    && isNullableIsoDateString(value.lastStartedAt)
    && isNullableIsoDateString(value.lastStoppedAt)
    && isNullableString(value.lastError)
    && isIsoDateString(value.updatedAt)
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

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
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
