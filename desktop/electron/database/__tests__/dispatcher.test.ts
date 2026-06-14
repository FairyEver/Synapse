import { describe, expect, it } from "vitest"

import { DATABASE_ROW_LIST_MAX_LIMIT } from "../../../database/shared/limits"
import { dispatchDatabaseAction } from "../dispatcher"

describe("database dispatcher", () => {
  it("rejects non-numeric row list pagination before reaching sqlite", async () => {
    await expect(dispatchDatabaseAction("database.row.list", {
      tableName: "tasks",
      limit: "abc",
    })).rejects.toThrow("Missing or invalid 'limit': expected number")

    await expect(dispatchDatabaseAction("database.row.list", {
      tableName: "tasks",
      offset: Number.POSITIVE_INFINITY,
    })).rejects.toThrow("Missing or invalid 'offset': expected number")
  })

  it("rejects unsafe row list pagination bounds before reaching sqlite", async () => {
    await expect(dispatchDatabaseAction("database.row.list", {
      tableName: "tasks",
      limit: -1,
    })).rejects.toThrow("Invalid 'limit': expected non-negative integer")

    await expect(dispatchDatabaseAction("database.row.list", {
      tableName: "tasks",
      offset: -1,
    })).rejects.toThrow("Invalid 'offset': expected non-negative integer")

    await expect(dispatchDatabaseAction("database.row.list", {
      tableName: "tasks",
      limit: 1.5,
    })).rejects.toThrow("Invalid 'limit': expected non-negative integer")

    await expect(dispatchDatabaseAction("database.row.list", {
      tableName: "tasks",
      limit: DATABASE_ROW_LIST_MAX_LIMIT + 1,
    })).rejects.toThrow(`Invalid 'limit': expected integer between 0 and ${DATABASE_ROW_LIST_MAX_LIMIT}`)
  })
})
