import { BadRequestException, ForbiddenException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { TeamsService } from "./teams.service"

function createPrismaMock() {
  return {
    teamMembership: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
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

function createPermissionsMock() {
  return {
    ensureDefaultTeamAccess: vi.fn(),
    assignOrdinaryMemberRole: vi.fn(),
  }
}

describe("TeamsService", () => {
  it("rejects team creation when the user already belongs to a team", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ id: "membership-1" })
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn(), consumeInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
    )

    await expect(service.createTeam("user-1", { name: "Team" })).rejects.toThrow(BadRequestException)
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

  it("rejects team invitations from non-owners", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "member", teamId: "team-1" })
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
    )

    await expect(service.createInvitation("user-1", "https://app.example.com")).rejects.toThrow(ForbiddenException)
  })

  it("returns the joined member with user fields", async () => {
    const prisma = createPrismaMock()
    const member = {
      id: "membership-2",
      teamId: "team-1",
      userId: "user-2",
      role: "member",
      user: { id: "user-2", email: "member@example.com", status: "active" },
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
      include: { user: { select: { id: true, email: true, status: true } } },
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

  it("lets a member leave their team", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "member", teamId: "team-1", userId: "user-2" })
    prisma.teamMembership.delete.mockResolvedValue({ id: "membership-2" })
    const service = new TeamsService(
      prisma as never,
      { createTeamInvitation: vi.fn() } as never,
      createPermissionsMock() as never,
    )

    await expect(service.leaveTeam("user-2")).resolves.toEqual({ ok: true })
    expect(prisma.teamMembership.delete).toHaveBeenCalledWith({ where: { userId: "user-2" } })
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
      action: "team.leave",
      targetType: "team",
      targetId: "team-1",
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
    prisma.teamMembership.delete.mockResolvedValue({ id: "membership-2" })
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
})
