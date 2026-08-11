import type { Migration, NamespaceSchema } from "../types"

export type UpdateInstallRecoveryPhase =
  | "not-started"
  | "preparing"
  | "prepared"
  | "manual-required"

export interface PendingUpdateInstallAttemptV1 extends Record<string, unknown> {
  attemptedAt: string
  installAttempts: 1 | 2
  manualInstallerUrl: string | null
  recoveryPhase: UpdateInstallRecoveryPhase
  targetVersion: string
}

export interface UpdateInstallRecoveryEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  pendingAttempt: PendingUpdateInstallAttemptV1 | null
}

const noMigrations: readonly Migration[] = []

export const updateInstallRecoverySchema: NamespaceSchema<UpdateInstallRecoveryEntryV1> = {
  name: "core.update-install-recovery",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isUpdateInstallRecoveryEntryV1,
  defaults: () => ({
    schemaVersion: 1,
    pendingAttempt: null,
  }),
}

function isUpdateInstallRecoveryEntryV1(value: unknown): value is UpdateInstallRecoveryEntryV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) return false
  if (value.pendingAttempt === null) return true
  if (!isRecord(value.pendingAttempt)) return false

  const attempt = value.pendingAttempt
  return typeof attempt.attemptedAt === "string"
    && (attempt.installAttempts === 1 || attempt.installAttempts === 2)
    && (attempt.manualInstallerUrl === null || typeof attempt.manualInstallerUrl === "string")
    && ["not-started", "preparing", "prepared", "manual-required"].includes(String(attempt.recoveryPhase))
    && typeof attempt.targetVersion === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
