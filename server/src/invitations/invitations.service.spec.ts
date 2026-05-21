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
      update: vi.fn(),
    },
  }
}

describe("InvitationsService", () => {
  it("creates a signup invitation with a returned plaintext token", async () => {
    const prisma = createPrismaMock()
    const service = new InvitationsService(prisma as never)

    const result = await service.createSignupInvitation({ adminId: "admin-1" })

    expect(result.token.length).toBeGreaterThanOrEqual(40)
    expect(prisma.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "user_signup",
        createdByAdminId: "admin-1",
      }),
    })
  })

  it("rejects invalid invitation tokens", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.findUnique.mockResolvedValue(null)
    const service = new InvitationsService(prisma as never)

    await expect(service.consumeInvitation({
      token: "missing",
      type: "user_signup",
      acceptedByUserId: "user-1",
    })).rejects.toThrow(BadRequestException)
  })
})
