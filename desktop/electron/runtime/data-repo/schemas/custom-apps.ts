import {
  customAppSnapshotSchema,
  type CustomAppSnapshotDto,
} from "@synapse/shared/custom-apps-contracts"

import type { NamespaceSchema } from "../types"

export const CUSTOM_APPS_SNAPSHOT_NAMESPACE = "app.custom-apps.snapshots"

export interface CustomAppsSnapshotEntryV1 extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 1
  readonly accountId: string
  readonly cachedAt: string
  readonly snapshot: CustomAppSnapshotDto
}

export const customAppsSnapshotSchema: NamespaceSchema<CustomAppsSnapshotEntryV1> = {
  name: CUSTOM_APPS_SNAPSHOT_NAMESPACE,
  backend: "json",
  currentVersion: 1,
  migrations: [],
  encrypted: false,
  transferPolicy: "local-only",
  validate: isCustomAppsSnapshotEntryV1,
}

function isCustomAppsSnapshotEntryV1(value: unknown): value is CustomAppsSnapshotEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && value.id.length > 0
    && typeof value.accountId === "string"
    && value.accountId === value.id
    && typeof value.cachedAt === "string"
    && !Number.isNaN(Date.parse(value.cachedAt))
    && customAppSnapshotSchema.safeParse(value.snapshot).success
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
