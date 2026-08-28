import type { Migration, NamespaceSchema } from "../types"

export type AgentFileCheckpointStatusV1 =
  | "available"
  | "superseded"
  | "rewound"
  | "partial"
  | "unavailable"

export type AgentFileCheckpointChangeKindV1 = "added" | "modified" | "deleted"

export interface AgentFileCheckpointFingerprintV1 {
  kind: "missing" | "regular"
  sha256: string | null
  byteSize: number
  mode: number | null
  device: number | null
  inode: number | null
  parentRealPath: string
}

export interface AgentFileCheckpointFileV1 extends Record<string, unknown> {
  id: string
  displayPath: string
  absolutePath: string
  kind: AgentFileCheckpointChangeKindV1
  insertions: number
  deletions: number
  beforeExists: boolean
  afterExists: boolean
  beforeFingerprint: AgentFileCheckpointFingerprintV1
  afterFingerprint: AgentFileCheckpointFingerprintV1
  binary: boolean
  truncated: boolean
  diffCleared?: boolean
  patch?: string
}

export interface AgentFileCheckpointEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  conversationId: string
  turnId: string
  sdkSessionId: string
  sdkUserMessageId: string
  status: AgentFileCheckpointStatusV1
  insertions: number
  deletions: number
  files: AgentFileCheckpointFileV1[]
  fileCount: number
  coverageWarning: boolean
  createdAt: string
  updatedAt: string
  lastAccessedAt?: string
}

const noMigrations: readonly Migration[] = []

export const agentFileCheckpointsSchema: NamespaceSchema<AgentFileCheckpointEntryV1> = {
  name: "agent.file-checkpoints",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isAgentFileCheckpointEntryV1,
  encrypted: false,
}

function isAgentFileCheckpointEntryV1(value: unknown): value is AgentFileCheckpointEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.projectId)
    && isNonEmptyString(value.conversationId)
    && isNonEmptyString(value.turnId)
    && isNonEmptyString(value.sdkSessionId)
    && isNonEmptyString(value.sdkUserMessageId)
    && isCheckpointStatus(value.status)
    && isLineCount(value.insertions)
    && isLineCount(value.deletions)
    && Array.isArray(value.files)
    && value.files.every(isAgentFileCheckpointFileV1)
    && isLineCount(value.fileCount)
    && typeof value.coverageWarning === "boolean"
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
    && (value.lastAccessedAt === undefined || isIsoDateString(value.lastAccessedAt))
}

function isAgentFileCheckpointFileV1(value: unknown): value is AgentFileCheckpointFileV1 {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id)
    && isNonEmptyString(value.displayPath)
    && isNonEmptyString(value.absolutePath)
    && isChangeKind(value.kind)
    && isLineCount(value.insertions)
    && isLineCount(value.deletions)
    && typeof value.beforeExists === "boolean"
    && typeof value.afterExists === "boolean"
    && isCheckpointFingerprint(value.beforeFingerprint)
    && isCheckpointFingerprint(value.afterFingerprint)
    && typeof value.binary === "boolean"
    && typeof value.truncated === "boolean"
    && (value.diffCleared === undefined || typeof value.diffCleared === "boolean")
    && (value.patch === undefined || typeof value.patch === "string")
}

function isCheckpointStatus(value: unknown): value is AgentFileCheckpointStatusV1 {
  return value === "available"
    || value === "superseded"
    || value === "rewound"
    || value === "partial"
    || value === "unavailable"
}

function isCheckpointFingerprint(value: unknown): value is AgentFileCheckpointFingerprintV1 {
  if (!isRecord(value)) return false
  return (value.kind === "missing" || value.kind === "regular")
    && isNullableString(value.sha256)
    && isLineCount(value.byteSize)
    && (value.mode === null || isLineCount(value.mode))
    && (value.device === null || isLineCount(value.device))
    && (value.inode === null || isLineCount(value.inode))
    && isNonEmptyString(value.parentRealPath)
}

function isChangeKind(value: unknown): value is AgentFileCheckpointChangeKindV1 {
  return value === "added" || value === "modified" || value === "deleted"
}

function isLineCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isIsoDateString(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
