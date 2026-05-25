import { describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService } from "./admin.service"

function createPermissionsMock() {
  return {
    listModulePermissionDefinitions: vi.fn().mockReturnValue([{ key: "module.database" }]),
    listUserModulePermissions: vi.fn().mockResolvedValue(["module.database"]),
    replaceUserModulePermissions: vi.fn().mockResolvedValue({
      before: ["module.skill"],
      after: ["module.database"],
    }),
  }
}

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
  readonly userModulePermissions?: number
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
        counts.userModulePermissions ?? 0,
      ])
    }),
    auditLog: { count: vi.fn() },
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
    userModulePermission: { count: vi.fn() },
    invitation: { count: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  }
  return prisma
}

describe("AdminService", () => {
  it("returns retained system overview counts", async () => {
    const prisma = createPrismaMock({
      auditLogs: 2,
      users: 3,
      teams: 1,
      invitations: 4,
      userModulePermissions: 14,
    })
    const service = new AdminService(
      prisma as unknown as PrismaService,
      {} as never,
      createPermissionsMock() as never,
    )

    const result = await service.getSystemOverview()

    expect(result.counts).toEqual({
      auditLogs: 2,
      users: 3,
      teams: 1,
      invitations: 4,
      userModulePermissions: 14,
    })
    expect(prisma.invitation.count).toHaveBeenCalledWith()
    expect(prisma.userModulePermission.count).toHaveBeenCalledWith()
  })

  it("loads users without exposing password hashes", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never)

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
        modulePermissions: {
          select: { permissionKey: true },
          orderBy: { permissionKey: "asc" },
        },
        createdAt: true,
        updatedAt: true,
      }),
    }))
    expect(prisma.user.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("passwordHash")
  })

  it("disables a user without returning the password hash", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never)

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
        modulePermissions: {
          select: { permissionKey: true },
          orderBy: { permissionKey: "asc" },
        },
        createdAt: true,
        updatedAt: true,
      }),
    }))
    expect(prisma.user.update.mock.calls[0]?.[0].select).not.toHaveProperty("passwordHash")
  })

  it("reports a missing user when updating status", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    prisma.user.update.mockRejectedValue(createNotFoundError())
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never, auditLog as never)

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
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never, auditLog as never)

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
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never)

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
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never)

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
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never)

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
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never, auditLog as never)

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
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never, auditLog as never)

    await expect(service.deleteInvitation("missing-invite", "admin@example.com", "203.0.113.50"))
      .rejects
      .toThrow("邀请不存在。")
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("deletes invitations in bulk and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.count.mockResolvedValue(2)
    prisma.invitation.deleteMany.mockResolvedValue({ count: 2 })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never, auditLog as never)

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
      targetId: "batch:2",
      detail: { ids: ["invite-1", "invite-2"], count: 2 },
      ipAddress: "203.0.113.30",
    })
  })

  it("rejects bulk invitation deletes when any id does not exist", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.count.mockResolvedValue(1)
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never, auditLog as never)

    await expect(service.deleteInvitations(["invite-1", "missing-invite"], "admin@example.com", "203.0.113.31"))
      .rejects
      .toThrow("邀请不存在。")

    expect(prisma.invitation.deleteMany).not.toHaveBeenCalled()
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("records user status update audit logs with the request IP", async () => {
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, createPermissionsMock() as never, auditLog as never)

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

  it("lists module permission definitions", () => {
    const permissions = createPermissionsMock()
    const service = new AdminService(createPrismaMock() as unknown as PrismaService, {} as never, permissions as never)

    expect(service.listModulePermissions()).toEqual([{ key: "module.database" }])
    expect(permissions.listModulePermissionDefinitions).toHaveBeenCalledWith()
  })

  it("lists user module permissions", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never)

    await expect(service.listUserModulePermissions("user-1"))
      .resolves
      .toEqual({ permissionKeys: ["module.database"] })
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true },
    })
    expect(permissions.listUserModulePermissions).toHaveBeenCalledWith("user-1")
  })

  it("reports a missing user when listing user module permissions", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never)

    await expect(service.listUserModulePermissions("missing-user"))
      .rejects
      .toThrow("用户不存在。")
    expect(permissions.listUserModulePermissions).not.toHaveBeenCalled()
  })

  it("replaces user module permissions and records an audit log", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never, auditLog as never)

    await expect(service.replaceUserModulePermissions(
      "user-1",
      ["module.database"],
      { id: "admin-1", email: "admin@example.com" },
      "203.0.113.60",
    ))
      .resolves
      .toEqual({ permissionKeys: ["module.database"] })

    expect(permissions.replaceUserModulePermissions).toHaveBeenCalledWith({
      userId: "user-1",
      permissionKeys: ["module.database"],
      grantedByAdminId: "admin-1",
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.user_module_permissions.replace",
      targetType: "user",
      targetId: "user-1",
      detail: {
        before: ["module.skill"],
        after: ["module.database"],
      },
      ipAddress: "203.0.113.60",
    })
  })
})
