import { BadRequestException, ForbiddenException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { TeamsService } from "./teams.service"

function createPrismaMock() {
  return {
    teamMembership: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    team: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback({
      team: {
        create: vi.fn().mockResolvedValue({ id: "team-1", name: "Team", createdByUserId: "user-1" }),
      },
      teamMembership: {
        create: vi.fn().mockResolvedValue({ id: "membership-1", teamId: "team-1", userId: "user-1", role: "owner" }),
      },
    })),
  }
}

function createUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.0.0",
  })
}

function createPermissionsMock() {
  return {
    ensureDefaultTeamAccess: vi.fn(),
    assignOrdinaryMemberRole: vi.fn(),
    getEffectivePermissions: vi.fn().mockResolvedValue([
      "team.invitation.manage",
      "team.member.manage",
    ]),
  }
}

describe("TeamsService", () => {
  it("loads team members with access roles", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ id: "membership-1" })
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn(), consumeInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
    )

    await expect(service.getMyTeam("user-1")).resolves.toEqual({ id: "membership-1" })

    expect(prisma.teamMembership.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      include: {
        team: {
          include: {
            memberships: {
              include: {
                user: { select: { id: true, email: true, status: true } },
                accessRoles: {
                  select: { role: { select: { id: true, name: true } } },
                  orderBy: { assignedAt: "asc" },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    })
  })

  it("lists team members with access roles", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ id: "membership-1", teamId: "team-1" })
    prisma.teamMembership.findMany.mockResolvedValue([])
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn(), consumeInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
    )

    await expect(service.listMembers("user-1")).resolves.toEqual([])

    expect(prisma.teamMembership.findMany).toHaveBeenCalledWith({
      where: { teamId: "team-1" },
      include: {
        user: { select: { id: true, email: true, status: true } },
        accessRoles: {
          select: { role: { select: { id: true, name: true } } },
          orderBy: { assignedAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    })
  })

  it("rejects team creation when the user already belongs to a team", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ id: "membership-1" })
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn(), consumeInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
      auditLog as never,
    )

    await expect(service.createTeam("user-1", { name: "Team" }, "203.0.113.11")).rejects.toThrow(BadRequestException)
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "user@example.com",
      action: "team.create.failure",
      targetType: "team",
      targetId: "unknown",
      detail: { reason: "already_in_team" },
      ipAddress: "203.0.113.11",
    })
  })

  it("returns the existing team error when concurrent team creation hits the user membership constraint", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue(null)
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    prisma.$transaction.mockRejectedValue(createUniqueConstraintError())
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn(), consumeInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
      auditLog as never,
    )

    await expect(service.createTeam("user-1", { name: "Team" }, "203.0.113.12"))
      .rejects
      .toThrow("账号已属于一个团队。")
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "team.create.failure",
      detail: { reason: "already_in_team" },
    }))
  })

  it("records team creation audits with the user email", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue(null)
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn(), consumeInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
      auditLog as never,
    )

    await service.createTeam("user-1", { name: "Team" }, "203.0.113.10")

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "user@example.com",
      action: "team.create",
      targetType: "team",
      targetId: "team-1",
      ipAddress: "203.0.113.10",
    }))
  })

  it("initializes default access roles when creating a team", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue(null)
    const membership = { id: "membership-1", teamId: "team-1", userId: "user-1", role: "owner" }
    const tx = {
      team: { create: vi.fn().mockResolvedValue({ id: "team-1", name: "Team", createdByUserId: "user-1" }) },
      teamMembership: { create: vi.fn().mockResolvedValue(membership) },
    }
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    const permissions = { ensureDefaultTeamAccess: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn(), consumeInvitation: vi.fn() } as never,
      permissions as never,
    )

    await service.createTeam("user-1", { name: "Team" })

    expect(permissions.ensureDefaultTeamAccess).toHaveBeenCalledWith({
      teamId: "team-1",
      ownerMembershipId: "membership-1",
      ownerUserId: "user-1",
      client: tx,
    })
  })

  it("rejects team invitations without the RBAC invitation permission", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "member", teamId: "team-1" })
    const permissions = createPermissionsMock()
    permissions.getEffectivePermissions.mockResolvedValue([])
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      permissions as never,
    )

    await expect(service.createInvitation("user-1", "https://app.example.com")).rejects.toThrow(ForbiddenException)
  })

  it("allows team invitations with the RBAC invitation permission", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "member", teamId: "team-1" })
    const invitations = {
      createTeamInvitation: vi.fn().mockResolvedValue({ id: "invite-1" }),
    }
    const permissions = createPermissionsMock()
    permissions.getEffectivePermissions.mockResolvedValue(["team.invitation.manage"])
    const service = new TeamsService(
      prisma as never,
      invitations as never,
      permissions as never,
    )

    await expect(service.createInvitation("user-1", "https://app.example.com"))
      .resolves
      .toEqual({ id: "invite-1" })
    expect(permissions.getEffectivePermissions).toHaveBeenCalledWith("user-1", "team-1")
    expect(invitations.createTeamInvitation).toHaveBeenCalledWith({
      userId: "user-1",
      teamId: "team-1",
      publicAppUrl: "https://app.example.com",
    })
  })

  it("returns the joined member with user fields", async () => {
    const prisma = createPrismaMock()
    const member = {
      id: "membership-2",
      teamId: "team-1",
      userId: "user-2",
      role: "member",
      user: { id: "user-2", email: "member@example.com", status: "active" },
      accessRoles: [{ role: { id: "role-1", name: "member" } }],
    }
    const createMembership = vi.fn().mockResolvedValue(member)
    prisma.teamMembership.findUnique.mockResolvedValue(null)
    prisma.$transaction.mockImplementationOnce((callback) => callback({
      teamMembership: {
        create: createMembership,
      },
    }))
    const invitations = {
      consumeInvitation: vi.fn().mockResolvedValue({ teamId: "team-1" }),
    }
    const service = new TeamsService(prisma as never, invitations as never, createPermissionsMock() as never)

    await expect(service.joinTeam("user-2", { invitationToken: "team-token" })).resolves.toEqual(member)
    expect(createMembership).toHaveBeenCalledWith({
      data: { teamId: "team-1", userId: "user-2", role: "member" },
      include: {
        user: { select: { id: true, email: true, status: true } },
        accessRoles: {
          select: { role: { select: { id: true, name: true } } },
          orderBy: { assignedAt: "asc" },
        },
      },
    })
  })

  it("assigns the ordinary access role when joining a team", async () => {
    const prisma = createPrismaMock()
    const member = {
      id: "membership-2",
      teamId: "team-1",
      userId: "user-2",
      role: "member",
      user: { id: "user-2", email: "member@example.com", status: "active" },
    }
    const tx = {
      teamMembership: { create: vi.fn().mockResolvedValue(member) },
    }
    prisma.teamMembership.findUnique.mockResolvedValue(null)
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    const permissions = { assignOrdinaryMemberRole: vi.fn() }
    const invitations = { consumeInvitation: vi.fn().mockResolvedValue({ teamId: "team-1" }) }
    const service = new TeamsService(prisma as never, invitations as never, permissions as never)

    await service.joinTeam("user-2", { invitationToken: "team-token" })

    expect(permissions.assignOrdinaryMemberRole).toHaveBeenCalledWith({
      teamId: "team-1",
      teamMembershipId: "membership-2",
      assignedByUserId: "user-2",
      client: tx,
    })
  })

  it("records invalid team invitation attempts", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue(null)
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    prisma.$transaction.mockRejectedValue(new BadRequestException("邀请无效或已过期。"))
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
      auditLog as never,
    )

    await expect(service.joinTeam("user-1", { invitationToken: "bad-token" }, "203.0.113.13"))
      .rejects
      .toThrow("邀请无效或已过期。")
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "user@example.com",
      action: "team.join.failure",
      targetType: "team",
      targetId: "unknown",
      detail: { reason: "invalid_invitation" },
      ipAddress: "203.0.113.13",
    })
  })

  it("returns the existing team error when concurrent team joins hit the user membership constraint", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue(null)
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    prisma.$transaction.mockRejectedValue(createUniqueConstraintError())
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
      auditLog as never,
    )

    await expect(service.joinTeam("user-1", { invitationToken: "team-token" }, "203.0.113.14"))
      .rejects
      .toThrow("账号已属于一个团队。")
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "team.join.failure",
      detail: { reason: "already_in_team" },
    }))
  })

  it("lets a member leave their team", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "member", teamId: "team-1", userId: "user-2" })
    prisma.teamMembership.deleteMany.mockResolvedValue({ count: 1 })
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
      auditLog as never,
    )

    await expect(service.leaveTeam("user-2")).resolves.toEqual({ ok: true })
    expect(prisma.teamMembership.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-2", teamId: "team-1" } })
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "team.leave",
      targetType: "team",
      targetId: "team-1",
      detail: { teamId: "team-1", dissolved: false },
    }))
  })

  it("returns a business error when a member leave races with another deletion", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "member", teamId: "team-1", userId: "user-2" })
    prisma.teamMembership.deleteMany.mockResolvedValue({ count: 0 })
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
    )

    await expect(service.leaveTeam("user-2")).rejects.toThrow("账号未加入团队。")
  })

  it("prevents an owner from leaving while members remain", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "owner", teamId: "team-1", userId: "user-1" })
    const deleteMemberships = vi.fn()
    prisma.$transaction.mockImplementationOnce((callback) => callback({
      $executeRaw: vi.fn(),
      teamMembership: {
        count: vi.fn().mockResolvedValue(2),
        deleteMany: deleteMemberships,
      },
      invitation: { deleteMany: vi.fn() },
      team: { deleteMany: vi.fn() },
    }))
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
    )

    await expect(service.leaveTeam("user-1")).rejects.toThrow(BadRequestException)
    expect(deleteMemberships).not.toHaveBeenCalled()
  })

  it("deletes the team when the last owner leaves", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "owner", teamId: "team-1", userId: "user-1" })
    const deleteInvitations = vi.fn().mockResolvedValue({ count: 1 })
    const deleteMemberships = vi.fn().mockResolvedValue({ count: 1 })
    const deleteTeams = vi.fn().mockResolvedValue({ count: 1 })
    const lockTeam = vi.fn().mockResolvedValue(1)
    const countMembers = vi.fn().mockResolvedValue(1)
    prisma.$transaction.mockImplementationOnce((callback) => callback({
      $executeRaw: lockTeam,
      invitation: { deleteMany: deleteInvitations },
      teamMembership: {
        count: countMembers,
        deleteMany: deleteMemberships,
      },
      team: { deleteMany: deleteTeams },
    }))
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
    )

    await expect(service.leaveTeam("user-1")).resolves.toEqual({ ok: true })
    expect(lockTeam).toHaveBeenCalled()
    expect(lockTeam.mock.invocationCallOrder[0]).toBeLessThan(countMembers.mock.invocationCallOrder[0])
    expect(deleteMemberships).toHaveBeenCalledWith({ where: { userId: "user-1", teamId: "team-1" } })
    expect(deleteInvitations).toHaveBeenCalledWith({ where: { teamId: "team-1" } })
    expect(deleteTeams).toHaveBeenCalledWith({ where: { id: "team-1" } })
  })

  it("does not fail owner leave after deletion when audit actor lookup fails", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "owner", teamId: "team-1", userId: "user-1" })
    prisma.user.findUnique.mockRejectedValue(new Error("connection lost"))
    prisma.$transaction.mockImplementationOnce((callback) => callback({
      $executeRaw: vi.fn(),
      invitation: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      teamMembership: {
        count: vi.fn().mockResolvedValue(1),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      team: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }))
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
      auditLog as never,
    )

    await expect(service.leaveTeam("user-1", "203.0.113.30")).resolves.toEqual({ ok: true })

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "user-1",
      action: "team.dissolve",
      targetType: "team",
      targetId: "team-1",
      detail: { teamId: "team-1", dissolved: true },
      ipAddress: "203.0.113.30",
    }))
  })

  it("returns a business error when the owner membership was already deleted", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "owner", teamId: "team-1", userId: "user-1" })
    prisma.$transaction.mockImplementationOnce((callback) => callback({
      $executeRaw: vi.fn(),
      invitation: { deleteMany: vi.fn() },
      teamMembership: {
        count: vi.fn().mockResolvedValue(1),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      team: { deleteMany: vi.fn() },
    }))
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
    )

    await expect(service.leaveTeam("user-1")).rejects.toThrow("账号未加入团队。")
  })

  it("records member removals with the owner email", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique
      .mockResolvedValueOnce({ role: "owner", teamId: "team-1", userId: "owner-1" })
      .mockResolvedValueOnce({ role: "member", teamId: "team-1", userId: "user-2" })
    prisma.user.findUnique.mockResolvedValue({ email: "owner@example.com" })
    prisma.teamMembership.deleteMany.mockResolvedValue({ count: 1 })
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
      auditLog as never,
    )

    await expect(service.removeMember("owner-1", "user-2", "203.0.113.20")).resolves.toEqual({ ok: true })

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "owner@example.com",
      action: "team.member.remove",
      targetType: "user",
      targetId: "user-2",
      ipAddress: "203.0.113.20",
    }))
  })

  it("returns a specific error when removing the team owner", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique
      .mockResolvedValueOnce({ role: "member", teamId: "team-1", userId: "manager-1" })
      .mockResolvedValueOnce({ role: "owner", teamId: "team-1", userId: "owner-1" })
    const permissions = createPermissionsMock()
    permissions.getEffectivePermissions.mockResolvedValue(["team.member.manage"])
    prisma.user.findUnique.mockResolvedValue({ email: "manager@example.com" })
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      permissions as never,
      auditLog as never,
    )

    await expect(service.removeMember("manager-1", "owner-1", "203.0.113.21"))
      .rejects
      .toThrow("不能移除团队所有者。")
    expect(prisma.teamMembership.deleteMany).not.toHaveBeenCalled()
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "manager@example.com",
      action: "team.member.remove.failure",
      targetType: "user",
      targetId: "owner-1",
      detail: { teamId: "team-1", reason: "target_is_owner" },
      ipAddress: "203.0.113.21",
    })
  })

  it("allows member removals with the RBAC member management permission", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique
      .mockResolvedValueOnce({ role: "member", teamId: "team-1", userId: "manager-1" })
      .mockResolvedValueOnce({ role: "member", teamId: "team-1", userId: "user-2" })
    prisma.teamMembership.deleteMany.mockResolvedValue({ count: 1 })
    const permissions = createPermissionsMock()
    permissions.getEffectivePermissions.mockResolvedValue(["team.member.manage"])
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      permissions as never,
    )

    await expect(service.removeMember("manager-1", "user-2", "203.0.113.20")).resolves.toEqual({ ok: true })

    expect(permissions.getEffectivePermissions).toHaveBeenCalledWith("manager-1", "team-1")
    expect(prisma.teamMembership.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-2", teamId: "team-1" } })
  })

  it("returns a business error when member removal races with another deletion", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique
      .mockResolvedValueOnce({ role: "owner", teamId: "team-1", userId: "owner-1" })
      .mockResolvedValueOnce({ role: "member", teamId: "team-1", userId: "user-2" })
    prisma.teamMembership.deleteMany.mockResolvedValue({ count: 0 })
    const permissions = createPermissionsMock()
    permissions.getEffectivePermissions.mockResolvedValue(["team.member.manage"])
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      permissions as never,
    )

    await expect(service.removeMember("owner-1", "user-2")).rejects.toThrow("成员不存在。")
  })

  it("rejects member removals without the RBAC member management permission", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "owner", teamId: "team-1", userId: "owner-1" })
    const permissions = createPermissionsMock()
    permissions.getEffectivePermissions.mockResolvedValue([])
    prisma.user.findUnique.mockResolvedValue({ email: "owner@example.com" })
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      permissions as never,
      auditLog as never,
    )

    await expect(service.removeMember("owner-1", "user-2", "203.0.113.22")).rejects.toThrow(ForbiddenException)

    expect(prisma.teamMembership.deleteMany).not.toHaveBeenCalled()
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "owner@example.com",
      action: "team.member.remove.failure",
      targetType: "user",
      targetId: "user-2",
      detail: { reason: "permission_denied" },
      ipAddress: "203.0.113.22",
    })
  })
})
