import { afterEach, describe, expect, it, vi } from "vitest"
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
  readonly activeUsers?: number
  readonly disabledUsers?: number
  readonly pendingInvitations?: number
  readonly usedInvitations?: number
  readonly expiredInvitations?: number
  readonly recentUsers?: Array<{ createdAt: Date }>
  readonly recentTeams?: Array<{ createdAt: Date }>
  readonly recentInvitations?: Array<{ createdAt: Date }>
  readonly recentAuditLogs?: Array<{ createdAt: Date }>
} = {}) {
  const prisma = {
    $executeRaw: vi.fn(),
    $transaction: vi.fn((input: unknown) => {
      if (typeof input === "function") return input(prisma)
      return Promise.resolve([
        counts.auditLogs ?? 0,
        counts.users ?? 0,
        counts.teams ?? 0,
        counts.invitations ?? 0,
        counts.activeUsers ?? 0,
        counts.disabledUsers ?? 0,
        counts.pendingInvitations ?? 0,
        counts.usedInvitations ?? 0,
        counts.expiredInvitations ?? 0,
        counts.recentUsers ?? [],
        counts.recentTeams ?? [],
        counts.recentInvitations ?? [],
        counts.recentAuditLogs ?? [],
      ])
    }),
    auditLog: { count: vi.fn(), findMany: vi.fn() },
    user: {
      count: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ status: "active" }),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    teamMembership: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    team: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ id: "team-1" }),
    },
    invitation: { count: vi.fn(), create: vi.fn(), findMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  }
  return prisma
}

