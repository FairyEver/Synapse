import { describe, expect, it } from "vitest"

import {
  formatDatabaseFolderOperationError,
  formatCreateTableSubmitError,
  getCurrentDatabaseError,
  getCurrentDatabaseQueryResult,
  getCurrentDatabaseSchema,
} from "../utils"
import type { DatabaseTableSchema } from "@/types/database"

const customerSchema: DatabaseTableSchema = {
  name: "customers",
  description: "",
  columns: [{ name: "name", kind: "text" }],
  rowCount: 1,
  createdAt: "2026-04-28T00:00:00.000Z",
  updatedAt: "2026-04-28T00:00:00.000Z",
}

describe("database utils", () => {
  it("hides stale query and schema state for a newly selected table", () => {
    expect(getCurrentDatabaseQueryResult("orders", {
      table: "customers",
      data: { rows: [{ id: 1, name: "Ada" }], total: 1 },
      error: null,
    })).toEqual({ rows: [], total: 0 })

    expect(getCurrentDatabaseSchema("orders", {
      table: "customers",
      schema: customerSchema,
      error: null,
    })).toBeNull()
  })

  it("keeps errors scoped to the table that produced them", () => {
    const error = new Error("failed")

    expect(getCurrentDatabaseError("customers", { table: "customers", data: { rows: [], total: 0 }, error }))
      .toBe(error)
    expect(getCurrentDatabaseError("orders", { table: "customers", data: { rows: [], total: 0 }, error }))
      .toBeNull()
  })

  it("maps technical create-table errors to user-facing messages", () => {
    expect(formatCreateTableSubmitError(new Error('Column "status" is a single-choice field. Replace with: ...')))
      .toBe('列 "status" 应使用单选并填写选项')
    expect(formatCreateTableSubmitError(new Error('Column "tags" is a multi-select field. Replace with: ...')))
      .toBe('列 "tags" 应使用多选并填写选项')
    expect(formatCreateTableSubmitError(new Error('Duplicate column name "email"')))
      .toBe('列名 "email" 重复')
  })

  it("maps technical folder errors to user-facing messages", () => {
    expect(formatDatabaseFolderOperationError(
      "create",
      new Error("Error invoking remote method 'synapse:app:database:folder:create': Error: UNIQUE constraint failed: _table_folders.name"),
    )).toBe("文件夹名称已存在")
  })
})
