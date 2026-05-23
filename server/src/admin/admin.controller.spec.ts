import { describe, expect, it, vi } from "vitest"
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

  it("lists permission definitions through the service", () => {
    const listPermissions = vi.fn().mockReturnValue([{ key: "database.use" }])
    const controller = createController({ listPermissions } as never)

    expect(controller.listPermissions()).toEqual([{ key: "database.use" }])
    expect(listPermissions).toHaveBeenCalledWith()
  })

  it("lists team entitlements through the service", async () => {
    const listTeamEntitlements = vi.fn().mockResolvedValue({ permissionKeys: ["database.use"] })
    const controller = createController({ listTeamEntitlements } as never)

    await expect(controller.listTeamEntitlements("team-1"))
      .resolves
      .toEqual({ permissionKeys: ["database.use"] })
    expect(listTeamEntitlements).toHaveBeenCalledWith("team-1")
  })

  it("replaces team entitlements through the service", async () => {
    const replaceTeamEntitlements = vi.fn().mockResolvedValue({ permissionKeys: ["database.use"] })
    const controller = createController({ replaceTeamEntitlements } as never)

    await expect(controller.replaceTeamEntitlements(
      "team-1",
      { permissionKeys: ["database.use"] },
      { admin: { id: "admin-1", email: "admin@example.com" }, ip: "203.0.113.70" } as never,
    ))
      .resolves
      .toEqual({ permissionKeys: ["database.use"] })
    expect(replaceTeamEntitlements).toHaveBeenCalledWith(
      "team-1",
      ["database.use"],
      { id: "admin-1", email: "admin@example.com" },
      "203.0.113.70",
    )
  })

  it("lists team access roles through the service", async () => {
    const listTeamAccessRoles = vi.fn().mockResolvedValue([{ id: "role-1", permissionKeys: ["database.use"] }])
    const controller = createController({ listTeamAccessRoles } as never)

    await expect(controller.listTeamAccessRoles("team-1"))
      .resolves
      .toEqual([{ id: "role-1", permissionKeys: ["database.use"] }])
    expect(listTeamAccessRoles).toHaveBeenCalledWith("team-1")
  })

  it("replaces role permissions through the service", async () => {
    const replaceRolePermissions = vi.fn().mockResolvedValue({ permissionKeys: ["database.use"] })
    const controller = createController({ replaceRolePermissions } as never)

    await expect(controller.replaceRolePermissions(
      "team-1",
      "role-1",
      { permissionKeys: ["database.use"] },
      { admin: { id: "admin-1", email: "admin@example.com" }, ip: "203.0.113.80" } as never,
    ))
      .resolves
      .toEqual({ permissionKeys: ["database.use"] })
    expect(replaceRolePermissions).toHaveBeenCalledWith(
      "team-1",
      "role-1",
      ["database.use"],
      { id: "admin-1", email: "admin@example.com" },
      "203.0.113.80",
    )
  })

  it("rejects invalid role permission bodies", async () => {
    const replaceRolePermissions = vi.fn()
    const controller = createController({ replaceRolePermissions } as never)

    await expect(controller.replaceRolePermissions(
      "team-1",
      "role-1",
      { permissionKeys: ["unknown.permission"] },
      { admin: { id: "admin-1", email: "admin@example.com" } } as never,
    ))
      .rejects
      .toThrow("角色权限无效。")
    expect(replaceRolePermissions).not.toHaveBeenCalled()
  })

  it("rejects invalid team entitlement bodies", async () => {
    const replaceTeamEntitlements = vi.fn()
    const controller = createController({ replaceTeamEntitlements } as never)

    await expect(controller.replaceTeamEntitlements(
      "team-1",
      { permissionKeys: [""] },
      { admin: { id: "admin-1", email: "admin@example.com" } } as never,
    ))
      .rejects
      .toThrow("团队权限无效。")
    expect(replaceTeamEntitlements).not.toHaveBeenCalled()
  })

  it("rejects unknown team entitlement permission keys", async () => {
    const replaceTeamEntitlements = vi.fn()
    const controller = createController({ replaceTeamEntitlements } as never)

    await expect(controller.replaceTeamEntitlements(
      "team-1",
      { permissionKeys: ["page.database"] },
      { admin: { id: "admin-1", email: "admin@example.com" } } as never,
    ))
      .rejects
      .toThrow("团队权限无效。")
    expect(replaceTeamEntitlements).not.toHaveBeenCalled()
  })

  it("rejects whitespace-only team entitlement permission keys", async () => {
    const replaceTeamEntitlements = vi.fn()
    const controller = createController({ replaceTeamEntitlements } as never)

    await expect(controller.replaceTeamEntitlements(
      "team-1",
      { permissionKeys: ["   "] },
      { admin: { id: "admin-1", email: "admin@example.com" } } as never,
    ))
      .rejects
      .toThrow("团队权限无效。")
    expect(replaceTeamEntitlements).not.toHaveBeenCalled()
  })
})