describe("AdminService", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns retained system overview counts", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-21T12:00:00.000Z"))
    const prisma = createPrismaMock({
      auditLogs: 2,
      users: 3,
      teams: 1,
      invitations: 4,
      activeUsers: 2,
      disabledUsers: 1,
      pendingInvitations: 1,
      usedInvitations: 2,
      expiredInvitations: 1,
      recentUsers: [{ createdAt: new Date("2026-05-21T08:00:00.000Z") }],
      recentTeams: [{ createdAt: new Date("2026-05-20T08:00:00.000Z") }],
      recentInvitations: [{ createdAt: new Date("2026-05-19T08:00:00.000Z") }],
      recentAuditLogs: [{ createdAt: new Date("2026-05-21T08:00:00.000Z") }],
    })
    const service = new AdminService(prisma as unknown as PrismaService)

    const result = await service.getSystemOverview()

    expect(result.counts).toEqual({
      auditLogs: 2,
      users: 3,
      teams: 1,
      invitations: 4,
    })
    expect(result.userStatus).toEqual({ active: 2, disabled: 1 })
    expect(result.invitationStatus).toEqual({ pending: 1, used: 2, expired: 1 })
    expect(result.dailyTrend).toHaveLength(7)
    expect(result.dailyTrend.at(-1)).toMatchObject({
      date: "2026-05-21",
      users: 1,
      auditLogs: 1,
    })
    expect(prisma.invitation.count).toHaveBeenCalledWith()
  })

  it("loads users without exposing password hashes", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService)

    await service.listUsers()

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        id: true,
        email: true,
        status: true,
        memberships: {
          select: {
            id: true,
            role: true,
            createdAt: true,
            team: { select: { id: true, name: true } },
          },
        },
        createdAt: true,
        updatedAt: true,
      }),
    }))
    expect(prisma.user.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("passwordHash")
    expect(prisma.user.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("modulePermissions")
  })

  it("disables a user without returning the password hash", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService)

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
            id: true,
            role: true,
            createdAt: true,
            team: { select: { id: true, name: true } },
          },
        },
        createdAt: true,
        updatedAt: true,
      }),
    }))
    expect(prisma.user.update.mock.calls[0]?.[0].select).not.toHaveProperty("passwordHash")
    expect(prisma.user.update.mock.calls[0]?.[0].select).not.toHaveProperty("modulePermissions")
  })

  it("disconnects active Live sockets after disabling a user", async () => {
    const prisma = createPrismaMock()
    const liveGateway = { disconnectUser: vi.fn() }
    const service = new AdminService(
      prisma as unknown as PrismaService,
      undefined,
      liveGateway as never,
    )

    await service.updateUserStatus("user-1", { status: "disabled" })

    expect(liveGateway.disconnectUser).toHaveBeenCalledWith("user-1")
  })

  it("does not disconnect Live sockets when enabling a user", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({ status: "disabled" })
    const liveGateway = { disconnectUser: vi.fn() }
    const service = new AdminService(
      prisma as unknown as PrismaService,
      undefined,
      liveGateway as never,
    )

    await service.updateUserStatus("user-1", { status: "active" })

    expect(liveGateway.disconnectUser).not.toHaveBeenCalled()
  })

  it("reports a missing user when updating status", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    prisma.user.update.mockRejectedValue(createNotFoundError())
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.updateUserStatus("missing-user", { status: "disabled" }))
      .rejects
      .toThrow("用户不存在。")
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("rejects disabling the only active owner of a team", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findMany.mockResolvedValue([{ teamId: "team-1" }])
    prisma.teamMembership.findFirst.mockResolvedValue(null)
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.updateUserStatus("user-1", { status: "disabled" }))
      .rejects
      .toThrow("不能停用团队唯一所有者。")

    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("locks owner teams before disabling a user", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findMany.mockResolvedValue([{ teamId: "team-1" }])
    prisma.teamMembership.findFirst.mockResolvedValue({ id: "membership-2" })
    const service = new AdminService(prisma as unknown as PrismaService)

    await service.updateUserStatus("user-1", { status: "disabled" })

    expect(prisma.teamMembership.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", role: "owner" },
      select: { teamId: true },
      orderBy: { teamId: "asc" },
    })
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.teamMembership.findFirst).toHaveBeenCalledWith({
      where: {
        teamId: "team-1",
        userId: { not: "user-1" },
        role: "owner",
        user: { status: "active" },
      },
      select: { id: true },
    })
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.user.update.mock.invocationCallOrder[0])
  })

  it("loads teams without exposing internal membership scalar fields", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService)

    await service.listTeams()

    expect(prisma.team.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        id: true,
        name: true,
        createdByUser: { select: { email: true } },
        memberships: {
          select: {
            id: true,
            role: true,
            createdAt: true,
            user: { select: { email: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        createdAt: true,
        updatedAt: true,
      }),
    }))
    expect(prisma.team.findMany.mock.calls[0]?.[0]).not.toHaveProperty("include")
  })

  it("loads invitations without exposing token hashes", async () => {
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([[], 0]),
      invitation: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
    }
    const service = new AdminService(prisma as unknown as PrismaService)

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

  it("creates admin team invitations and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.create.mockResolvedValue({
      id: "invite-1",
      inviteUrl: "https://app.example.com/console/team-invite?token=token-1",
      expiresAt: new Date("2026-06-08T00:00:00.000Z"),
    })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.createInvitation(
      { teamId: "team-1" },
      { id: "admin-1", email: "admin@example.com" },
      "https://app.example.com",
      "203.0.113.44",
    )).resolves.toMatchObject({
      id: "invite-1",
      inviteUrl: expect.stringMatching(/^https:\/\/app\.example\.com\/console\/team-invite\?token=.+/),
    })
    expect(prisma.team.findUnique).toHaveBeenCalledWith({
      where: { id: "team-1" },
      select: { id: true },
    })
    expect(prisma.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "team_join",
        createdByAdminId: "admin-1",
        teamId: "team-1",
      }),
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.invitation.create",
      targetType: "invitation",
      targetId: "invite-1",
      detail: { teamId: "team-1" },
      ipAddress: "203.0.113.44",
    })
  })

  it("deletes an invitation and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.delete.mockResolvedValue({ id: "invite-1" })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

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
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.deleteInvitation("missing-invite", "admin@example.com", "203.0.113.50"))
      .rejects
      .toThrow("邀请不存在。")
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("deletes invitations in bulk and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.deleteMany.mockResolvedValue({ count: 2 })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.deleteInvitations(["invite-1", "invite-2"], "admin@example.com", "203.0.113.30"))
      .resolves
      .toEqual({ ok: true, count: 2 })

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.invitation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["invite-1", "invite-2"] } },
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.invitation.delete_many",
      targetType: "invitation",
      targetId: "batch:2",
      detail: { ids: ["invite-1", "invite-2"], count: 2 },
      ipAddress: "203.0.113.30",
    })
  })

  it("returns successful invitation mutations when service-managed audit writes fail", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.create.mockResolvedValue({
      id: "invite-1",
      inviteUrl: "https://app.example.com/console/team-invite?token=token-1",
      expiresAt: new Date("2026-06-08T00:00:00.000Z"),
    })
    prisma.invitation.delete.mockResolvedValue({ id: "invite-1" })
    prisma.invitation.deleteMany.mockResolvedValue({ count: 2 })
    const auditLog = { record: vi.fn().mockRejectedValue(new Error("audit unavailable")) }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.createInvitation(
      { teamId: "team-1" },
      { id: "admin-1", email: "admin@example.com" },
      "https://app.example.com",
      "203.0.113.44",
    )).resolves.toMatchObject({ id: "invite-1" })
    await expect(service.deleteInvitation("invite-1", "admin@example.com", "203.0.113.20"))
      .resolves
      .toEqual({ ok: true })
    await expect(service.deleteInvitations(["invite-1", "invite-2"], "admin@example.com", "203.0.113.30"))
      .resolves
      .toEqual({ ok: true, count: 2 })
    expect(auditLog.record).toHaveBeenCalledTimes(3)
  })

  it("rejects bulk invitation deletes when any id does not exist", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.deleteMany.mockResolvedValue({ count: 1 })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.deleteInvitations(["invite-1", "missing-invite"], "admin@example.com", "203.0.113.31"))
      .rejects
      .toThrow("邀请不存在。")

    expect(prisma.invitation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["invite-1", "missing-invite"] } },
    })
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("records user status update audit logs with the request IP", async () => {
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

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

  it("returns the updated user when status update audit writes fail", async () => {
    const prisma = createPrismaMock()
    prisma.user.update.mockResolvedValue({ id: "user-1", status: "disabled" })
    const auditLog = { record: vi.fn().mockRejectedValue(new Error("audit unavailable")) }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.updateUserStatus("user-1", { status: "disabled" }, "admin@example.com", "203.0.113.40"))
      .resolves
      .toEqual({ id: "user-1", status: "disabled" })
    expect(prisma.user.update).toHaveBeenCalled()
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
