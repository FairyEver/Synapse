import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { InvitationsService } from "./invitations.service"

function createPrismaMock() {
  return {
    invitation: {
      create: vi.fn().mockResolvedValue({
        id: "invite-1",
        expiresAt: new Date("2026-05-28T00:00:00.000Z"),
      }),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  }
}

describe("InvitationsService", () => {
  it("returns a team invite URL", async () => {
    const prisma = createPrismaMock()
    const service = new InvitationsService(prisma as never)

    const result = await service.createTeamInvitation({
      userId: "user-1",
      teamId: "team-1",
      publicAppUrl: "https://app.example.com",
    })

    expect(result.inviteUrl).toBe(`https://app.example.com/dashboard/team-invite?token=${result.token}`)
    expect(prisma.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "team_join",
        inviteUrl: `https://app.example.com/dashboard/team-invite?token=${result.token}`,
      }),
    })
  })

  it("rejects invalid invitation tokens", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.updateMany.mockResolvedValue({ count: 0 })
    const service = new InvitationsService(prisma as never)

    await expect(service.consumeInvitation({
      token: "missing",
      type: "team_join",
      acceptedByUserId: "user-1",
    })).rejects.toThrow(BadRequestException)
  })

  it("consumes team invitation tokens with a conditional update", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.updateMany.mockResolvedValue({ count: 1 })
    prisma.invitation.findUnique.mockResolvedValue({
      id: "invite-1",
      type: "team_join",
      tokenHash: "hash",
      expiresAt: new Date("2026-05-28T00:00:00.000Z"),
      usedAt: new Date("2026-05-21T00:00:00.000Z"),
      teamId: "team-1",
      acceptedByUserId: "user-1",
    })
    const service = new InvitationsService(prisma as never)

    await service.consumeInvitation({
      token: "plain-token",
      type: "team_join",
      acceptedByUserId: "user-1",
    })

    expect(prisma.invitation.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.any(String),
        type: "team_join",
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        usedAt: expect.any(Date),
        acceptedByUserId: "user-1",
      },
    })
  })

  it("accepts dashboard team invite URLs when consuming invitations", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.updateMany.mockResolvedValue({ count: 1 })
    prisma.invitation.findUnique.mockResolvedValue({
      id: "invite-1",
      type: "team_join",
      tokenHash: "hash",
      expiresAt: new Date("2026-05-28T00:00:00.000Z"),
      usedAt: new Date("2026-05-21T00:00:00.000Z"),
      teamId: "team-1",
      acceptedByUserId: "user-1",
    })
    const service = new InvitationsService(prisma as never)

    await service.consumeInvitation({
      token: "https://app.example.com/dashboard/team-invite?token=plain-token",
      type: "team_join",
      acceptedByUserId: "user-1",
    })

    expect(prisma.invitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tokenHash: expect.not.stringContaining("https://app.example.com"),
      }),
    }))
  })
})
