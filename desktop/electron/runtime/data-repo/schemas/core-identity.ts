/**
 * Phase 0.2 — core.identity schema (T2.8).
 *
 * The existing user-identity-service already uses schemaVersion: 2 in its file
 * format. We declare the same versioning here so DataRepository can recognize
 * it without trying to migrate. The Level 3 decision in REPORT 3.2 applies:
 * we define the schema; the live identity service keeps its existing IO.
 */

import type { Migration, NamespaceSchema } from "../types"

export interface CoreIdentityV2 extends Record<string, unknown> {
  schemaVersion: 2
  userId: string
  /** Optional display name; the identity service writes additional fields too. */
  displayName?: string
}

const isCoreIdentityV2 = (value: unknown): value is CoreIdentityV2 => {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  if (v.schemaVersion !== 2) return false
  if (typeof v.userId !== "string") return false
  return true
}

const coreIdentityMigrations: readonly Migration[] = []

export const coreIdentitySchema: NamespaceSchema<CoreIdentityV2> = {
  name: "core.identity",
  backend: "json",
  currentVersion: 2,
  migrations: coreIdentityMigrations,
  validate: isCoreIdentityV2,
  encrypted: false,
}
