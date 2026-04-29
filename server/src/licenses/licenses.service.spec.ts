import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"
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
    })

    await expect(service.redeem({
      email: "second@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-2", name: "ThinkPad", platform: "win32", appVersion: "0.2.54" },
    })).rejects.toThrow("激活码已绑定其他账号。")
  })

  it("rejects a second device when maxDevices is one", async () => {
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
    })

    await expect(service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-2", name: "ThinkPad", platform: "win32", appVersion: "0.2.54" },
    })).rejects.toThrow("设备数量已达上限。")
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
    })

    const repository = (service as unknown as TestableLicenseService).repository
    const device = [...repository.devices.values()][0]
    if (!device) throw new Error("Redeemed device is missing")
    device.status = "revoked"

    await expect(service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.55" },
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
})

interface TestableLicenseService {
  readonly repository: {
    readonly activations: Map<string, { status: ManagedStatus }>
    readonly devices: Map<string, { status: "active" | "revoked" }>
  }
}
