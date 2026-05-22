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
      update: vi.fn(),
    },
  }
}

describe("InvitationsService", () => {
  it("creates a signup invitation with a returned plaintext token", async () => {
    const prisma = createPrismaMock()
    const service = new InvitationsService(prisma as never)

    const result = await service.createSignupInvitation({
      adminId: "admin-1",
      publicAppUrl: "https://app.example.com",
    })

    expect(result.token.length).toBeGreaterThanOrEqual(40)
    expect(prisma.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "user_signup",
        createdByAdminId: "admin-1",
      }),
    })
  })

  it("returns a canonical signup invite URL", async () => {
    const prisma = createPrismaMock()
    const service = new InvitationsService(prisma as never)

    const result = await service.createSignupInvitation({
      adminId: "admin-1",
      publicAppUrl: "https://app.example.com/",
    })

    expect(result.inviteUrl).toBe(`https://app.example.com/invite#token=${result.token}`)
  })

  it("returns a canonical team invite URL", async () => {
    const prisma = createPrismaMock()
    const service = new InvitationsService(prisma as never)

    const result = await service.createTeamInvitation({
      userId: "user-1",
      teamId: "team-1",
      publicAppUrl: "https://app.example.com",
    })

    expect(result.inviteUrl).toBe(`https://app.example.com/invite#token=${result.token}`)
  })

  it("rejects invalid invitation tokens", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.updateMany.mockResolvedValue({ count: 0 })
    const service = new InvitationsService(prisma as never)

    await expect(service.consumeInvitation({
      token: "missing",
      type: "user_signup",
      acceptedByUserId: "user-1",
    })).rejects.toThrow(BadRequestException)
  })

  it("consumes invitation tokens with a conditional update", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.updateMany.mockResolvedValue({ count: 1 })
    prisma.invitation.findUnique.mockResolvedValue({
      id: "invite-1",
      type: "user_signup",
      tokenHash: "hash",
      expiresAt: new Date("2026-05-28T00:00:00.000Z"),
      usedAt: new Date("2026-05-21T00:00:00.000Z"),
      teamId: null,
      acceptedByUserId: "user-1",
    })
    const service = new InvitationsService(prisma as never)

    await service.consumeInvitation({
      token: "plain-token",
      type: "user_signup",
      acceptedByUserId: "user-1",
    })

    expect(prisma.invitation.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.any(String),
        type: "user_signup",
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        usedAt: expect.any(Date),
        acceptedByUserId: "user-1",
      },
    })
  })

  it("accepts full invite URLs when consuming invitations", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.updateMany.mockResolvedValue({ count: 1 })
    prisma.invitation.findUnique.mockResolvedValue({
      id: "invite-1",
      type: "user_signup",
      tokenHash: "hash",
      expiresAt: new Date("2026-05-28T00:00:00.000Z"),
      usedAt: new Date("2026-05-21T00:00:00.000Z"),
      teamId: null,
      acceptedByUserId: "user-1",
    })
    const service = new InvitationsService(prisma as never)

    await service.consumeInvitation({
      token: "https://app.example.com/invite#token=plain-token",
      type: "user_signup",
      acceptedByUserId: "user-1",
    })

    expect(prisma.invitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tokenHash: expect.not.stringContaining("https://app.example.com"),
      }),
    }))
  })
})
