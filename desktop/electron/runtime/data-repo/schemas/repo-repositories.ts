/**
 * Phase 0.2 — repo.repositories schema (T2.8).
 *
 * The list of configured Synapse repositories lives inside `core.config`
 * (the SynapseConfig.repositories array). This schema records the per-entry
 * shape so future migrations targeted at individual repository entries (e.g.
 * adding a new field to every repo at once) can reuse the same migration
 * runner. It is NOT a separate on-disk file today.
 */

import type { Migration, NamespaceSchema } from "../types"

export interface RepoRepositoryV1 extends Record<string, unknown> {
  schemaVersion: 1
  id: string
  uuid: string
  name?: string
  rootPath?: string
}

const isRepoRepositoryV1 = (value: unknown): value is RepoRepositoryV1 => {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return v.schemaVersion === 1 && typeof v.uuid === "string" && typeof v.id === "string"
}

const repoRepositoryMigrations: readonly Migration[] = []

export const repoRepositoriesSchema: NamespaceSchema<RepoRepositoryV1> = {
  name: "repo.repositories",
  backend: "json",
  currentVersion: 1,
  migrations: repoRepositoryMigrations,
  validate: isRepoRepositoryV1,
  encrypted: false,
}
