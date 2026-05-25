import { afterEach, describe, expect, it, vi } from "vitest"
import { AdminController } from "./admin.controller"
import type { AdminService } from "./admin.service"
import { auditLogExportLimit, type AuditLogService } from "../common/audit-log.service"

function createController(
  service: Partial<AdminService>,
  auditLog: Partial<AuditLogService> = {},
) {
  return new AdminController(service as AdminService, auditLog as AuditLogService)
}

describe("AdminController", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns system overview from the service", async () => {
    const getSystemOverview = vi.fn().mockResolvedValue({
      serverTime: "2026-05-21T00:00:00.000Z",
      counts: { auditLogs: 3 },
    })
    const controller = createController({ getSystemOverview })

    await expect(controller.getSystemOverview()).resolves.toMatchObject({
      counts: { auditLogs: 3 },
    })
  })

  it("passes audit log filters to the audit service", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
    const controller = createController({}, { list })

    await controller.listAuditLogs({
      action: "admin.login",
      from: "2026-05-01",
      to: "2026-05-21",
    })

    expect(list).toHaveBeenCalledWith({
      action: "admin.login",
      from: "2026-05-01",
      to: "2026-05-21",
      query: {
        action: "admin.login",
        from: "2026-05-01",
        to: "2026-05-21",
      },
    })
  })

  it("exports audit logs without list pagination", async () => {
    const listForExport = vi.fn().mockResolvedValue([
      {
        id: "audit-1",
        adminEmail: "admin@example.com",
        action: "users.patch",
        targetType: "user",
        targetId: "user-1",
        detail: { status: "disabled" },
        ipAddress: "127.0.0.1",
        createdAt: "2026-05-22T00:00:00.000Z",
      },
    ])
    const record = vi.fn().mockResolvedValue(undefined)
    const response = {
      setHeader: vi.fn(),
      send: vi.fn(),
    }
    const controller = createController({}, { listForExport, record })

    await controller.exportAuditLogs(
      {
        action: "users.patch",
        from: "2026-05-01",
        to: "2026-05-21",
      },
      {
        admin: { email: "admin@example.com" },
        ip: "203.0.113.10",
      } as never,
      response as never,
    )

    expect(listForExport).toHaveBeenCalledWith({
      action: "users.patch",
      from: "2026-05-01",
      to: "2026-05-21",
    })
    expect(record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.audit_logs.export",
      targetType: "audit_log",
      targetId: "export",
      detail: {
        filters: {
          action: "users.patch",
          from: "2026-05-01",
          to: "2026-05-21",
        },
        count: 1,
      },
      ipAddress: "203.0.113.10",
    })
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("detail"))
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining(`""status"":""disabled""`))
    expect(response.send.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0])
  })

  it("does not record audit log exports when sending the csv fails", async () => {
    const listForExport = vi.fn().mockResolvedValue([
      {
        id: "audit-1",
        adminEmail: "admin@example.com",
        action: "users.patch",
        targetType: "user",
        targetId: "user-1",
        detail: { status: "disabled" },
        ipAddress: "127.0.0.1",
        createdAt: "2026-05-22T00:00:00.000Z",
      },
    ])
    const record = vi.fn().mockResolvedValue(undefined)
    const response = {
      setHeader: vi.fn(),
      send: vi.fn(() => {
        throw new Error("send failed")
      }),
    }
    const controller = createController({}, { listForExport, record })

    await expect(controller.exportAuditLogs(
      {},
      { admin: { email: "admin@example.com" } } as never,
      response as never,
    ))
      .rejects
      .toThrow("send failed")
    expect(record).not.toHaveBeenCalled()
  })

  it("does not pass page size overrides to audit log export", async () => {
    const listForExport = vi.fn().mockResolvedValue([])
    const record = vi.fn().mockResolvedValue(undefined)
    const response = {
      setHeader: vi.fn(),
      send: vi.fn(),
    }
    const controller = createController({}, { listForExport, record })

    await controller.exportAuditLogs({ pageSize: "10000" }, { admin: { email: "admin@example.com" } } as never, response as never)

    expect(listForExport).toHaveBeenCalledWith({
      action: undefined,
      from: undefined,
      to: undefined,
    })
  })

  it("rejects audit log exports over the export limit", async () => {
    const listForExport = vi.fn().mockResolvedValue(Array.from(
      { length: auditLogExportLimit + 1 },
      (_, index) => ({ id: `audit-${index}` }),
    ))
    const response = {
      setHeader: vi.fn(),
      send: vi.fn(),
    }
    const controller = createController({}, { listForExport })

    await expect(controller.exportAuditLogs({}, { admin: { email: "admin@example.com" } } as never, response as never))
      .rejects
      .toThrow(`导出记录超过 ${auditLogExportLimit} 条，请缩小时间范围。`)
    expect(response.send).not.toHaveBeenCalled()
  })

  it("creates signup invitations through the service", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "")
    const createSignupInvitation = vi.fn().mockResolvedValue({ token: "plain-token" })
    const controller = createController({ createSignupInvitation } as never)

    await expect(controller.createSignupInvitation({
      admin: { id: "admin-1", email: "admin@example.com" },
      ip: "203.0.113.10",
      headers: { host: "app.example.com" },
      protocol: "https",
      get: (name: string) => name.toLowerCase() === "host" ? "app.example.com" : undefined,
    } as never))
      .resolves
      .toEqual({ token: "plain-token" })
    expect(createSignupInvitation).toHaveBeenCalledWith(
      { id: "admin-1", email: "admin@example.com" },
      "https://app.example.com",
      "203.0.113.10",
    )
  })

  it("deletes invitations through the service", async () => {
    const deleteInvitation = vi.fn().mockResolvedValue({ ok: true })
    const controller = createController({ deleteInvitation } as never)

    await expect(controller.deleteInvitation("invite-1", {
      admin: { id: "admin-1", email: "admin@example.com" },
      ip: "203.0.113.20",
    } as never))
      .resolves
      .toEqual({ ok: true })
    expect(deleteInvitation).toHaveBeenCalledWith("invite-1", "admin@example.com", "203.0.113.20")
  })

  it("deletes invitations in bulk through the service", async () => {
    const deleteInvitations = vi.fn().mockResolvedValue({ ok: true, count: 2 })
    const controller = createController({ deleteInvitations } as never)

    await expect(controller.deleteInvitations(
      { ids: ["invite-1", "invite-2"] },
      { admin: { id: "admin-1", email: "admin@example.com" }, ip: "203.0.113.30" } as never,
    ))
      .resolves
      .toEqual({ ok: true, count: 2 })
    expect(deleteInvitations).toHaveBeenCalledWith(["invite-1", "invite-2"], "admin@example.com", "203.0.113.30")
  })

  it("rejects empty bulk invitation deletion", async () => {
    const controller = createController({ deleteInvitations: vi.fn() } as never)

    expect(() => controller.deleteInvitations({ ids: [] }, {} as never))
      .toThrow("邀请 ID 无效。")
  })

  it("rejects invalid user status", async () => {
    const controller = createController({ updateUserStatus: vi.fn() } as never)

    await expect(controller.updateUserStatus("user-1", { status: "bad" }))
      .rejects
      .toThrow("用户状态无效。")
  })

  it("lists module permission definitions through the service", () => {
    const listModulePermissions = vi.fn().mockReturnValue([{ key: "module.database" }])
    const controller = createController({ listModulePermissions } as never)

    expect(controller.listModulePermissions()).toEqual([{ key: "module.database" }])
    expect(listModulePermissions).toHaveBeenCalledWith()
  })

  it("lists user module permissions through the service", async () => {
    const listUserModulePermissions = vi.fn().mockResolvedValue({ permissionKeys: ["module.database"] })
    const controller = createController({ listUserModulePermissions } as never)

    await expect(controller.listUserModulePermissions("user-1"))
      .resolves
      .toEqual({ permissionKeys: ["module.database"] })
    expect(listUserModulePermissions).toHaveBeenCalledWith("user-1")
  })

  it("replaces user module permissions through the service", async () => {
    const replaceUserModulePermissions = vi.fn().mockResolvedValue({ permissionKeys: ["module.database"] })
    const controller = createController({ replaceUserModulePermissions } as never)

    await expect(controller.replaceUserModulePermissions(
      "user-1",
      { permissionKeys: ["module.database"] },
      { admin: { id: "admin-1", email: "admin@example.com" }, ip: "203.0.113.75" } as never,
    ))
      .resolves
      .toEqual({ permissionKeys: ["module.database"] })
    expect(replaceUserModulePermissions).toHaveBeenCalledWith(
      "user-1",
      ["module.database"],
      { id: "admin-1", email: "admin@example.com" },
      "203.0.113.75",
    )
  })

  it("allows empty user module permission replacements", async () => {
    const replaceUserModulePermissions = vi.fn().mockResolvedValue({ permissionKeys: [] })
    const controller = createController({ replaceUserModulePermissions } as never)

    await expect(controller.replaceUserModulePermissions(
      "user-1",
      { permissionKeys: [] },
      { admin: { id: "admin-1", email: "admin@example.com" } } as never,
    ))
      .resolves
      .toEqual({ permissionKeys: [] })
    expect(replaceUserModulePermissions).toHaveBeenCalledWith(
      "user-1",
      [],
      { id: "admin-1", email: "admin@example.com" },
      undefined,
    )
  })

  it("rejects invalid user module permission bodies", async () => {
    const replaceUserModulePermissions = vi.fn()
    const controller = createController({ replaceUserModulePermissions } as never)

    await expect(controller.replaceUserModulePermissions(
      "user-1",
      { permissionKeys: ["database.use"] },
      { admin: { id: "admin-1", email: "admin@example.com" } } as never,
    ))
      .rejects
      .toThrow("用户模块权限无效。")
    expect(replaceUserModulePermissions).not.toHaveBeenCalled()
  })

  it("rejects whitespace-only user module permission keys", async () => {
    const replaceUserModulePermissions = vi.fn()
    const controller = createController({ replaceUserModulePermissions } as never)

    await expect(controller.replaceUserModulePermissions(
      "user-1",
      { permissionKeys: ["   "] },
      { admin: { id: "admin-1", email: "admin@example.com" } } as never,
    ))
      .rejects
      .toThrow("用户模块权限无效。")
    expect(replaceUserModulePermissions).not.toHaveBeenCalled()
  })
})
