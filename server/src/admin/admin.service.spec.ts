import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService } from "./admin.service"

function createPrismaMock(counts: {
  readonly auditLogs?: number
  readonly users?: number
  readonly teams?: number
  readonly invitations?: number
} = {}) {
  return {
    $transaction: vi.fn().mockResolvedValue([
      counts.auditLogs ?? 0,
      counts.users ?? 0,
      counts.teams ?? 0,
      counts.invitations ?? 0,
    ]),
    auditLog: { count: vi.fn() },
    user: {
      count: vi.fn(),
      update: vi.fn(),
    },
    team: { count: vi.fn() },
    invitation: { count: vi.fn() },
  }
}

describe("AdminService", () => {
  it("returns retained system overview counts", async () => {
    const service = new AdminService(
      createPrismaMock({ auditLogs: 2, users: 3, teams: 1, invitations: 4 }) as unknown as PrismaService,
      {} as never,
    )

    const result = await service.getSystemOverview()

    expect(result.counts).toEqual({ auditLogs: 2, users: 3, teams: 1, invitations: 4 })
  })

  it("disables a user", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService, {} as never)

    await service.updateUserStatus("user-1", { status: "disabled" })

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { status: "disabled" },
    })
  })
})
