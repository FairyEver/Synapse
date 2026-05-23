import { describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService } from "./admin.service"

function createNotFoundError() {
  return new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
    clientVersion: "6.0.0",
  })
}

function createPrismaMock(counts: {
  readonly auditLogs?: number
  readonly users?: number
  readonly teams?: number
  readonly invitations?: number
} = {}) {
  return {
    $transaction: vi.fn().mockResolvedValue([
      counts.auditLogs ?? 0,
      counts.users ?? 0,
      counts.teams ?? 0,
      counts.invitations ?? 0,
    ]),
    auditLog: { count: vi.fn() },
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    team: { count: vi.fn() },
    invitation: { count: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  }
}

describe("AdminService", () => {
  it("returns retained system overview counts", async () => {
    const prisma = createPrismaMock({ auditLogs: 2, users: 3, teams: 1, invitations: 4 })
    const service = new AdminService(
      prisma as unknown as PrismaService,
      {} as never,
    )

    const result = await service.getSystemOverview()

    expect(result.counts).toEqual({ auditLogs: 2, users: 3, teams: 1, invitations: 4 })
    expect(prisma.invitation.count).toHaveBeenCalledWith()
  })

  it("loads users without exposing password hashes", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService, {} as never)

    await service.listUsers()

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        id: true,
        email: true,
        status: true,
        memberships: {
          select: {
            role: true,
            team: { select: { id: true, name: true } },
          },
        },
        createdAt: true,
      }),
    }))
    expect(prisma.user.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("passwordHash")
  })

  it("disables a user without returning the password hash", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService, {} as never)

    await service.updateUserStatus("user-1", { status: "disabled" })

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1" },
      data: { status: "disabled" },
      select: expect.objectContaining({
        id: true,
        email: true,
        status: true,
        memberships: {
          select: {
            role: true,
            team: { select: { id: true, name: true } },
          },
        },
        createdAt: true,
      }),
    }))
    expect(prisma.user.update.mock.calls[0]?.[0].select).not.toHaveProperty("passwordHash")
  })

  it("reports a missing user when updating status", async () => {
    const prisma = createPrismaMock()
    prisma.user.update.mockRejectedValue(createNotFoundError())
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, auditLog as never)

    await expect(service.updateUserStatus("missing-user", { status: "disabled" }))
      .rejects
      .toThrow("用户不存在。")
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("loads invitations without exposing token hashes", async () => {
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([[], 0]),
      invitation: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
    }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never)

    await service.listInvitations()

    expect(prisma.invitation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: {
        id: true,
        type: true,
        inviteUrl: true,
        expiresAt: true,
        usedAt: true,
        acceptedByUser: { select: { email: true } },
        createdByAdmin: { select: { email: true } },
        createdByUser: { select: { email: true } },
        createdAt: true,
        team: { select: { name: true } },
      },
    }))
    expect(prisma.invitation.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("tokenHash")
    expect(prisma.invitation.count).toHaveBeenCalledWith()
  })

  it("deletes an invitation and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.delete.mockResolvedValue({ id: "invite-1" })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, auditLog as never)

    await service.deleteInvitation("invite-1", "admin@example.com", "203.0.113.20")

    expect(prisma.invitation.delete).toHaveBeenCalledWith({ where: { id: "invite-1" } })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.invitation.delete",
      targetType: "invitation",
      targetId: "invite-1",
      ipAddress: "203.0.113.20",
    })
  })

  it("records missing invitation delete attempts", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.delete.mockRejectedValue(createNotFoundError())
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, auditLog as never)

    await expect(service.deleteInvitation("missing-invite", "admin@example.com", "203.0.113.50"))
      .rejects
      .toThrow("邀请不存在。")
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.invitation.delete.not_found",
      targetType: "invitation",
      targetId: "missing-invite",
      ipAddress: "203.0.113.50",
    })
  })

  it("deletes invitations in bulk and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.deleteMany.mockResolvedValue({ count: 2 })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, auditLog as never)

    await expect(service.deleteInvitations(["invite-1", "invite-2"], "admin@example.com", "203.0.113.30"))
      .resolves
      .toEqual({ ok: true, count: 2 })

    expect(prisma.invitation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["invite-1", "invite-2"] } },
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.invitation.delete_many",
      targetType: "invitation",
      targetId: "invite-1,invite-2",
      detail: { ids: ["invite-1", "invite-2"], count: 2 },
      ipAddress: "203.0.113.30",
    })
  })

  it("records user status update audit logs with the request IP", async () => {
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, auditLog as never)

    await service.updateUserStatus("user-1", { status: "disabled" }, "admin@example.com", "203.0.113.40")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.user.status_update",
      targetType: "user",
      targetId: "user-1",
      detail: { status: "disabled" },
      ipAddress: "203.0.113.40",
    })
  })
})
