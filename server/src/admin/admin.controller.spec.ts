import { afterEach, describe, expect, it, vi } from "vitest"
import { AdminController } from "./admin.controller"
import type { AdminService } from "./admin.service"
import { auditLogExportLimit, type AuditLogService } from "../common/audit-log.service"
import type { LiveDeviceService } from "../live/live-device.service"
import type { WebhookService } from "../webhooks/webhook.service"

function createController(
  service: Partial<AdminService>,
  auditLog: Partial<AuditLogService> = {},
  devices: Partial<LiveDeviceService> = {},
  webhooks: Partial<WebhookService> = {},
) {
  const ControllerCtor = AdminController as new (
    service: AdminService,
    auditLog: AuditLogService,
    devices: LiveDeviceService,
    webhooks: WebhookService,
  ) => AdminController
  return new ControllerCtor(
    service as AdminService,
    { record: vi.fn().mockResolvedValue(undefined), ...auditLog } as AuditLogService,
    devices as LiveDeviceService,
    webhooks as WebhookService,
  )
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
    const record = vi.fn().mockResolvedValue(undefined)
    const controller = createController({}, { list, record })

    await controller.listAuditLogs(
      {
        action: "admin.login",
        from: "2026-05-01",
        to: "2026-05-21",
      },
      { admin: { email: "admin@example.com" }, ip: "203.0.113.10" } as never,
    )

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
    expect(record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.audit_logs.list",
      targetType: "audit_log",
      targetId: "list",
      detail: {
        action: "admin.login",
        from: "2026-05-01",
        to: "2026-05-21",
      },
      ipAddress: "203.0.113.10",
    })
  })

  it("lists admin webhook delivery history and audits the read", async () => {
    const listDeliveryHistoryForAdmin = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
    const record = vi.fn().mockResolvedValue(undefined)
    const controller = createController({}, { record }, {}, { listDeliveryHistoryForAdmin } as never)

    await expect(controller.listWebhookDeliveries({
      page: "1",
      pageSize: "20",
      sortBy: "receivedAt",
      sortOrder: "desc",
      user: "user@example.com",
    }, { admin: { email: "admin@example.com" }, ip: "203.0.113.10" } as never))
      .resolves
      .toEqual({ data: [], total: 0, page: 1, pageSize: 20 })

    expect(listDeliveryHistoryForAdmin).toHaveBeenCalledWith({
      pagination: { page: 1, pageSize: 20, sortBy: "receivedAt", sortOrder: "desc" },
      filters: { user: "user@example.com" },
    })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.webhook_deliveries.list",
      targetType: "webhook_delivery",
      targetId: "list",
    }))
  })

  it("keeps admin read responses when audit writes fail", async () => {
    const result = { data: [], total: 0, page: 1, pageSize: 20 }
    const list = vi.fn().mockResolvedValue(result)
    const record = vi.fn().mockRejectedValue(new Error("audit database unavailable"))
    const controller = createController({}, { list, record })

    await expect(controller.listAuditLogs(
      {},
      { admin: { email: "admin@example.com" }, ip: "203.0.113.10" } as never,
    )).resolves.toEqual(result)

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.audit_logs.list",
      targetType: "audit_log",
      targetId: "list",
    }))
  })

  it("records audit logs for sensitive admin read endpoints", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
    const record = vi.fn().mockResolvedValue(undefined)
    const service = {
      getSystemOverview: vi.fn().mockResolvedValue({ counts: {} }),
      listInvitations: list,
      listUsers: list,
      listTeams: list,
      listModulePermissions: vi.fn().mockReturnValue([{ key: "module.database" }]),
      listUserModulePermissions: vi.fn().mockResolvedValue({ permissionKeys: ["module.database"] }),
    }
    const controller = createController(service as never, { record })
    const request = { admin: { email: "admin@example.com" }, ip: "203.0.113.11" } as never

    await controller.getSystemOverview(request)
    await controller.listInvitations({}, request)
    await controller.listUsers({}, request)
    await controller.listTeams({}, request)
    await controller.listModulePermissions(request)
    await controller.listUserModulePermissions("user-1", request)

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.system.view",
      targetType: "system",
      targetId: "overview",
      ipAddress: "203.0.113.11",
    }))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.invitations.list",
      targetType: "invitation",
      targetId: "list",
    }))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.users.list",
      targetType: "user",
      targetId: "list",
    }))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.teams.list",
      targetType: "team",
      targetId: "list",
    }))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.module_permissions.list",
      targetType: "module_permission",
      targetId: "list",
    }))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.user_module_permissions.list",
      targetType: "user",
      targetId: "user-1",
    }))
  })

  it("lists devices for administrators and records audit metadata", async () => {
    const listAdminDevices = vi.fn().mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 10 })
    const record = vi.fn().mockResolvedValue(undefined)
    const controller = createController({}, { record }, { listAdminDevices })

    await expect(controller.listDevices(
      { page: "2", pageSize: "10", sortBy: "lastSeenAt", sortOrder: "desc" },
      { admin: { email: "admin@example.com" }, ip: "203.0.113.10" } as never,
    )).resolves.toEqual({ data: [], total: 0, page: 2, pageSize: 10 })

    expect(listAdminDevices).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      sortBy: "lastSeenAt",
      sortOrder: "desc",
    })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.devices.list",
      targetType: "device",
      targetId: "list",
      detail: { page: 2, pageSize: 10 },
      ipAddress: "203.0.113.10",
    }))
  })

  it("keeps exported audit log responses when audit writes fail after send", async () => {
    const listForExport = vi.fn().mockResolvedValue([
      { id: "audit-1", adminEmail: "admin@example.com", action: "admin.login" },
    ])
    const record = vi.fn().mockRejectedValue(new Error("audit database unavailable"))
    const controller = createController({}, { listForExport, record })
    const response = {
      setHeader: vi.fn(),
      send: vi.fn(),
    }

    await expect(controller.exportAuditLogs(
      {},
      { admin: { email: "admin@example.com" }, ip: "203.0.113.12" } as never,
      response as never,
    )).resolves.toBeUndefined()

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("audit-1"))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.audit_logs.export",
      targetType: "audit_log",
      targetId: "export",
    }))
  })

  it("creates team invitations for administrators", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://app.example.com")
    const createInvitation = vi.fn().mockResolvedValue({
      id: "invite-1",
      inviteUrl: "https://app.example.com/dashboard/team-invite?token=token-1",
    })
    const controller = createController({ createInvitation } as never)
    const request = {
      admin: { id: "admin-1", email: "admin@example.com" },
      ip: "203.0.113.44",
    } as never

    await expect(controller.createInvitation({ teamId: "team-1" }, request))
      .resolves
      .toMatchObject({ id: "invite-1" })
    expect(createInvitation).toHaveBeenCalledWith(
      { teamId: "team-1" },
      { id: "admin-1", email: "admin@example.com" },
      "https://app.example.com",
      "203.0.113.44",
    )
  })

  it("rejects invalid team invitation creation fields", () => {
    const createInvitation = vi.fn()
    const controller = createController({ createInvitation } as never)

    expect(() => controller.createInvitation({ teamId: "" }, {} as never))
      .toThrow("邀请创建请求无效：teamId 至少 1 个字符")
    expect(createInvitation).not.toHaveBeenCalled()
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
      .toThrow("邀请 ID 无效：ids 至少选择 1 项")
  })

  it("rejects invalid user status", async () => {
    const controller = createController({ updateUserStatus: vi.fn() } as never)

    await expect(controller.updateUserStatus("user-1", { status: "bad" }))
      .rejects
      .toThrow("用户状态无效：status 必须是 active 或 disabled")
  })

  it("lists module permission definitions through the service", async () => {
    const listModulePermissions = vi.fn().mockReturnValue([{ key: "module.database" }])
    const controller = createController({ listModulePermissions } as never)

    await expect(controller.listModulePermissions()).resolves.toEqual([{ key: "module.database" }])
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
      .toThrow("用户模块权限无效：permissionKeys.0 模块权限不存在或已停用。")
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
      .toThrow("用户模块权限无效：permissionKeys.0 至少 1 个字符")
    expect(replaceUserModulePermissions).not.toHaveBeenCalled()
  })

  it("rejects extra fields in user module permission bodies", async () => {
    const replaceUserModulePermissions = vi.fn()
    const controller = createController({ replaceUserModulePermissions } as never)

    await expect(controller.replaceUserModulePermissions(
      "user-1",
      { permissionKeys: ["module.database"], roleIds: ["role-1"] },
      { admin: { id: "admin-1", email: "admin@example.com" } } as never,
    ))
      .rejects
      .toThrow("用户模块权限无效：包含不支持的字段：roleIds")
    expect(replaceUserModulePermissions).not.toHaveBeenCalled()
  })
})
