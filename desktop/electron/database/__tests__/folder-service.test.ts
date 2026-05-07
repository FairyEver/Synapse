import { DatabaseSync } from "node:sqlite"
import { describe, expect, it, beforeEach } from "vitest"

function toNumber(v: number | bigint): number {
  return typeof v === "bigint" ? Number(v) : v
}

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

// ── Service method implementations (mirrors DatabaseService) ─────────────────

function folderCreate(db: DatabaseSync, name: string): { id: number } {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Folder name cannot be empty")
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM "_table_folders"`).get() as { m: number | bigint | null }
  const sortOrder = (maxOrder?.m != null ? toNumber(maxOrder.m) : -1) + 1
  const now = new Date().toISOString()
  const result = db.prepare(
    `INSERT INTO "_table_folders" ("name", "sort_order", "created_at") VALUES (?, ?, ?)`
  ).run(trimmed, sortOrder, now)
  return { id: toNumber(result.lastInsertRowid) }
}

function folderList(db: DatabaseSync): { id: number; name: string; sortOrder: number; members: { tableName: string; sortOrder: number }[] }[] {
  const folders = db.prepare(`SELECT id, name, sort_order FROM "_table_folders" ORDER BY sort_order, id`).all() as {
    id: number | bigint; name: string; sort_order: number | bigint
  }[]
  const members = db.prepare(`SELECT folder_id, table_name, sort_order FROM "_table_folder_members" ORDER BY sort_order`).all() as {
    folder_id: number | bigint; table_name: string; sort_order: number | bigint
  }[]
  const membersByFolder = new Map<number, { tableName: string; sortOrder: number }[]>()
  for (const m of members) {
    const fid = toNumber(m.folder_id)
    const list = membersByFolder.get(fid) ?? []
    list.push({ tableName: m.table_name, sortOrder: toNumber(m.sort_order) })
    membersByFolder.set(fid, list)
  }
  return folders.map((f) => ({
    id: toNumber(f.id),
    name: f.name,
    sortOrder: toNumber(f.sort_order),
    members: membersByFolder.get(toNumber(f.id)) ?? [],
  }))
}

function folderRename(db: DatabaseSync, id: number, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Folder name cannot be empty")
  const result = db.prepare(`UPDATE "_table_folders" SET name = ? WHERE id = ?`).run(trimmed, id)
  if (result.changes === 0) throw new Error(`Folder not found: ${id}`)
}

function folderDelete(db: DatabaseSync, id: number): void {
  db.exec("PRAGMA foreign_keys=ON")
  const result = db.prepare(`DELETE FROM "_table_folders" WHERE id = ?`).run(id)
  if (result.changes === 0) throw new Error(`Folder not found: ${id}`)
}

function folderMoveTable(db: DatabaseSync, tableName: string, folderId: number | null): void {
  db.prepare(`DELETE FROM "_table_folder_members" WHERE table_name = ?`).run(tableName)
  if (folderId !== null) {
    const maxOrder = db.prepare(
      `SELECT MAX(sort_order) as m FROM "_table_folder_members" WHERE folder_id = ?`
    ).get(folderId) as { m: number | bigint | null }
    const sortOrder = (maxOrder?.m != null ? toNumber(maxOrder.m) : -1) + 1
    db.prepare(
      `INSERT INTO "_table_folder_members" ("folder_id", "table_name", "sort_order") VALUES (?, ?, ?)`
    ).run(folderId, tableName, sortOrder)
  }
}

function folderCleanupOrphans(db: DatabaseSync, existingTableNames: string[]): void {
  if (existingTableNames.length === 0) {
    db.exec(`DELETE FROM "_table_folder_members"`)
    return
  }
  const placeholders = existingTableNames.map(() => "?").join(",")
  db.prepare(
    `DELETE FROM "_table_folder_members" WHERE table_name NOT IN (${placeholders})`
  ).run(...existingTableNames)
}

// ── Schema tests ──────────────────────────────────────────────────────────────

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

// ── Service method tests ──────────────────────────────────────────────────────

describe("folder service methods", () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(":memory:")
    createSchema(db)
  })

  describe("folderCreate + folderList round-trip", () => {
    it("creates a folder and lists it with no members", () => {
      const { id } = folderCreate(db, "Alpha")
      expect(id).toBeGreaterThan(0)
      const list = folderList(db)
      expect(list).toHaveLength(1)
      expect(list[0].name).toBe("Alpha")
      expect(list[0].members).toEqual([])
    })

    it("assigns incrementing sort_order to multiple folders", () => {
      folderCreate(db, "First")
      folderCreate(db, "Second")
      folderCreate(db, "Third")
      const list = folderList(db)
      expect(list.map((f) => f.name)).toEqual(["First", "Second", "Third"])
      expect(list.map((f) => f.sortOrder)).toEqual([0, 1, 2])
    })

    it("rejects empty name", () => {
      expect(() => folderCreate(db, "   ")).toThrow("Folder name cannot be empty")
    })

    it("lists members grouped by folder", () => {
      const { id: fid } = folderCreate(db, "MyFolder")
      db.prepare(`INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`).run(fid, "users", 0)
      db.prepare(`INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`).run(fid, "orders", 1)
      const list = folderList(db)
      expect(list[0].members).toEqual([
        { tableName: "users", sortOrder: 0 },
        { tableName: "orders", sortOrder: 1 },
      ])
    })
  })

  describe("folderRename", () => {
    it("renames an existing folder", () => {
      const { id } = folderCreate(db, "OldName")
      folderRename(db, id, "NewName")
      const list = folderList(db)
      expect(list[0].name).toBe("NewName")
    })

    it("throws when folder does not exist", () => {
      expect(() => folderRename(db, 9999, "X")).toThrow("Folder not found: 9999")
    })

    it("rejects empty name", () => {
      const { id } = folderCreate(db, "Valid")
      expect(() => folderRename(db, id, "")).toThrow("Folder name cannot be empty")
    })
  })

  describe("folderDelete with CASCADE", () => {
    it("deletes the folder and its members", () => {
      const { id } = folderCreate(db, "ToDelete")
      db.prepare(`INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`).run(id, "tbl_a", 0)
      db.prepare(`INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`).run(id, "tbl_b", 1)

      folderDelete(db, id)

      const folders = folderList(db)
      expect(folders).toHaveLength(0)
      const members = db.prepare(`SELECT * FROM "_table_folder_members"`).all()
      expect(members).toHaveLength(0)
    })

    it("throws when folder does not exist", () => {
      expect(() => folderDelete(db, 9999)).toThrow("Folder not found: 9999")
    })
  })

  describe("folderMoveTable", () => {
    it("moves a table into a folder", () => {
      const { id } = folderCreate(db, "Folder")
      folderMoveTable(db, "my_table", id)
      const list = folderList(db)
      expect(list[0].members).toEqual([{ tableName: "my_table", sortOrder: 0 }])
    })

    it("moves a table between folders", () => {
      const { id: f1 } = folderCreate(db, "Folder1")
      const { id: f2 } = folderCreate(db, "Folder2")
      folderMoveTable(db, "my_table", f1)
      folderMoveTable(db, "my_table", f2)
      const list = folderList(db)
      expect(list.find((f) => f.id === f1)?.members).toEqual([])
      expect(list.find((f) => f.id === f2)?.members).toEqual([{ tableName: "my_table", sortOrder: 0 }])
    })

    it("removes a table from its folder when folderId is null", () => {
      const { id } = folderCreate(db, "Folder")
      folderMoveTable(db, "my_table", id)
      folderMoveTable(db, "my_table", null)
      const list = folderList(db)
      expect(list[0].members).toEqual([])
    })

    it("appends to existing members with incrementing sort_order", () => {
      const { id } = folderCreate(db, "Folder")
      folderMoveTable(db, "table_a", id)
      folderMoveTable(db, "table_b", id)
      const list = folderList(db)
      expect(list[0].members).toEqual([
        { tableName: "table_a", sortOrder: 0 },
        { tableName: "table_b", sortOrder: 1 },
      ])
    })
  })

  describe("folderCleanupOrphans", () => {
    it("removes members whose table no longer exists", () => {
      const { id } = folderCreate(db, "Folder")
      db.prepare(`INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`).run(id, "alive", 0)
      db.prepare(`INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`).run(id, "dead", 1)

      folderCleanupOrphans(db, ["alive"])

      const list = folderList(db)
      expect(list[0].members).toEqual([{ tableName: "alive", sortOrder: 0 }])
    })

    it("removes all members when existingTableNames is empty", () => {
      const { id } = folderCreate(db, "Folder")
      db.prepare(`INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`).run(id, "tbl", 0)

      folderCleanupOrphans(db, [])

      const list = folderList(db)
      expect(list[0].members).toEqual([])
    })

    it("keeps all members when all tables still exist", () => {
      const { id } = folderCreate(db, "Folder")
      db.prepare(`INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`).run(id, "tbl_a", 0)
      db.prepare(`INSERT INTO "_table_folder_members" (folder_id, table_name, sort_order) VALUES (?, ?, ?)`).run(id, "tbl_b", 1)

      folderCleanupOrphans(db, ["tbl_a", "tbl_b", "tbl_c"])

      const list = folderList(db)
      expect(list[0].members).toHaveLength(2)
    })
  })
})
