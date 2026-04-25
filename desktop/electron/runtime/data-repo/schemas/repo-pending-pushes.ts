/**
 * Phase 0.2 — repo.pending-pushes schema (T2.8).
 *
 * Pending-pushes lives in the per-repository SQLite cache database
 * (electron/services/repository-cache-database.ts), not in DataRepository
 * yet. The schema here exists so future migrations can be wired in alongside
 * the SqliteNamespace once Phase 0.5 ProjectContainer makes per-project
 * scoping the right home for it.
 */

import type { Migration, NamespaceSchema } from "../types"

export interface RepoPendingPushV1 extends Record<string, unknown> {
  schemaVersion: 1
  id: string
  repositoryUuid: string
  action: string
  commitHash: string | null
  targetId: string
  title: string | null
  createdAt: string
  retryCount: number
  lastError: string | null
}

const isRepoPendingPushV1 = (value: unknown): value is RepoPendingPushV1 => {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.schemaVersion === 1
    && typeof v.id === "string"
    && typeof v.repositoryUuid === "string"
    && typeof v.action === "string"
    && typeof v.targetId === "string"
    && typeof v.retryCount === "number"
  )
}

const repoPendingPushMigrations: readonly Migration[] = []

export const repoPendingPushesSchema: NamespaceSchema<RepoPendingPushV1> = {
  name: "repo.pending-pushes",
  backend: "sqlite",
  currentVersion: 1,
  migrations: repoPendingPushMigrations,
  validate: isRepoPendingPushV1,
  encrypted: false,
}
