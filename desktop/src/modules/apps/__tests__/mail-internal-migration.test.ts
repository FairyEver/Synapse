import { describe, expect, it } from "vitest"
import { INTERNAL_MAIL_RENAME_MIGRATION_ID, migrateInternalMailConfig } from "../mail-internal-migration"

const introduction = "dock.mail-introduction.v1"

describe("internal mail config migration", () => {
  it("renames the old app in place and preserves unrelated text", () => {
    const source = { global: { dockAppIds: ["mail", "agent", "launcher"], dockMigrationIds: [introduction] }, subject: "mail" }
    const original = structuredClone(source)
    const next = migrateInternalMailConfig(source)
    expect(next).toEqual({ ...source, global: { dockAppIds: ["mail-internal", "agent", "launcher"], dockMigrationIds: [introduction, INTERNAL_MAIL_RENAME_MIGRATION_ID] } })
    expect(source).toEqual(original)
    expect(migrateInternalMailConfig(next)).toEqual(next)
  })

  it("does not reintroduce mail after the user removed it", () => {
    expect(migrateInternalMailConfig({ global: { dockAppIds: ["launcher", "agent"], dockMigrationIds: [introduction] } }))
      .toEqual({ global: { dockAppIds: ["launcher", "agent"], dockMigrationIds: [introduction, INTERNAL_MAIL_RENAME_MIGRATION_ID] } })
  })

  it("replays the historical introduction before renaming", () => {
    expect(migrateInternalMailConfig({ global: { dockAppIds: ["launcher", "agent"], dockMigrationIds: [] } }))
      .toEqual({ global: { dockAppIds: ["agent", "mail-internal", "launcher"], dockMigrationIds: [introduction, INTERNAL_MAIL_RENAME_MIGRATION_ID] } })
  })

  it("keeps new mail IDs after the rename marker and handles restored backups", () => {
    const current = { global: { dockAppIds: ["mail", "mail-internal", "launcher"], dockMigrationIds: [introduction, INTERNAL_MAIL_RENAME_MIGRATION_ID] } }
    expect(migrateInternalMailConfig(current)).toEqual(current)
    const backup = { global: { dockAppIds: ["mail", "launcher"], dockMigrationIds: [introduction, "future"] } }
    expect(migrateInternalMailConfig(backup)).toEqual({ global: { dockAppIds: ["mail-internal", "launcher"], dockMigrationIds: [introduction, "future", INTERNAL_MAIL_RENAME_MIGRATION_ID] } })
  })

  it("leaves malformed inputs for the config validator", () => {
    for (const source of [null, [], {}, { global: null }, { global: { dockAppIds: "mail" } }]) {
      expect(migrateInternalMailConfig(source)).toEqual(source)
    }
  })
})
