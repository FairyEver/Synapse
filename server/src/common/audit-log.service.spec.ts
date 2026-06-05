import { describe, expect, it, vi } from "vitest"
import { BadRequestException } from "@nestjs/common"
import type { PrismaService } from "../prisma/prisma.service"
import { AuditLogService, AuditLogWriteError } from "./audit-log.service"

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

  it("retries once and rejects when audit persistence keeps failing", async () => {
    const error = new Error("database unavailable")
    const prisma = {
      auditLog: { create: vi.fn().mockRejectedValue(error) },
    }
    const logger = { warn: vi.fn() }
    const service = new AuditLogService(prisma as unknown as PrismaService, logger as never)

    await expect(service.record(auditInput)).rejects.toThrow(AuditLogWriteError)

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenLastCalledWith({
      err: error,
      action: auditInput.action,
      targetType: auditInput.targetType,
      targetId: auditInput.targetId,
      adminEmail: auditInput.adminEmail,
      attempt: 2,
      maxAttempts: 2,
      recordFailureCount: 2,
    }, "Failed to record audit log")
    expect(service.getRecordFailureCount()).toBe(2)
  })

  it("succeeds when audit persistence recovers on retry", async () => {
    const error = new Error("database unavailable")
    const prisma = {
      auditLog: { create: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce({ id: "audit-1" }) },
    }
    const logger = { warn: vi.fn() }
    const service = new AuditLogService(prisma as unknown as PrismaService, logger as never)

    await expect(service.record(auditInput)).resolves.toBeUndefined()

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledWith({
      err: error,
      action: auditInput.action,
      targetType: auditInput.targetType,
      targetId: auditInput.targetId,
      adminEmail: auditInput.adminEmail,
      attempt: 1,
      maxAttempts: 2,
      recordFailureCount: 1,
    }, "Failed to record audit log")
    expect(service.getRecordFailureCount()).toBe(1)
  })

  it("increments audit record failure count for repeated persistence failures", async () => {
    const prisma = {
      auditLog: { create: vi.fn().mockRejectedValue(new Error("database unavailable")) },
    }
    const logger = { warn: vi.fn() }
    const service = new AuditLogService(prisma as unknown as PrismaService, logger as never)

    await expect(service.record(auditInput)).rejects.toThrow(AuditLogWriteError)
    await expect(service.record({ ...auditInput, action: "admin.team.update" })).rejects.toThrow(AuditLogWriteError)

    expect(service.getRecordFailureCount()).toBe(4)
    expect(logger.warn).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "admin.team.update",
      attempt: 2,
      recordFailureCount: 4,
    }), "Failed to record audit log")
  })

  it("lists audit logs for export without pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "audit-1" }])
    const prisma = {
      auditLog: { findMany },
    }
    const service = new AuditLogService(prisma as unknown as PrismaService)

    await expect(service.listForExport({
      action: "users.patch",
      from: "2026-05-01",
      to: "2026-05-21",
    })).resolves.toEqual([{ id: "audit-1" }])

    expect(findMany).toHaveBeenCalledWith({
      where: {
        action: "users.patch",
        createdAt: {
          gte: new Date(2026, 4, 1),
          lt: new Date(2026, 4, 22),
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50001,
    })
  })

  it("interprets date-only audit filters as local calendar days", async () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = "Asia/Shanghai"
    try {
      const findMany = vi.fn().mockResolvedValue([{ id: "audit-1" }])
      const prisma = {
        auditLog: { findMany },
      }
      const service = new AuditLogService(prisma as unknown as PrismaService)

      await service.listForExport({
        from: "2026-05-01",
        to: "2026-05-01",
      })

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          createdAt: {
            gte: new Date(2026, 4, 1),
            lt: new Date(2026, 4, 2),
          },
        },
      }))
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })

  it("rejects invalid audit log date filters before querying Prisma", async () => {
    const prisma = {
      auditLog: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      $transaction: vi.fn(),
    }
    const service = new AuditLogService(prisma as unknown as PrismaService)

    await expect(service.list({ from: "not-a-date", query: {} }))
      .rejects
      .toThrow(BadRequestException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
