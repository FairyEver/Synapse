import type { Migration, NamespaceSchema } from "../types"

export type WorkflowMigrationStateStatus =
  | "failed"
  | "unsupported_future"
  | "legacy_recovering"
  | "legacy_recovered"
  | "legacy_conflict"

export interface WorkflowMigrationStateEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  workflowId: string
  sourceDigest: string
  sourceKind: "current" | "legacy_repository"
  targetSchemaVersion: string
  targetDigest?: string
  status: WorkflowMigrationStateStatus
  errorCode?: string
  errorMessage?: string
  updatedAt: number
}

const noMigrations: readonly Migration[] = []

export const workflowMigrationStateSchema: NamespaceSchema<WorkflowMigrationStateEntryV1> = {
  name: "workflow.migration-state",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (value): value is WorkflowMigrationStateEntryV1 => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const entry = value as Record<string, unknown>
    return entry.schemaVersion === 1
      && typeof entry.id === "string"
      && typeof entry.workflowId === "string"
      && typeof entry.sourceDigest === "string"
      && (entry.sourceKind === "current" || entry.sourceKind === "legacy_repository")
      && typeof entry.targetSchemaVersion === "string"
      && ["failed", "unsupported_future", "legacy_recovering", "legacy_recovered", "legacy_conflict"].includes(String(entry.status))
      && (entry.targetDigest === undefined || typeof entry.targetDigest === "string")
      && (entry.status !== "legacy_recovering" || (typeof entry.targetDigest === "string" && entry.targetDigest.length > 0))
      && (entry.errorCode === undefined || typeof entry.errorCode === "string")
      && (entry.errorMessage === undefined || typeof entry.errorMessage === "string")
      && typeof entry.updatedAt === "number"
  },
}
