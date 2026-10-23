import { readFileSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"

describe("internal mail notification migration (isolated SQL fixture)", () => {
  it("preserves delivery identity and user state and only rewrites matching system links", () => {
    const db = new DatabaseSync(":memory:")
    try {
      db.exec('CREATE TABLE "UserNotification" (id TEXT, source TEXT, "group" TEXT, url TEXT, "targetId" TEXT, "sourceKey" TEXT, "readAt" TEXT, "deletedAt" TEXT, "createdAt" TEXT)')
      const insert = db.prepare('INSERT INTO "UserNotification" VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      insert.run("n1", "mail", "mail", "synapse://mail/m1", "m1", "mail:m1", "read", "deleted", "created")
      insert.run("n2", "mail", "custom", "https://example.com/keep", "m2", "mail:m2", null, null, "created")
      insert.run("n3", "external", "mail", "synapse://mail/m3", "m3", "external:m3", null, null, "created")
      const sql = readFileSync(path.resolve(__dirname, "../../prisma/migrations/20261023000100_mail_internal_namespace/migration.sql"), "utf8")
      db.exec(sql)
      const rows = db.prepare('SELECT * FROM "UserNotification" ORDER BY id').all().map(row => ({ ...row }))
      expect(rows[0]).toEqual({ id: "n1", source: "mail-internal", group: "mail-internal", url: "synapse://mail-internal/m1", targetId: "m1", sourceKey: "mail:m1", readAt: "read", deletedAt: "deleted", createdAt: "created" })
      expect(rows[1]).toMatchObject({ source: "mail-internal", group: "custom", url: "https://example.com/keep", sourceKey: "mail:m2" })
      expect(rows[2]).toMatchObject({ source: "external", group: "mail", url: "synapse://mail/m3" })
      db.exec(sql)
      expect(db.prepare('SELECT * FROM "UserNotification" ORDER BY id').all().map(row => ({ ...row }))).toEqual(rows)
    } finally {
      db.close()
    }
  })
})
