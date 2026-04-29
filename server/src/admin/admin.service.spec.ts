import { describe, expect, it, vi } from "vitest"
import { hashActivationCode } from "../licenses/hash"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService } from "./admin.service"

describe("AdminService", () => {
  it("lists activation codes with bound account email", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new AdminService({
      activationCode: { findMany },
    } as unknown as PrismaService)

    await service.listActivationCodes()

    expect(findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      where: { archivedAt: null },
      select: {
        id: true,
        codeHint: true,
        status: true,
        maxDevices: true,
        expiresAt: true,
        boundAccountId: true,
        boundAccount: {
          select: {
            email: true,
          },
        },
        redeemedAt: true,
        archivedAt: true,
        createdAt: true,
      },
    })
  })

  it("can include archived activation codes", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new AdminService({
      activationCode: { findMany },
    } as unknown as PrismaService)

    await service.listActivationCodes({ includeArchived: true })

    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty("where")
  })

  it("archives activation codes with a timestamp", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "code_1",
      archivedAt: new Date("2026-04-29T00:00:00.000Z"),
    })
    const service = new AdminService({
      activationCode: { update },
    } as unknown as PrismaService)

    await service.archiveActivationCode("code_1")

    expect(update).toHaveBeenCalledWith({
      where: { id: "code_1" },
      data: { archivedAt: expect.any(Date) },
    })
  })

  it("lists devices with account and activation code information", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new AdminService({
      device: { findMany },
    } as unknown as PrismaService)

    await service.listDevices()

    expect(findMany).toHaveBeenCalledWith({
      orderBy: { lastSeenAt: "desc" },
      include: {
        license: {
          include: {
            account: true,
            activationCode: {
              select: {
                id: true,
                codeHint: true,
              },
            },
          },
        },
      },
    })
  })

  it("creates activation codes with system-generated codes", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: "code_1",
        maxDevices: 2,
      })
      .mockResolvedValueOnce({
        id: "code_2",
        maxDevices: 2,
      })
    class TestAdminService extends AdminService {
      private index = 0

      protected override createActivationCodeValue(): string {
        this.index += 1
        return `SYN-TEST-000${this.index}`
      }
    }
    const service = new TestAdminService({
      activationCode: { create },
    } as unknown as PrismaService)

    const result = await service.createActivationCode({
      maxDevices: 2,
      expiresAt: null,
      quantity: 2,
    })

    expect(create).toHaveBeenNthCalledWith(1, {
      data: {
        codeHint: "SYN-****-0001",
        codeHash: hashActivationCode("SYN-TEST-0001"),
        maxDevices: 2,
        expiresAt: null,
      },
    })
    expect(create).toHaveBeenNthCalledWith(2, {
      data: {
        codeHint: "SYN-****-0002",
        codeHash: hashActivationCode("SYN-TEST-0002"),
        maxDevices: 2,
        expiresAt: null,
      },
    })
    expect(result).toEqual([
      {
        id: "code_1",
        code: "SYN-TEST-0001",
        maxDevices: 2,
      },
      {
        id: "code_2",
        code: "SYN-TEST-0002",
        maxDevices: 2,
      },
    ])
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
