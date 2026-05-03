import { describe, expect, it, vi } from "vitest"

import { handleDatabaseCommand } from "../../database/cli/database"

describe("handleDatabaseCommand", () => {
  it("lists tables through the canonical database action", async () => {
    const apiCall = vi.fn(async () => ({ data: [{ name: "tasks" }] }))
    const lines: string[] = []

    await handleDatabaseCommand(["table", "list"], apiCall, (line) => lines.push(line))

    expect(apiCall).toHaveBeenCalledWith("database.table.list", {})
    expect(lines.join("\n")).toContain("tasks")
  })

  it("creates a row with canonical parameter names", async () => {
    const apiCall = vi.fn(async () => ({ data: { id: 7 } }))
    const lines: string[] = []

    await handleDatabaseCommand(["row", "create", "tasks", "--data", JSON.stringify({ title: "Ship" })], apiCall, (line) => lines.push(line))

    expect(apiCall).toHaveBeenCalledWith("database.row.create", {
      tableName: "tasks",
      data: { title: "Ship" },
    })
    expect(lines.join("\n")).toContain("id=7")
  })

  it("updates rows with canonical bulk action names", async () => {
    const apiCall = vi.fn(async () => ({ affected: 2 }))
    const lines: string[] = []

    await handleDatabaseCommand([
      "rows",
      "update",
      "tasks",
      "--where-json",
      JSON.stringify({ done: false }),
      "--data",
      JSON.stringify({ done: true }),
      "--dry-run",
    ], apiCall, (line) => lines.push(line))

    expect(apiCall).toHaveBeenCalledWith("database.rows.update", {
      tableName: "tasks",
      where: { done: false },
      data: { done: true },
      dryRun: true,
    })
    expect(lines.join("\n")).toContain("matched")
  })

  it("rejects old flat database commands", async () => {
    await expect(handleDatabaseCommand(["tables"], vi.fn(), () => {})).rejects.toThrow(/Unknown database command/)
  })
})
