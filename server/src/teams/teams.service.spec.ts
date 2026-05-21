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
    },
    team: {
      findFirst: vi.fn(),
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

  it("rejects team invitations from non-owners", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ role: "member", teamId: "team-1" })
    const service = new TeamsService(prisma as never, { createTeamInvitation: vi.fn() } as never)

    await expect(service.createInvitation("user-1")).rejects.toThrow(ForbiddenException)
  })
})
