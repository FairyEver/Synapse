import { describe, expect, it, vi } from "vitest"
import { hashActivationCode } from "../licenses/hash"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService } from "./admin.service"

describe("AdminService", () => {
  it("lists activation codes with pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const count = vi.fn().mockResolvedValue(0)
    const transaction = vi.fn((args) => Promise.all(args))
    const service = new AdminService({
      $transaction: transaction,
      activationCode: { findMany, count },
    } as unknown as PrismaService)

    const result = await service.listActivationCodes()

    expect(result).toEqual({ data: [], total: 0, page: 1, pageSize: 20 })
  })

  it("can include archived activation codes", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const count = vi.fn().mockResolvedValue(0)
    const transaction = vi.fn((args) => Promise.all(args))
    const service = new AdminService({
      $transaction: transaction,
      activationCode: { findMany, count },
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

  it("lists activation attempts with pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const count = vi.fn().mockResolvedValue(0)
    const transaction = vi.fn((args) => Promise.all(args))
    const service = new AdminService({
      $transaction: transaction,
      activationAttempt: { findMany, count },
    } as unknown as PrismaService)

    const result = await service.listActivationAttempts("code_1")

    expect(result).toEqual({ data: [], total: 0, page: 1, pageSize: 100 })
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

    expect(result).toEqual({
      id: "new_code",
      code: "SYN-NEWC-0001",
      maxDevices: 1,
    })
  })

  it("lists devices with pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const count = vi.fn().mockResolvedValue(0)
    const transaction = vi.fn((args) => Promise.all(args))
    const service = new AdminService({
      $transaction: transaction,
      device: { findMany, count },
    } as unknown as PrismaService)

    const result = await service.listDevices()

    expect(result).toEqual({ data: [], total: 0, page: 1, pageSize: 20 })
  })

  it("creates activation codes with system-generated codes", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ id: "code_1", maxDevices: 2 })
      .mockResolvedValueOnce({ id: "code_2", maxDevices: 2 })
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

    expect(result).toEqual([
      { id: "code_1", code: "SYN-TEST-0001", maxDevices: 2 },
      { id: "code_2", code: "SYN-TEST-0002", maxDevices: 2 },
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
  })
})