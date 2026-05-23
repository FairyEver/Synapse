import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { AuditLogService } from "./audit-log.service"

const auditInput = {
  adminEmail: "admin@example.com",
  action: "admin.user.status_update",
  targetType: "user",
  targetId: "user-1",
  detail: { status: "disabled" },
  ipAddress: "127.0.0.1",
}

describe("AuditLogService", () => {
  it("records audit logs", async () => {
    const prisma = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    }
    const logger = { warn: vi.fn() }
    const service = new AuditLogService(prisma as unknown as PrismaService, logger as never)

    await service.record(auditInput)

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: auditInput,
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("does not reject business operations when audit persistence fails", async () => {
    const error = new Error("database unavailable")
    const prisma = {
      auditLog: { create: vi.fn().mockRejectedValue(error) },
    }
    const logger = { warn: vi.fn() }
    const service = new AuditLogService(prisma as unknown as PrismaService, logger as never)

    await expect(service.record(auditInput)).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith({
      err: error,
      action: auditInput.action,
      targetType: auditInput.targetType,
      targetId: auditInput.targetId,
      adminEmail: auditInput.adminEmail,
    }, "Failed to record audit log")
  })
})
