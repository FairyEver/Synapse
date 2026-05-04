import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"
import { hashActivationCode, hashDeviceId } from "./hash"
import { signLicenseLease, verifyLicenseLease } from "./license-token"
import type { LicenseLeasePayload } from "./license.types"

function keyPair(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("ed25519")
  return {
    privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: pair.publicKey.export({ format: "pem", type: "spki" }).toString(),
  }
}

describe("license token", () => {
  it("signs and verifies a lease payload", () => {
    const keys = keyPair()
    const payload: LicenseLeasePayload = {
      tokenId: "lease_1",
      accountId: "account_1",
      email: "user@example.com",
      licenseId: "license_1",
      deviceIdHash: hashDeviceId("device-1"),
      issuedAt: "2026-04-29T00:00:00.000Z",
      expiresAt: "2026-05-06T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "test-key",
    }

    const token = signLicenseLease(payload, keys.privateKey)
    expect(verifyLicenseLease(token, keys.publicKey)).toEqual(payload)
  })

  it("rejects a tampered token", () => {
    const keys = keyPair()
    const payload: LicenseLeasePayload = {
      tokenId: "lease_1",
      accountId: "account_1",
      email: "user@example.com",
      licenseId: "license_1",
      deviceIdHash: hashDeviceId("device-1"),
      issuedAt: "2026-04-29T00:00:00.000Z",
      expiresAt: "2026-05-06T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "test-key",
    }

    const token = signLicenseLease(payload, keys.privateKey)
    const envelope = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      payload: LicenseLeasePayload
      signature: string
    }
    const tampered = Buffer.from(JSON.stringify({
      ...envelope,
      payload: {
        ...envelope.payload,
        email: "root@example.com",
      },
    }), "utf8").toString("base64url")

    expect(() => verifyLicenseLease(tampered, keys.publicKey)).toThrow("授权签名无效。")
  })

  it("rejects an expired token", () => {
    const keys = keyPair()
    const payload: LicenseLeasePayload = {
      tokenId: "lease_1",
      accountId: "account_1",
      email: "user@example.com",
      licenseId: "license_1",
      deviceIdHash: hashDeviceId("device-1"),
      issuedAt: "2024-01-01T00:00:00.000Z",
      expiresAt: "2024-01-08T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "test-key",
    }

    const token = signLicenseLease(payload, keys.privateKey)
    expect(() => verifyLicenseLease(token, keys.publicKey)).toThrow("授权已过期。")
  })

  it("normalizes activation code hashes", () => {
    expect(hashActivationCode(" ABCD-1234 ")).toBe(hashActivationCode("abcd-1234"))
  })
})
