import { describe, expect, it, vi } from "vitest"
import { ActivationRiskService } from "./activation-risk.service"
import type { ActivationRiskSettings } from "./license.types"

const settings: ActivationRiskSettings = {
  attemptRetentionDays: 90,
  rateWindowMinutes: 15,
  rateMaxFailuresPerIp: 2,
  rateMaxFailuresPerEmail: 2,
  rateMaxFailuresPerDevice: 2,
  riskWindowMinutes: 60,
  riskMaxDistinctIpsPerCode: 2,
  riskMaxDistinctEmailsPerCode: 2,
  riskMaxDistinctDevicesPerCode: 2,
  riskMaxBoundConflictsPerCode: 2,
}

describe("ActivationRiskService", () => {
  it("records activation attempts", async () => {
    const create = vi.fn().mockResolvedValue({ id: "attempt_1" })
    const service = new ActivationRiskService({
      activationAttempt: { create },
    } as never, settings)

    await service.recordAttempt({
      activationCodeId: "code_1",
      activationCodeHash: "hash_1",
      activationCodeHint: "SYN-****-0001",
      email: "user@example.com",
      deviceIdHash: "device_hash_1",
      ipAddress: "127.0.0.1",
      userAgent: "Vitest",
      outcome: "invalid_code",
      reason: "激活码无效。",
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        activationCodeId: "code_1",
        activationCodeHash: "hash_1",
        activationCodeHint: "SYN-****-0001",
        email: "user@example.com",
        deviceIdHash: "device_hash_1",
        ipAddress: "127.0.0.1",
        userAgent: "Vitest",
        outcome: "invalid_code",
        reason: "激活码无效。",
      },
    })
  })

  it("rate limits repeated failures from one ip", async () => {
    const count = vi.fn().mockResolvedValue(2)
    const service = new ActivationRiskService({
      activationAttempt: { count },
    } as never, settings, () => new Date("2026-05-03T00:15:00.000Z"))

    await expect(service.assertNotRateLimited({
      email: "user@example.com",
      deviceIdHash: "device_hash_1",
      ipAddress: "127.0.0.1",
    })).rejects.toMatchObject({
      code: "ACTIVATION_RATE_LIMITED",
      message: "尝试过于频繁，请稍后再试。",
    })

    expect(count).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: new Date("2026-05-03T00:00:00.000Z") },
        outcome: { in: ["invalid_code", "bound_conflict", "rate_limited", "risk_locked", "device_limit", "blocked"] },
        ipAddress: "127.0.0.1",
      },
    })
  })

  it("does not rate limit when all dimensions are under threshold", async () => {
    const count = vi.fn().mockResolvedValue(1)
    const service = new ActivationRiskService({
      activationAttempt: { count },
    } as never, settings)

    await expect(service.assertNotRateLimited({
      email: "user@example.com",
      deviceIdHash: "device_hash_1",
      ipAddress: "127.0.0.1",
    })).resolves.toBeUndefined()
  })

  it("risk locks a code when source diversity exceeds thresholds", async () => {
    const groupBy = vi.fn()
      .mockResolvedValueOnce([{ ipAddress: "1.1.1.1" }, { ipAddress: "2.2.2.2" }])
      .mockResolvedValueOnce([{ email: "a@example.com" }])
      .mockResolvedValueOnce([{ deviceIdHash: "device_1" }])
    const count = vi.fn().mockResolvedValue(0)
    const update = vi.fn().mockResolvedValue({ id: "code_1" })
    const service = new ActivationRiskService({
      activationAttempt: { groupBy, count },
      activationCode: { update },
    } as never, settings, () => new Date("2026-05-03T01:00:00.000Z"))

    await service.evaluateCodeRisk({
      activationCodeId: "code_1",
      activationCodeHash: "hash_1",
    })

    expect(update).toHaveBeenCalledWith({
      where: { id: "code_1" },
      data: {
        riskLockedAt: new Date("2026-05-03T01:00:00.000Z"),
        riskLockedReason: "激活码来源异常。",
      },
    })
  })

  it("unlocks a risk locked activation code", async () => {
    const update = vi.fn().mockResolvedValue({ id: "code_1" })
    const service = new ActivationRiskService({
      activationCode: { update },
    } as never, settings, () => new Date("2026-05-03T01:00:00.000Z"))

    await service.setRiskLock("code_1", {
      locked: false,
      note: "确认正常",
    })

    expect(update).toHaveBeenCalledWith({
      where: { id: "code_1" },
      data: {
        riskLockedAt: null,
        riskLockedReason: null,
        riskUnlockedAt: new Date("2026-05-03T01:00:00.000Z"),
        riskReviewNote: "确认正常",
      },
    })
  })

  it("deletes expired activation attempts", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 })
    const service = new ActivationRiskService({
      activationAttempt: { deleteMany },
    } as never, settings, () => new Date("2026-05-03T00:00:00.000Z"))

    await service.cleanupExpiredAttempts()

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date("2026-02-02T00:00:00.000Z") },
      },
    })
  })
})
