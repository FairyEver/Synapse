import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { hashActivationCode, hashDeviceId } from "./hash"
import type { ManagedStatus } from "./license.types"
import { LicensesService } from "./licenses.service"

function keys(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("ed25519")
  return {
    privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: pair.publicKey.export({ format: "pem", type: "spki" }).toString(),
  }
}

const requestSource = {
  ipAddress: "127.0.0.1",
  userAgent: "Vitest",
}

describe("LicensesService", () => {
  it("redeems an unused activation code for one email and one device", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    service.seedActivationCode({ codeHash: hashActivationCode("ABCD-1234"), maxDevices: 1 })

    const result = await service.redeem({
      email: "USER@example.com",
      activationCode: "abcd-1234",
      device: {
        deviceId: "device-1",
        name: "MacBook",
        platform: "darwin",
        appVersion: "0.2.54",
      },
      ...requestSource,
    })

    expect(result.email).toBe("user@example.com")
    expect(result.leaseToken.length).toBeGreaterThan(20)
  })

  it("rejects a second email for a bound activation code", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    service.seedActivationCode({ codeHash: hashActivationCode("ABCD-1234"), maxDevices: 1 })

    await service.redeem({
      email: "first@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
      ...requestSource,
    })

    await expect(service.redeem({
      email: "second@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-2", name: "ThinkPad", platform: "win32", appVersion: "0.2.54" },
      ...requestSource,
    })).rejects.toThrow("激活码已绑定其他账号。")
  })

  it("replaces old device when maxDevices is one and a new device activates", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    service.seedActivationCode({ codeHash: hashActivationCode("ABCD-1234"), maxDevices: 1 })

    await service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
      ...requestSource,
    })

    const result = await service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-2", name: "ThinkPad", platform: "win32", appVersion: "0.2.54" },
      ...requestSource,
    })

    expect(result.email).toBe("user@example.com")
    expect(result.deviceIdHash).toBe(hashDeviceId("device-2"))
  })

  it("rejects redeeming a revoked device under the same license", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    service.seedActivationCode({ codeHash: hashActivationCode("ABCD-1234"), maxDevices: 1 })

    await service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
      ...requestSource,
    })

    const repository = (service as unknown as TestableLicenseService).repository
    const device = [...repository.devices.values()][0]
    if (!device) throw new Error("Redeemed device is missing")
    device.status = "revoked"

    await expect(service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.55" },
      ...requestSource,
    })).rejects.toThrow("设备已停用。")
  })

  it("renews a valid lease for the same active device", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    service.seedActivationCode({ codeHash: hashActivationCode("ABCD-1234"), maxDevices: 1 })
    const redeemed = await service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
      ...requestSource,
    })

    const renewed = await service.renew({
      leaseToken: redeemed.leaseToken,
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.55" },
    })

    expect(renewed.deviceIdHash).toBe(hashDeviceId("device-1"))
    expect(renewed.leaseToken).not.toBe(redeemed.leaseToken)
  })

  it("rejects renewal when the bound activation code is revoked", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    const codeHash = hashActivationCode("ABCD-1234")
    service.seedActivationCode({ codeHash, maxDevices: 1 })
    const redeemed = await service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
      ...requestSource,
    })

    const repository = (service as unknown as TestableLicenseService).repository
    const activation = repository.activations.get(codeHash)
    if (!activation) throw new Error("Seeded activation code is missing")
    activation.status = "revoked"

    await expect(service.renew({
      leaseToken: redeemed.leaseToken,
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.55" },
    })).rejects.toThrow("授权不可用。")
  })

  it("rejects new activation when a code is risk locked", async () => {
    const pair = keys()
    const risk = {
      assertNotRateLimited: vi.fn(),
      recordAttempt: vi.fn(),
      evaluateCodeRisk: vi.fn(),
    }
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    }, risk as never)
    service.seedActivationCode({
      codeHash: hashActivationCode("ABCD-1234"),
      maxDevices: 1,
      riskLockedAt: new Date("2026-05-03T00:00:00.000Z"),
    })

    await expect(service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
      ...requestSource,
    })).rejects.toMatchObject({
      code: "ACTIVATION_RISK_LOCKED",
    })

    expect(risk.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "risk_locked",
    }))
  })

  it("allows an existing active device to recover a lost lease while the code is risk locked", async () => {
    const pair = keys()
    const risk = {
      assertNotRateLimited: vi.fn(),
      recordAttempt: vi.fn(),
      evaluateCodeRisk: vi.fn(),
    }
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    }, risk as never)
    service.seedActivationCode({ codeHash: hashActivationCode("ABCD-1234"), maxDevices: 1 })

    await service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
      ...requestSource,
    })

    const repository = (service as unknown as TestableLicenseService).repository
    const activation = repository.activations.get(hashActivationCode("ABCD-1234"))
    if (!activation) throw new Error("Seeded activation code is missing")
    activation.riskLockedAt = new Date("2026-05-03T00:00:00.000Z")

    await expect(service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.55" },
      ...requestSource,
    })).resolves.toMatchObject({
      email: "user@example.com",
      deviceIdHash: hashDeviceId("device-1"),
    })
  })

  it("redeems a reserved-email activation code when the email matches", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    service.seedActivationCode({
      codeHash: hashActivationCode("ABCD-1234"),
      maxDevices: 1,
      reservedEmail: "allowed@example.com",
    })

    const result = await service.redeem({
      email: "ALLOWED@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
      ...requestSource,
    })

    expect(result.email).toBe("allowed@example.com")
  })

  it("rejects redemption when email does not match reservedEmail", async () => {
    const pair = keys()
    const risk = {
      assertNotRateLimited: vi.fn(),
      recordAttempt: vi.fn(),
      evaluateCodeRisk: vi.fn(),
    }
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    }, risk as never)
    service.seedActivationCode({
      codeHash: hashActivationCode("ABCD-1234"),
      maxDevices: 1,
      reservedEmail: "allowed@example.com",
    })

    await expect(service.redeem({
      email: "other@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
      ...requestSource,
    })).rejects.toMatchObject({
      code: "ACTIVATION_RESERVED_MISMATCH",
    })

    expect(risk.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "reserved_mismatch",
    }))
    expect(risk.evaluateCodeRisk).toHaveBeenCalled()
  })
})

interface TestableLicenseService {
  readonly repository: {
    readonly activations: Map<string, { status: ManagedStatus; riskLockedAt?: Date | null }>
    readonly devices: Map<string, { status: "active" | "revoked" }>
  }
}
