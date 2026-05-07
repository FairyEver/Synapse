import { DatabaseSync } from "node:sqlite"
import { describe, expect, it, beforeEach } from "vitest"

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_table_folders" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL UNIQUE,
      "sort_order" INTEGER NOT NULL DEFAULT 0,
      "created_at" TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_table_folder_members" (
      "folder_id" INTEGER NOT NULL,
      "table_name" TEXT NOT NULL UNIQUE,
      "sort_order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY ("folder_id", "table_name"),
      FOREIGN KEY ("folder_id") REFERENCES "_table_folders"("id") ON DELETE CASCADE
    )
  `)
  db.exec("PRAGMA foreign_keys = ON")
}

describe("_table_folders and _table_folder_members schema", () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(":memory:")
    createSchema(db)
  })

  it("creates both tables successfully", () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '_table_folder%'`)
      .all() as { name: string }[]
    const names = tables.map((t) => t.name).sort()
    expect(names).toEqual(["_table_folder_members", "_table_folders"])
  })

  it("can insert a folder and retrieve it", () => {
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO "_table_folders" (name, sort_order, created_at) VALUES (?, ?, ?)`).run(
      "My Folder",
      0,
      now,
    )
    const row = db
      .prepare(`SELECT * FROM "_table_folders" WHERE name = ?`)
      .get("My Folder") as { id: number; name: string; sort_order: number; created_at: string }
    expect(row.name).toBe("My Folder")
    expect(row.sort_order).toBe(0)
    expect(row.created_at).toBe(now)
  })

  it("enforces UNIQUE constraint on folder name", () => {
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO "_table_folders" (name, sort_order, created_at) VALUES (?, ?, ?)`).run(
      "Duplicate",
      0,
      now,
    )
    expect(() => {
      db.prepare(`INSERT INTO "_table_folders" (name, sort_order, created_at) VALUES (?, ?, ?)`).run(
        "Duplicate",
        1,
        now,
      )
    }).toThrow()
  })

  it("can add members to a folder", () => {
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO "_table_folders" (name, sort_order, created_at) VALUES (?, ?, ?)`).run(
      "Group A",
      0,
      now,
    )
    const folder = db
      .prepare(`SELECT id FROM "_table_folders" WHERE name = ?`)
      .get("Group A") as { id: number }

    db.prepare(
      `INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`,
    ).run(folder.id, "users", 0)
    db.prepare(
      `INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`,
    ).run(folder.id, "orders", 1)

    const members = db
      .prepare(`SELECT table_name FROM "_table_folder_members" WHERE folder_id = ? ORDER BY sort_order`)
      .all(folder.id) as { table_name: string }[]
    expect(members.map((m) => m.table_name)).toEqual(["users", "orders"])
  })

  it("enforces UNIQUE constraint on table_name in members (single-membership)", () => {
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO "_table_folders" (name, sort_order, created_at) VALUES (?, ?, ?)`).run(
      "Folder 1",
      0,
      now,
    )
    db.prepare(`INSERT INTO "_table_folders" (name, sort_order, created_at) VALUES (?, ?, ?)`).run(
      "Folder 2",
      1,
      now,
    )
    const f1 = db
      .prepare(`SELECT id FROM "_table_folders" WHERE name = ?`)
      .get("Folder 1") as { id: number }
    const f2 = db
      .prepare(`SELECT id FROM "_table_folders" WHERE name = ?`)
      .get("Folder 2") as { id: number }

    db.prepare(
      `INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`,
    ).run(f1.id, "shared_table", 0)

    // Same table_name in a different folder should fail due to UNIQUE on table_name
    expect(() => {
      db.prepare(
        `INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`,
      ).run(f2.id, "shared_table", 0)
    }).toThrow()
  })

  it("CASCADE deletes members when folder is deleted", () => {
    const now = new Date().toISOString()
    db.exec("PRAGMA foreign_keys = ON")
    db.prepare(`INSERT INTO "_table_folders" (name, sort_order, created_at) VALUES (?, ?, ?)`).run(
      "To Delete",
      0,
      now,
    )
    const folder = db
      .prepare(`SELECT id FROM "_table_folders" WHERE name = ?`)
      .get("To Delete") as { id: number }

    db.prepare(
      `INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`,
    ).run(folder.id, "table_a", 0)
    db.prepare(
      `INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`,
    ).run(folder.id, "table_b", 1)

    db.prepare(`DELETE FROM "_table_folders" WHERE id = ?`).run(folder.id)

    const remaining = db
      .prepare(`SELECT * FROM "_table_folder_members" WHERE folder_id = ?`)
      .all(folder.id)
    expect(remaining).toHaveLength(0)
  })
})
