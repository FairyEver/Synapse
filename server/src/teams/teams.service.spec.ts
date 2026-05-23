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

describe("TeamsService", () => {
  it("rejects team creation when the user already belongs to a team", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ id: "membership-1" })
    const service = new TeamsService(prisma as never, { createTeamInvitation: vi.fn(), consumeInvitation: vi.fn() } as never)

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

  it("rejects team invitations from non-owners", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "member", teamId: "team-1" })
    const service = new TeamsService(prisma as never, { createTeamInvitation: vi.fn() } as never)

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
    const service = new TeamsService(prisma as never, invitations as never)

    await expect(service.joinTeam("user-2", { invitationToken: "team-token" })).resolves.toEqual(member)
    expect(createMembership).toHaveBeenCalledWith({
      data: { teamId: "team-1", userId: "user-2", role: "member" },
      include: { user: { select: { id: true, email: true, status: true } } },
    })
  })

  it("lets a member leave their team", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "member", teamId: "team-1", userId: "user-2" })
    prisma.teamMembership.delete.mockResolvedValue({ id: "membership-2" })
    const service = new TeamsService(prisma as never, { createTeamInvitation: vi.fn() } as never)

    await expect(service.leaveTeam("user-2")).resolves.toEqual({ ok: true })
    expect(prisma.teamMembership.delete).toHaveBeenCalledWith({ where: { userId: "user-2" } })
  })

  it("prevents an owner from leaving while members remain", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "owner", teamId: "team-1", userId: "user-1" })
    prisma.teamMembership.count.mockResolvedValue(2)
    const service = new TeamsService(prisma as never, { createTeamInvitation: vi.fn() } as never)

    await expect(service.leaveTeam("user-1")).rejects.toThrow(BadRequestException)
    expect(prisma.teamMembership.delete).not.toHaveBeenCalled()
  })

  it("deletes the team when the last owner leaves", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "owner", teamId: "team-1", userId: "user-1" })
    prisma.teamMembership.count.mockResolvedValue(1)
    const deleteInvitations = vi.fn().mockResolvedValue({ count: 1 })
    prisma.$transaction.mockImplementationOnce((callback) => callback({
      invitation: { deleteMany: deleteInvitations },
      teamMembership: { delete: vi.fn().mockResolvedValue({ id: "membership-1" }) },
      team: { delete: vi.fn().mockResolvedValue({ id: "team-1" }) },
    }))
    const service = new TeamsService(prisma as never, { createTeamInvitation: vi.fn() } as never)

    await expect(service.leaveTeam("user-1")).resolves.toEqual({ ok: true })
    expect(deleteInvitations).toHaveBeenCalledWith({ where: { teamId: "team-1" } })
  })

  it("records member removals with the owner email", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique
      .mockResolvedValueOnce({ role: "owner", teamId: "team-1", userId: "owner-1" })
      .mockResolvedValueOnce({ role: "member", teamId: "team-1", userId: "user-2" })
    prisma.user.findUnique.mockResolvedValue({ email: "owner@example.com" })
    prisma.teamMembership.delete.mockResolvedValue({ id: "membership-2" })
    const auditLog = { record: vi.fn() }
    const service = new TeamsService(prisma as never, { createTeamInvitation: vi.fn() } as never, auditLog as never)

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
