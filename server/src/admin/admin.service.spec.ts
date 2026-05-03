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
        riskLockedAt: true,
        riskLockedReason: true,
        riskUnlockedAt: true,
        riskReviewNote: true,
        replacedByActivationCodeId: true,
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

  it("lists activation attempts for one code", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new AdminService({
      activationAttempt: { findMany },
    } as unknown as PrismaService)

    await service.listActivationAttempts("code_1")

    expect(findMany).toHaveBeenCalledWith({
      where: { activationCodeId: "code_1" },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
  })

  it("updates activation code risk lock state", async () => {
    const risk = {
      setRiskLock: vi.fn().mockResolvedValue({ id: "code_1" }),
    }
    const service = new AdminService({} as unknown as PrismaService, risk as never)

    await service.updateActivationCodeRiskLock("code_1", {
      locked: false,
      note: "确认正常",
    })

    expect(risk.setRiskLock).toHaveBeenCalledWith("code_1", {
      locked: false,
      note: "确认正常",
    })
  })

  it("replaces a bound activation code and migrates the license", async () => {
    const findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: "old_code",
      boundAccountId: "account_1",
      maxDevices: 1,
      expiresAt: new Date("2026-06-01T00:00:00.000Z"),
      redeemedAt: new Date("2026-05-01T00:00:00.000Z"),
      license: { id: "license_1" },
    })
    const create = vi.fn().mockResolvedValue({
      id: "new_code",
      maxDevices: 1,
    })
    const updateActivationCode = vi.fn().mockResolvedValue({ id: "old_code" })
    const updateLicense = vi.fn().mockResolvedValue({ id: "license_1" })
    const transaction = vi.fn(async (callback) => callback({
      activationCode: {
        findUniqueOrThrow,
        create,
        update: updateActivationCode,
      },
      license: {
        update: updateLicense,
      },
    }))
    class TestAdminService extends AdminService {
      protected override createActivationCodeValue(): string {
        return "SYN-NEWC-0001"
      }
    }
    const service = new TestAdminService({
      $transaction: transaction,
    } as unknown as PrismaService)

    const result = await service.replaceActivationCode("old_code")

    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "old_code" },
      include: { license: true },
    })
    expect(create).toHaveBeenCalledWith({
      data: {
        codeHint: "SYN-****-0001",
        codeHash: hashActivationCode("SYN-NEWC-0001"),
        maxDevices: 1,
        expiresAt: new Date("2026-06-01T00:00:00.000Z"),
        boundAccountId: "account_1",
        redeemedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    })
    expect(updateLicense).toHaveBeenCalledWith({
      where: { id: "license_1" },
      data: { activationCodeId: "new_code" },
    })
    expect(updateActivationCode).toHaveBeenCalledWith({
      where: { id: "old_code" },
      data: {
        status: "revoked",
        replacedByActivationCodeId: "new_code",
      },
    })
    expect(result).toEqual({
      id: "new_code",
      code: "SYN-NEWC-0001",
      maxDevices: 1,
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
