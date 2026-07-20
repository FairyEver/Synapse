import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DATABASE_OPERATION_LOG_LIST_DEFAULT_LIMIT,
  DATABASE_OPERATION_LOG_LIST_MAX_LIMIT,
  DATABASE_ROW_LIST_MAX_LIMIT,
} from "../../../database/shared/limits"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { dispatchDatabaseAction, setDatabaseChangeListener } from "../dispatcher"

const mocks = vi.hoisted(() => ({
  databaseService: {
    databaseLogList: vi.fn(),
    databaseRowList: vi.fn(),
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
    mocks.databaseService.databaseLogList.mockReturnValue([])
    mocks.databaseService.databaseRowList.mockReturnValue({ rows: [], total: 0 })
    mocks.databaseService.databaseRowCreate.mockReturnValue({ id: 1 })
  })

  afterEach(() => {
    setDatabaseChangeListener(null)
  })

  it("rejects non-numeric row list pagination before reaching sqlite", async () => {
    await expect(dispatchDatabaseAction("app.database.row.list", {
      tableName: "tasks",
      limit: "abc",
    })).rejects.toThrow("Missing or invalid 'limit': expected number")

    await expect(dispatchDatabaseAction("app.database.row.list", {
      tableName: "tasks",
      offset: Number.POSITIVE_INFINITY,
    })).rejects.toThrow("Missing or invalid 'offset': expected number")
  })

  it("rejects unsafe row list pagination bounds before reaching sqlite", async () => {
    await expect(dispatchDatabaseAction("app.database.row.list", {
      tableName: "tasks",
      limit: -1,
    })).rejects.toThrow("Invalid 'limit': expected non-negative integer")

    await expect(dispatchDatabaseAction("app.database.row.list", {
      tableName: "tasks",
      offset: -1,
    })).rejects.toThrow("Invalid 'offset': expected non-negative integer")

    await expect(dispatchDatabaseAction("app.database.row.list", {
      tableName: "tasks",
      limit: 1.5,
    })).rejects.toThrow("Invalid 'limit': expected non-negative integer")

    await expect(dispatchDatabaseAction("app.database.row.list", {
      tableName: "tasks",
      limit: DATABASE_ROW_LIST_MAX_LIMIT + 1,
    })).rejects.toThrow(`Invalid 'limit': expected integer between 0 and ${DATABASE_ROW_LIST_MAX_LIMIT}`)
  })

  it("bounds operation log list pagination before reaching sqlite", async () => {
    await expect(dispatchDatabaseAction("app.database.log.list", {
      limit: "abc",
    })).rejects.toThrow("Missing or invalid 'limit': expected number")

    await expect(dispatchDatabaseAction("app.database.log.list", {
      limit: -1,
    })).rejects.toThrow("Invalid 'limit': expected non-negative integer")

    await expect(dispatchDatabaseAction("app.database.log.list", {
      limit: 1.5,
    })).rejects.toThrow("Invalid 'limit': expected non-negative integer")

    await expect(dispatchDatabaseAction("app.database.log.list", {
      limit: DATABASE_OPERATION_LOG_LIST_MAX_LIMIT + 1,
    })).rejects.toThrow(`Invalid 'limit': expected integer between 0 and ${DATABASE_OPERATION_LOG_LIST_MAX_LIMIT}`)

    await dispatchDatabaseAction("app.database.log.list", {})
    expect(mocks.databaseService.databaseLogList).toHaveBeenLastCalledWith(DATABASE_OPERATION_LOG_LIST_DEFAULT_LIMIT)

    await dispatchDatabaseAction("app.database.log.list", {
      limit: DATABASE_OPERATION_LOG_LIST_MAX_LIMIT,
    })
    expect(mocks.databaseService.databaseLogList).toHaveBeenLastCalledWith(DATABASE_OPERATION_LOG_LIST_MAX_LIMIT)
  })

  it("warns without failing the mutation when operation log recording fails", async () => {
    mocks.databaseService.recordOperation.mockImplementationOnce(() => {
      throw new Error("token=sk-test-secret")
    })

    const result = await dispatchDatabaseAction("app.database.row.create", {
      data: { title: "private task" },
      tableName: "tasks",
    }, { source: "mcp-http" })

    expect(result).toEqual({ ok: true, data: { id: 1 }, affected: 1 })
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Database mutation operation log write failed.",
      expect.objectContaining({
        action: "app.database.row.create",
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

    const result = await dispatchDatabaseAction("app.database.row.create", {
      data: { title: "private task" },
      tableName: "tasks",
    }, { source: "api" })

    expect(result).toEqual({ ok: true, data: { id: 1 }, affected: 1 })
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Database mutation change notification failed.",
      expect.objectContaining({
        action: "app.database.row.create",
        dryRun: false,
        errorName: "Error",
        source: "api",
        table: "tasks",
      }),
    )
    const metadata = JSON.stringify(mocks.logger.warn.mock.calls[0]?.[1])
    expect(metadata).not.toContain("private task")
  })

  it("sanitizes external table names before permission checks and failed audits", async () => {
    const checkPermission = vi.fn(async () => ({ allowed: true as const }))
    const recordAudit = vi.fn((_event: Parameters<AuditSink["record"]>[0]) => undefined)
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(() => vi.fn()),
      check: checkPermission,
    }
    const auditSink: AuditSink = {
      record: recordAudit,
      list: vi.fn(() => []),
      clearForTests: vi.fn(),
    }
    const unsafeTableName = "tasks-token=secret-value-/Users/example/private"

    await expect(dispatchDatabaseAction("app.database.row.create", {
      tableName: unsafeTableName,
    }, { source: "mcp-http" }, { permissionGuard, auditSink }))
      .rejects.toThrow("Missing or invalid 'data': expected object")

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      resource: "database:app.database.row.create",
      context: expect.not.objectContaining({ table: unsafeTableName }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.mutate",
      outcome: "failed",
      resource: "database:app.database.row.create",
      metadata: expect.not.objectContaining({ table: unsafeTableName }),
    }))
    const serialized = JSON.stringify([
      checkPermission.mock.calls,
      recordAudit.mock.calls,
    ])
    expect(serialized).not.toContain("secret-value")
    expect(serialized).not.toContain("/Users/example/private")
  })

  it("authorizes and audits database read actions without recording result data", async () => {
    mocks.databaseService.databaseRowList.mockReturnValueOnce({
      rows: [{ id: 1, token: "sk-test-secret" }],
      total: 1,
    })
    const checkPermission = vi.fn(async () => ({ allowed: true as const }))
    const recordAudit = vi.fn((_event: Parameters<AuditSink["record"]>[0]) => undefined)
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(() => vi.fn()),
      check: checkPermission,
    }
    const auditSink: AuditSink = {
      record: recordAudit,
      list: vi.fn(() => []),
      clearForTests: vi.fn(),
    }

    const result = await dispatchDatabaseAction("app.database.row.list", {
      tableName: "tasks",
      limit: 10,
    }, { source: "mcp-http" }, { permissionGuard, auditSink })

    expect(result).toEqual({ ok: true, data: [{ id: 1, token: "sk-test-secret" }], total: 1 })
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.read",
      resource: "database:tasks",
      context: expect.objectContaining({
        databaseAction: "app.database.row.list",
        source: "mcp-http",
        table: "tasks",
      }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.read",
      outcome: "allowed",
      resource: "database:tasks",
      metadata: expect.objectContaining({
        databaseAction: "app.database.row.list",
        source: "mcp-http",
        table: "tasks",
      }),
    }))
    const serializedAudit = JSON.stringify(recordAudit.mock.calls)
    expect(serializedAudit).not.toContain("sk-test-secret")
  })

  it("denies database reads before calling the read handler", async () => {
    const checkPermission = vi.fn(async () => ({
      allowed: false as const,
      reason: "read denied",
      policyId: "database-read-test",
    }))
    const recordAudit = vi.fn((_event: Parameters<AuditSink["record"]>[0]) => undefined)
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(() => vi.fn()),
      check: checkPermission,
    }
    const auditSink: AuditSink = {
      record: recordAudit,
      list: vi.fn(() => []),
      clearForTests: vi.fn(),
    }

    await expect(dispatchDatabaseAction("app.database.log.list", {}, { source: "mcp-http" }, { permissionGuard, auditSink }))
      .rejects.toThrow("read denied")

    expect(mocks.databaseService.databaseLogList).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.read",
      outcome: "denied",
      resource: "database:app.database.log.list",
      metadata: expect.objectContaining({
        databaseAction: "app.database.log.list",
        policyId: "database-read-test",
        reason: "read denied",
        source: "mcp-http",
      }),
    }))
  })

  it("sanitizes database read permission checks and failed audits", async () => {
    const checkPermission = vi.fn(async () => ({ allowed: true as const }))
    const recordAudit = vi.fn((_event: Parameters<AuditSink["record"]>[0]) => undefined)
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(() => vi.fn()),
      check: checkPermission,
    }
    const auditSink: AuditSink = {
      record: recordAudit,
      list: vi.fn(() => []),
      clearForTests: vi.fn(),
    }
    const unsafeTableName = "tasks-token=secret-value-/Users/example/private"

    await expect(dispatchDatabaseAction("app.database.row.list", {
      tableName: unsafeTableName,
      limit: "abc",
    }, { source: "mcp-http" }, { permissionGuard, auditSink }))
      .rejects.toThrow("Missing or invalid 'limit': expected number")

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.read",
      resource: "database:app.database.row.list",
      context: expect.not.objectContaining({ table: unsafeTableName }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.read",
      outcome: "failed",
      resource: "database:app.database.row.list",
      metadata: expect.not.objectContaining({ table: unsafeTableName }),
    }))
    const serialized = JSON.stringify([
      checkPermission.mock.calls,
      recordAudit.mock.calls,
    ])
    expect(serialized).not.toContain("secret-value")
    expect(serialized).not.toContain("/Users/example/private")
  })
})
