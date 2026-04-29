import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"
import { hashActivationCode, hashDeviceId } from "./hash"
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
    })).rejects.toThrow("Activation code is already bound")
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
    })).rejects.toThrow("Device limit reached")
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
})
