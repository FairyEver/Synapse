import { describe, expect, it, vi } from "vitest"
import { hashActivationCode } from "../licenses/hash"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService } from "./admin.service"

describe("AdminService", () => {
  it("creates activation codes with normalized hash and default device count", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "code_1",
      maxDevices: 1,
    })
    const service = new AdminService({
      activationCode: { create },
    } as unknown as PrismaService)

    const result = await service.createActivationCode({
      code: " abcd-1234 ",
      maxDevices: 1,
      expiresAt: null,
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        codeHash: hashActivationCode("ABCD-1234"),
        maxDevices: 1,
        expiresAt: null,
      },
    })
    expect(result).toEqual({
      id: "code_1",
      code: "ABCD-1234",
      maxDevices: 1,
    })
  })

  it("returns system overview counts", async () => {
    const transaction = vi.fn().mockResolvedValue([10, 7, 4, 3, 4, 2, 5, 4, 12])
    const count = vi.fn()
    const service = new AdminService({
      $transaction: transaction,
      activationCode: { count },
      account: { count },
      license: { count },
      device: { count },
      lease: { count },
    } as unknown as PrismaService)

    const result = await service.getSystemOverview()

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(result.counts).toEqual({
      activationCodes: 10,
      activeActivationCodes: 7,
      accounts: 4,
      activeAccounts: 3,
      licenses: 4,
      activeLicenses: 2,
      devices: 5,
      activeDevices: 4,
      leases: 12,
    })
    expect(result.serverTime).toEqual(expect.any(String))
  })
})
