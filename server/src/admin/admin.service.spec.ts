import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService } from "./admin.service"

describe("AdminService", () => {
  it("returns retained system overview counts", async () => {
    const transaction = vi.fn().mockResolvedValue([3])
    const service = new AdminService({
      $transaction: transaction,
      auditLog: { count: vi.fn() },
    } as unknown as PrismaService)

    const result = await service.getSystemOverview()

    expect(result.counts).toEqual({ auditLogs: 3 })
  })
})
