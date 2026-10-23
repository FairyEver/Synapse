import { VersionedDataMigrator } from "@synapse/shared/versioned-data-migrator"

export const INTERNAL_MAIL_RENAME_MIGRATION_ID = "dock.mail-internal-rename.v1"
const INTRODUCTION_ID = "dock.mail-introduction.v1"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

interface MigrationEnvelope {
  meta: { schemaVersion: string }
  config: Record<string, unknown>
}

/** Runs before current App ID validation, without loading the App registry. */
export function migrateInternalMailConfig(config: unknown): unknown {
  if (!isRecord(config) || !isRecord(config.global) || !Array.isArray(config.global.dockAppIds)) return config
  const applied = config.global.dockMigrationIds
  if (Array.isArray(applied) && applied.includes(INTERNAL_MAIL_RENAME_MIGRATION_ID)) return config

  const migrated = VersionedDataMigrator.migrate<MigrationEnvelope>({
    source: { meta: { schemaVersion: "0.0.0" }, config },
    sourceVersion: "0.0.0",
    targetVersion: "1.0.0",
    migrations: {
      "1.0.0": (envelope) => {
        const global = envelope.config.global as Record<string, unknown>
        let ids = [...global.dockAppIds as unknown[]]
        const markers = Array.isArray(global.dockMigrationIds) ? [...global.dockMigrationIds] : []
        if (!markers.includes(INTRODUCTION_ID)) {
          ids = ids.filter((id) => id !== "launcher" && id !== "mail")
          ids.push("mail", "launcher")
          markers.push(INTRODUCTION_ID)
        }
        global.dockAppIds = [...new Set(ids.map((id) => id === "mail" ? "mail-internal" : id))]
        global.dockMigrationIds = [...markers, INTERNAL_MAIL_RENAME_MIGRATION_ID]
        return envelope
      },
    },
    validate: (value): asserts value is MigrationEnvelope => {
      if (!isRecord(value) || !isRecord(value.config) || !isRecord(value.config.global)) {
        throw new Error("Invalid internal mail config migration result")
      }
    },
  })
  return migrated.config
}
