import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DATABASE_ROW_LIST_MAX_LIMIT } from "../../../database/shared/limits"
import { dispatchDatabaseAction, setDatabaseChangeListener } from "../dispatcher"

const mocks = vi.hoisted(() => ({
  databaseService: {
    databaseRowCreate: vi.fn(),
    recordOperation: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
  },
}))

vi.mock("../service", () => ({
  databaseService: mocks.databaseService,
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

describe("database dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.databaseService.databaseRowCreate.mockReturnValue({ id: 1 })
  })

  afterEach(() => {
    setDatabaseChangeListener(null)
  })

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

  it("warns without failing the mutation when operation log recording fails", async () => {
    mocks.databaseService.recordOperation.mockImplementationOnce(() => {
      throw new Error("token=sk-test-secret")
    })

    const result = await dispatchDatabaseAction("database.row.create", {
      data: { title: "private task" },
      tableName: "tasks",
    }, { source: "mcp-http" })

    expect(result).toEqual({ ok: true, data: { id: 1 }, affected: 1 })
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Database mutation operation log write failed.",
      expect.objectContaining({
        action: "database.row.create",
        dryRun: false,
        errorName: "Error",
        source: "mcp-http",
        table: "tasks",
      }),
    )
    const metadata = JSON.stringify(mocks.logger.warn.mock.calls[0]?.[1])
    expect(metadata).not.toContain("sk-test-secret")
    expect(metadata).not.toContain("private task")
  })

  it("warns without failing the mutation when change notification fails", async () => {
    setDatabaseChangeListener(() => {
      throw new Error("renderer refresh failed")
    })

    const result = await dispatchDatabaseAction("database.row.create", {
      data: { title: "private task" },
      tableName: "tasks",
    }, { source: "api" })

    expect(result).toEqual({ ok: true, data: { id: 1 }, affected: 1 })
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Database mutation change notification failed.",
      expect.objectContaining({
        action: "database.row.create",
        dryRun: false,
        errorName: "Error",
        source: "api",
        table: "tasks",
      }),
    )
    const metadata = JSON.stringify(mocks.logger.warn.mock.calls[0]?.[1])
    expect(metadata).not.toContain("private task")
  })
})
