import { describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService } from "./admin.service"

function createPermissionsMock() {
  return {
    listPermissionDefinitions: vi.fn().mockReturnValue([{ key: "database.use" }]),
    listTeamEntitlements: vi.fn().mockResolvedValue(["database.use"]),
    replaceTeamEntitlements: vi.fn().mockResolvedValue(["agent.chat.use", "database.use"]),
    replaceTeamPermissions: vi.fn().mockResolvedValue({
      permissionKeys: ["agent.chat.use", "database.use"],
      rolePermissions: [{ roleId: "role-1", permissionKeys: ["database.use"] }],
    }),
    replaceRolePermissions: vi.fn().mockResolvedValue(["database.use"]),
    listMemberAccessRoles: vi.fn().mockResolvedValue([{ id: "role-1", name: "普通成员" }]),
    assignAccessRole: vi.fn().mockResolvedValue([{ id: "role-1", name: "普通成员" }]),
    removeAccessRole: vi.fn().mockResolvedValue([]),
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
  readonly teamEntitlements?: number
  readonly teamAccessRoles?: number
  readonly teamAccessRolePermissions?: number
  readonly teamMemberAccessRoles?: number
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
        counts.teamEntitlements ?? 0,
        counts.teamAccessRoles ?? 0,
        counts.teamAccessRolePermissions ?? 0,
        counts.teamMemberAccessRoles ?? 0,
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
    teamAccessRole: { count: vi.fn(), findMany: vi.fn() },
    teamAccessRolePermission: { count: vi.fn() },
    teamEntitlement: { count: vi.fn() },
    teamMemberAccessRole: { count: vi.fn() },
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
      teamEntitlements: 14,
      teamAccessRoles: 2,
      teamAccessRolePermissions: 25,
      teamMemberAccessRoles: 3,
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
      teamEntitlements: 14,
      teamAccessRoles: 2,
      teamAccessRolePermissions: 25,
      teamMemberAccessRoles: 3,
    })
    expect(prisma.invitation.count).toHaveBeenCalledWith()
    expect(prisma.teamEntitlement.count).toHaveBeenCalledWith()
    expect(prisma.teamAccessRole.count).toHaveBeenCalledWith()
    expect(prisma.teamAccessRolePermission.count).toHaveBeenCalledWith()
    expect(prisma.teamMemberAccessRole.count).toHaveBeenCalledWith()
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
            role: true,
            team: { select: { id: true, name: true } },
            accessRoles: {
              select: { role: { select: { id: true, name: true } } },
              orderBy: { assignedAt: "asc" },
            },
          },
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
            role: true,
            team: { select: { id: true, name: true } },
            accessRoles: {
              select: { role: { select: { id: true, name: true } } },
              orderBy: { assignedAt: "asc" },
            },
          },
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
            accessRoles: {
              select: { role: { select: { id: true, name: true } } },
              orderBy: { assignedAt: "asc" },
            },
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

  it("lists permission definitions", () => {
    const permissions = createPermissionsMock()
    const service = new AdminService(createPrismaMock() as unknown as PrismaService, {} as never, permissions as never)

    expect(service.listPermissions()).toEqual([{ key: "database.use" }])
    expect(permissions.listPermissionDefinitions).toHaveBeenCalledWith()
  })

  it("lists team entitlements", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never)

    await expect(service.listTeamEntitlements("team-1"))
      .resolves
      .toEqual({ permissionKeys: ["database.use"] })
    expect(prisma.team.findUnique).toHaveBeenCalledWith({
      where: { id: "team-1" },
      select: { id: true },
    })
    expect(permissions.listTeamEntitlements).toHaveBeenCalledWith("team-1")
  })

  it("reports a missing team when listing team entitlements", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    prisma.team.findUnique.mockResolvedValue(null)
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never)

    await expect(service.listTeamEntitlements("missing-team"))
      .rejects
      .toThrow("团队不存在。")
    expect(permissions.listTeamEntitlements).not.toHaveBeenCalled()
  })

  it("replaces team entitlements and records an audit log", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never, auditLog as never)

    await expect(service.replaceTeamEntitlements(
      "team-1",
      ["database.use", "agent.chat.use"],
      { id: "admin-1", email: "admin@example.com" },
      "203.0.113.60",
    ))
      .resolves
      .toEqual({ permissionKeys: ["agent.chat.use", "database.use"] })

    expect(prisma.team.findUnique).toHaveBeenCalledWith({
      where: { id: "team-1" },
      select: { id: true },
    })
    expect(permissions.replaceTeamEntitlements).toHaveBeenCalledWith({
      teamId: "team-1",
      permissionKeys: ["database.use", "agent.chat.use"],
      grantedByAdminId: "admin-1",
      source: "manual",
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.team_entitlements.update",
      targetType: "team",
      targetId: "team-1",
      detail: { permissionKeys: ["agent.chat.use", "database.use"] },
      ipAddress: "203.0.113.60",
    })
  })

  it("reports a missing team before replacing team entitlements", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    prisma.team.findUnique.mockResolvedValue(null)
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never, auditLog as never)

    await expect(service.replaceTeamEntitlements(
      "missing-team",
      ["database.use"],
      { id: "admin-1", email: "admin@example.com" },
      "203.0.113.70",
    ))
      .rejects
      .toThrow("团队不存在。")

    expect(permissions.replaceTeamEntitlements).not.toHaveBeenCalled()
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("replaces team permissions atomically and records an audit log", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never, auditLog as never)

    await expect(service.replaceTeamPermissions(
      "team-1",
      {
        permissionKeys: ["database.use", "agent.chat.use"],
        rolePermissions: [{ roleId: "role-1", permissionKeys: ["database.use"] }],
      },
      { id: "admin-1", email: "admin@example.com" },
      "203.0.113.75",
    ))
      .resolves
      .toEqual({
        permissionKeys: ["agent.chat.use", "database.use"],
        rolePermissions: [{ roleId: "role-1", permissionKeys: ["database.use"] }],
      })

    expect(permissions.replaceTeamPermissions).toHaveBeenCalledWith({
      teamId: "team-1",
      permissionKeys: ["database.use", "agent.chat.use"],
      rolePermissions: [{ roleId: "role-1", permissionKeys: ["database.use"] }],
      grantedByAdminId: "admin-1",
      source: "manual",
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.team_entitlements.update",
      targetType: "team",
      targetId: "team-1",
      detail: {
        permissionKeys: ["agent.chat.use", "database.use"],
        rolePermissions: [{ roleId: "role-1", permissionKeys: ["database.use"] }],
      },
      ipAddress: "203.0.113.75",
    })
  })

  it("lists team access roles with flattened permission keys", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    prisma.teamAccessRole.findMany.mockResolvedValue([
      {
        id: "role-1",
        name: "普通成员",
        description: null,
        kind: "system",
        locked: true,
        sortOrder: 1,
        permissions: [{ permissionKey: "database.use" }],
        createdAt: new Date("2026-05-23T00:00:00.000Z"),
        updatedAt: new Date("2026-05-23T00:00:00.000Z"),
      },
    ])
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never)

    await expect(service.listTeamAccessRoles("team-1"))
      .resolves
      .toEqual([
        expect.objectContaining({
          id: "role-1",
          name: "普通成员",
          permissionKeys: ["database.use"],
        }),
      ])
    expect(prisma.team.findUnique).toHaveBeenCalledWith({
      where: { id: "team-1" },
      select: { id: true },
    })
    expect(prisma.teamAccessRole.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: "team-1" },
    }))
  })

  it("replaces role permissions and records an audit log", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never, auditLog as never)

    await expect(service.replaceRolePermissions(
      "team-1",
      "role-1",
      ["database.use"],
      { id: "admin-1", email: "admin@example.com" },
      "203.0.113.80",
    ))
      .resolves
      .toEqual({ permissionKeys: ["database.use"] })

    expect(permissions.replaceRolePermissions).toHaveBeenCalledWith({
      teamId: "team-1",
      roleId: "role-1",
      permissionKeys: ["database.use"],
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.team_role_permissions.update",
      targetType: "team_access_role",
      targetId: "role-1",
      detail: { teamId: "team-1", permissionKeys: ["database.use"] },
      ipAddress: "203.0.113.80",
    })
  })

  it("lists member access roles through the permissions service", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never)

    await expect(service.listMemberAccessRoles("team-1", "membership-1"))
      .resolves
      .toEqual({ roles: [{ id: "role-1", name: "普通成员" }] })

    expect(prisma.team.findUnique).toHaveBeenCalledWith({
      where: { id: "team-1" },
      select: { id: true },
    })
    expect(permissions.listMemberAccessRoles).toHaveBeenCalledWith("team-1", "membership-1")
  })

  it("assigns member access roles and records an audit log", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never, auditLog as never)

    await expect(service.assignMemberAccessRole(
      "team-1",
      "membership-1",
      "role-1",
      { id: "admin-1", email: "admin@example.com" },
      "203.0.113.90",
    ))
      .resolves
      .toEqual({ roles: [{ id: "role-1", name: "普通成员" }] })

    expect(permissions.assignAccessRole).toHaveBeenCalledWith({
      teamId: "team-1",
      teamMembershipId: "membership-1",
      roleId: "role-1",
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.team_member_access_role.assign",
      targetType: "team_membership",
      targetId: "membership-1",
      detail: { teamId: "team-1", roleId: "role-1" },
      ipAddress: "203.0.113.90",
    })
  })

  it("removes member access roles and records an audit log", async () => {
    const permissions = createPermissionsMock()
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, {} as never, permissions as never, auditLog as never)

    await expect(service.removeMemberAccessRole(
      "team-1",
      "membership-1",
      "role-1",
      { id: "admin-1", email: "admin@example.com" },
      "203.0.113.91",
    ))
      .resolves
      .toEqual({ roles: [] })

    expect(permissions.removeAccessRole).toHaveBeenCalledWith({
      teamId: "team-1",
      teamMembershipId: "membership-1",
      roleId: "role-1",
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.team_member_access_role.remove",
      targetType: "team_membership",
      targetId: "membership-1",
      detail: { teamId: "team-1", roleId: "role-1" },
      ipAddress: "203.0.113.91",
    })
  })
})
