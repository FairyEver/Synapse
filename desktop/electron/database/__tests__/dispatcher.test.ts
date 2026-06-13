import { describe, expect, it } from "vitest"

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
})
