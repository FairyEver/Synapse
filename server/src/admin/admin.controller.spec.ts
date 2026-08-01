import { afterEach, describe, expect, it, vi } from "vitest"
import { GUARDS_METADATA } from "@nestjs/common/constants"
import { AdminController } from "./admin.controller"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
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

  it("keeps admin routes behind the admin auth guard", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toContain(AdminAuthGuard)
  })

  it("does not expose retired team or invitation handlers", () => {
    const prototype = AdminController.prototype as unknown as Record<string, unknown>

    for (const handler of [
      "listTeams",
      "listInvitations",
      "createInvitation",
      "deleteInvitation",
      "deleteInvitations",
    ]) {
      expect(prototype).not.toHaveProperty(handler)
    }
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
      listUsers: list,
    }
    const controller = createController(service as never, { record })
    const request = { admin: { email: "admin@example.com" }, ip: "203.0.113.11" } as never

    await controller.getSystemOverview(request)
    await controller.listUsers({}, request)

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.system.view",
      targetType: "system",
      targetId: "overview",
      ipAddress: "203.0.113.11",
    }))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.users.list",
      targetType: "user",
      targetId: "list",
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

  it("lists skill repositories for administrators and records audit metadata", async () => {
    const listSkillRepositories = vi.fn().mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 10 })
    const record = vi.fn().mockResolvedValue(undefined)
    const controller = createController({ listSkillRepositories } as never, { record })

    await expect(controller.listSkillRepositories(
      { page: "2", pageSize: "10", sortBy: "updatedAt", sortOrder: "desc", status: "removed", query: " demo " },
      { admin: { email: "admin@example.com" }, ip: "203.0.113.77" } as never,
    )).resolves.toEqual({ data: [], total: 0, page: 2, pageSize: 10 })

    expect(listSkillRepositories).toHaveBeenCalledWith(
      { page: 2, pageSize: 10, sortBy: "updatedAt", sortOrder: "desc" },
      { status: "removed", query: "demo" },
    )
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.skill_repositories.list",
      targetType: "skill_repository",
      targetId: "list",
      detail: { page: 2, pageSize: 10, status: "removed", query: "demo" },
      ipAddress: "203.0.113.77",
    }))
  })

  it("defaults admin skill repository lists to active status", async () => {
    const listSkillRepositories = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
    const controller = createController({ listSkillRepositories } as never)

    await controller.listSkillRepositories({ status: "bad" }, {} as never)

    expect(listSkillRepositories).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 }),
      { status: "active", query: undefined },
    )
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

  it("answers audit export HEAD checks without exporting or writing audit logs", () => {
    const listForExport = vi.fn()
    const record = vi.fn()
    const controller = createController({}, { listForExport, record })
    const response = {
      end: vi.fn(),
      setHeader: vi.fn(),
    }

    controller.checkExportAuditLogs(response as never)

    expect(listForExport).not.toHaveBeenCalled()
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8")
    expect(response.setHeader).toHaveBeenCalledWith("Content-Disposition", "attachment; filename=audit-logs.csv")
    expect(response.end).toHaveBeenCalledOnce()
    expect(record).not.toHaveBeenCalled()
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
  it("marks skill repositories removed through the service", async () => {
    const setSkillRepositoryRemoved = vi.fn().mockResolvedValue({ id: "repo-1", status: "removed" })
    const controller = createController({ setSkillRepositoryRemoved } as never)

    await expect(controller.setSkillRepositoryRemoved(
      "repo-1",
      { admin: { email: "admin@example.com" }, ip: "203.0.113.78" } as never,
    )).resolves.toEqual({ id: "repo-1", status: "removed" })

    expect(setSkillRepositoryRemoved).toHaveBeenCalledWith("repo-1", true, "admin@example.com", "203.0.113.78")
  })

  it("restores skill repositories through the service", async () => {
    const setSkillRepositoryRemoved = vi.fn().mockResolvedValue({ id: "repo-1", status: "active" })
    const controller = createController({ setSkillRepositoryRemoved } as never)

    await expect(controller.restoreSkillRepository(
      "repo-1",
      { admin: { email: "admin@example.com" }, ip: "203.0.113.79" } as never,
    )).resolves.toEqual({ id: "repo-1", status: "active" })

    expect(setSkillRepositoryRemoved).toHaveBeenCalledWith("repo-1", false, "admin@example.com", "203.0.113.79")
  })
  it("rejects invalid user status", async () => {
    const controller = createController({ updateUserStatus: vi.fn() } as never)

    await expect(controller.updateUserStatus("user-1", { status: "bad" }))
      .rejects
      .toThrow("用户状态无效：status 必须是 active 或 disabled")
  })

  it("rejects oversized admin user notes", async () => {
    const updateUserAdminNote = vi.fn()
    const controller = createController({ updateUserAdminNote } as never)

    await expect(controller.updateUserAdminNote("user-1", { adminNote: "a".repeat(501) }))
      .rejects
      .toThrow("管理员备注无效：adminNote 最多 500 个字符")
    expect(updateUserAdminNote).not.toHaveBeenCalled()
  })

})
