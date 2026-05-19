/**
 * Phase 0.2 — Namespace schemas.
 *
 * Each schema declares (name, backend, currentVersion, migrations, validate)
 * and may opt-in to encryption. Schemas live in this barrel so the
 * DataRepository can iterate them in a stable order during init.
 *
 * T2.7: core.config v0 -> v1 (adds schemaVersion field).
 * T2.8: core.identity / repo.pending-pushes / repo.repositories.
 * T2.9: secrets / providers / projects / conversations / audit / outbox placeholders.
 *
 * SPEC §1 Level 3 decision (REPORT 3.2): existing services (configStore etc.)
 * keep their JSON IO for now; the schemas here exist so DataRepository can be
 * exercised + future migrations are wired in. T2.13 config-backup-service
 * rewrite is when reads/writes route through DataRepository.
 */

import type { Migration, NamespaceSchema } from "../types"
import { migration } from "../migrations"

// ----- core.config schema (T2.7) -------------------------------------

export interface CoreConfigV1 extends Record<string, unknown> {
  /** Discriminator for migration. */
  schemaVersion: 1
  activeRepoUuid: string | null
  repositories: Array<{ uuid: string; [k: string]: unknown }>
  global: Record<string, unknown>
}

const isCoreConfigV1 = (value: unknown): value is CoreConfigV1 => {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  if (v.schemaVersion !== 1) return false
  if (!("activeRepoUuid" in v)) return false
  if (!Array.isArray(v.repositories)) return false
  if (typeof v.global !== "object" || v.global === null) return false
  return true
}

/**
 * v0 -> v1: take the legacy SynapseConfig (no schemaVersion) and tag it as v1.
 * The existing sanitize step in `desktop/src/lib/config.ts` already enforces
 * required fields; we only attach the version marker here.
 */
const coreConfigMigrations: readonly Migration[] = [
  migration<Record<string, unknown>, CoreConfigV1>(0, 1, (legacy: Record<string, unknown>) => {
    return {
      schemaVersion: 1,
      activeRepoUuid:
        typeof legacy.activeRepoUuid === "string" || legacy.activeRepoUuid === null
          ? (legacy.activeRepoUuid as string | null)
          : null,
      repositories: Array.isArray(legacy.repositories) ? (legacy.repositories as CoreConfigV1["repositories"]) : [],
      global: typeof legacy.global === "object" && legacy.global !== null ? (legacy.global as Record<string, unknown>) : {},
    }
  }),
]

export const coreConfigSchema: NamespaceSchema<CoreConfigV1> = {
  name: "core.config",
  backend: "json",
  currentVersion: 1,
  migrations: coreConfigMigrations,
  validate: isCoreConfigV1,
  encrypted: false,
}

// ----- Helper: detect a legacy v0 file --------------------------------

/**
 * Returns true when a JSON envelope/raw value looks like a pre-v1 SynapseConfig
 * (i.e. has `repositories` but no `schemaVersion` at the top level OR inside
 * the envelope). Used by the JSON backend's reviveEnvelope hook.
 */
export function isLegacyCoreConfigV0(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false
  const v = raw as Record<string, unknown>
  if (typeof v.schemaVersion === "number") return false
  if (!Array.isArray(v.repositories)) return false
  return true
}
