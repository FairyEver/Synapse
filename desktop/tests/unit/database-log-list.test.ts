import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AuditSink, PermissionGuard } from "../../electron/runtime/security"
import { mcpClientActorForSource } from "../../synapse-capabilities/shared/types"

const electronMock = vi.hoisted(() => ({ app: { getPath: vi.fn() } }))

vi.mock("electron", () => electronMock)
vi.mock("../../electron/services/log-store", () => ({
  createMainLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

let tempDir = ""

describe("Database operation log", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const { databaseService } = await import("../../electron/database/service")
    databaseService.open()
    databaseService.databaseTableCreate("tasks", [{ name: "title", kind: "text" }])
  })

  afterEach(async () => {
    const { databaseService } = await import("../../electron/database/service")
    databaseService.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("records mutating dispatcher actions with source and affected count", async () => {
    const { dispatchDatabaseAction } = await import("../../electron/database/dispatcher")

    await dispatchDatabaseAction("app.database.row.create", { tableName: "tasks", data: { title: "Ship" } }, { source: "mcp-stdio" })

    const result = await dispatchDatabaseAction("app.database.log.list", { limit: 5 })
    expect(result.data).toEqual([
      expect.objectContaining({
        source: "mcp-stdio",
        action: "app.database.row.create",
        table: "tasks",
        affected: 1,
        dryRun: false,
      }),
    ])
  })

  it("checks permission and audits allowed database mutations", async () => {
    const { dispatchDatabaseAction } = await import("../../electron/database/dispatcher")
    const permissionGuard = permissionGuardMock({ allowed: true })
    const auditSink = auditSinkMock()

    await dispatchDatabaseAction(
      "app.database.row.create",
      { tableName: "tasks", data: { title: "Ship" } },
      { source: "mcp-http", actor: mcpClientActorForSource("mcp-http") },
      { permissionGuard, auditSink },
    )

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "database.mutate",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "database:tasks",
      context: {
        source: "mcp-http",
        databaseAction: "app.database.row.create",
        table: "tasks",
        dryRun: false,
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.mutate",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "database:tasks",
      outcome: "allowed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        databaseAction: "app.database.row.create",
        table: "tasks",
        dryRun: false,
      }),
    }))
  })

  it("denies database mutations before persistence", async () => {
    const { dispatchDatabaseAction } = await import("../../electron/database/dispatcher")
    const permissionGuard = permissionGuardMock({
      allowed: false,
      reason: "denied by policy",
      policyId: "test-policy",
    })
    const auditSink = auditSinkMock()

    await expect(dispatchDatabaseAction(
      "app.database.row.create",
      { tableName: "tasks", data: { title: "Blocked" } },
      { source: "mcp-stdio", actor: mcpClientActorForSource("mcp-stdio") },
      { permissionGuard, auditSink },
    )).rejects.toThrow("denied by policy")

    const rows = await dispatchDatabaseAction("app.database.row.list", { tableName: "tasks" })
    expect(rows.total).toBe(0)
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.mutate",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/stdio", display: "Synapse MCP stdio" },
      resource: "database:tasks",
      outcome: "denied",
      metadata: expect.objectContaining({
        reason: "denied by policy",
        policyId: "test-policy",
      }),
    }))
  })

  it("audits failed database mutations without raw error text", async () => {
    const { dispatchDatabaseAction } = await import("../../electron/database/dispatcher")
    const auditSink = auditSinkMock()

    await expect(dispatchDatabaseAction(
      "app.database.row.create",
      { tableName: "missing_table", data: { title: "secret row detail" } },
      { source: "api" },
      { permissionGuard: permissionGuardMock({ allowed: true }), auditSink },
    )).rejects.toThrow()

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.mutate",
      resource: "database:missing_table",
      outcome: "failed",
      metadata: expect.objectContaining({
        errorName: "Error",
      }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret row detail")
  })

  it("checks permission and audits read-only database actions", async () => {
    const { dispatchDatabaseAction } = await import("../../electron/database/dispatcher")
    const permissionGuard = permissionGuardMock({ allowed: true })
    const auditSink = auditSinkMock()

    await dispatchDatabaseAction(
      "app.database.row.list",
      { tableName: "tasks" },
      { source: "mcp-stdio" },
      { permissionGuard, auditSink },
    )

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "database.read",
      actor: { kind: "user", id: "database-dispatch:mcp-stdio" },
      resource: "database:tasks",
      context: {
        source: "mcp-stdio",
        databaseAction: "app.database.row.list",
        table: "tasks",
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.read",
      actor: { kind: "user", id: "database-dispatch:mcp-stdio" },
      resource: "database:tasks",
      outcome: "allowed",
      metadata: expect.objectContaining({
        source: "mcp-stdio",
        databaseAction: "app.database.row.list",
        table: "tasks",
      }),
    }))
  })
})

function permissionGuardMock(
  result: Awaited<ReturnType<PermissionGuard["check"]>>,
): PermissionGuard {
  return {
    registerPolicy: vi.fn(() => () => {}),
    check: vi.fn(async () => result),
  }
}

function auditSinkMock(): AuditSink {
  return {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
}
