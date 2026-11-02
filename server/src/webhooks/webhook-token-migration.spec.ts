import { readFileSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"

// The migration uses SQL shared by PostgreSQL and SQLite. This fixture never connects to a user database.
describe("single-token webhook migration (isolated SQL fixture)", () => {
  it("deletes legacy webhooks and receipts in foreign-key order, preserves users, and enforces unique token hashes", () => {
    const db = new DatabaseSync(":memory:")
    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE "User" (id TEXT PRIMARY KEY);
        CREATE TABLE "UserWebhook" (id TEXT PRIMARY KEY, "userId" TEXT REFERENCES "User"(id), "secretHash" TEXT NOT NULL, "deletedAt" TEXT);
        CREATE TABLE "WebhookDelivery" (id TEXT PRIMARY KEY, "webhookId" TEXT REFERENCES "UserWebhook"(id) ON DELETE RESTRICT);
        CREATE TABLE "WebhookDeliveryReceipt" (id TEXT PRIMARY KEY, "deliveryId" TEXT REFERENCES "WebhookDelivery"(id) ON DELETE CASCADE);
        INSERT INTO "User" VALUES ('user-1'), ('user-2');
        INSERT INTO "UserWebhook" VALUES ('hook-1', 'user-1', 'old-1', NULL), ('hook-2', 'user-2', 'old-2', 'deleted');
        INSERT INTO "WebhookDelivery" VALUES ('delivery-1', 'hook-1'), ('delivery-2', 'hook-2');
        INSERT INTO "WebhookDeliveryReceipt" VALUES ('receipt-1', 'delivery-1'), ('receipt-2', 'delivery-2');
      `)
      const sql = readFileSync(path.resolve(__dirname, "../../prisma/migrations/20261102120000_webhook_single_token/migration.sql"), "utf8")
      db.exec(sql)
      for (const table of ["UserWebhook", "WebhookDelivery", "WebhookDeliveryReceipt"]) {
        expect(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()).toMatchObject({ count: 0 })
      }
      expect(db.prepare('SELECT COUNT(*) AS count FROM "User"').get()).toMatchObject({ count: 2 })
      db.exec(`INSERT INTO "UserWebhook" VALUES ('new-hook', 'user-1', 'new-hash', NULL)`)
      expect(() => db.exec(`INSERT INTO "UserWebhook" VALUES ('duplicate', 'user-2', 'new-hash', NULL)`)).toThrow()
      expect(db.prepare('SELECT id FROM "UserWebhook"').all()).toEqual([{ id: "new-hook" }])
    } finally {
      db.close()
    }
  })
})
