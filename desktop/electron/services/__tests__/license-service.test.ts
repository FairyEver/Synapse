import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import type {
  CoreLicenseV1,
  DataChangeListener,
  DataNamespace,
} from "../../runtime/data-repo"
import { hashDeviceId } from "../license/device-id"
import type { LicenseClient } from "../license/license-client"
import { LicenseService } from "../license/license-service"
import type { LicenseLeasePayload } from "../license/types"

describe("LicenseService", () => {
  it("accepts a stored signed lease without network", async () => {
    const keys = createKeys()
    const deviceId = "device-1"
    const leaseToken = signLease({
      tokenId: "token-1",
      accountId: "account-1",
      email: "user@example.com",
      licenseId: "license-1",
      deviceIdHash: hashDeviceId(deviceId),
      issuedAt: "2026-04-29T00:00:00.000Z",
      expiresAt: "2026-05-29T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "key-1",
    }, keys.privateKey)
    const store = new MemoryNamespace<CoreLicenseV1>({
      id: "license",
      schemaVersion: 1,
      deviceId,
      deviceIdHash: hashDeviceId(deviceId),
      serverUrl: "http://localhost:3000",
      email: "user@example.com",
      publicKey: keys.publicKey,
      keyId: "key-1",
      leaseToken,
      leaseExpiresAt: "2026-05-29T00:00:00.000Z",
      activatedAt: "2026-04-29T00:00:00.000Z",
      lastRenewedAt: "2026-04-29T00:00:00.000Z",
    })
    const client = {
      getConfig: vi.fn(),
      redeem: vi.fn(),
      renew: vi.fn(),
    } as unknown as LicenseClient

    const service = new LicenseService({
      store,
      client,
      appVersion: "0.0.0",
      now: () => new Date("2026-04-30T00:00:00.000Z"),
    })

    await expect(service.getStatus()).resolves.toMatchObject({
      status: "active",
      email: "user@example.com",
    })
    expect(client.getConfig).not.toHaveBeenCalled()
  })

  it("stores activation response as an offline lease", async () => {
    const keys = createKeys()
    const deviceId = "device-1"
    const leaseToken = signLease({
      tokenId: "token-1",
      accountId: "account-1",
      email: "user@example.com",
      licenseId: "license-1",
      deviceIdHash: hashDeviceId(deviceId),
      issuedAt: "2026-04-29T00:00:00.000Z",
      expiresAt: "2026-05-29T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "key-1",
    }, keys.privateKey)
    const store = new MemoryNamespace<CoreLicenseV1>(null)
    const client = {
      getConfig: vi.fn().mockResolvedValue({
        keyId: "key-1",
        leaseDays: 30,
        serverTime: "2026-04-29T00:00:00.000Z",
        publicKey: keys.publicKey,
      }),
      redeem: vi.fn().mockResolvedValue({
        email: "user@example.com",
        deviceIdHash: hashDeviceId(deviceId),
        leaseToken,
      }),
      renew: vi.fn(),
    } as unknown as LicenseClient

    const service = new LicenseService({
      store,
      client,
      appVersion: "0.0.0",
      idFactory: () => deviceId,
      now: () => new Date("2026-04-29T00:00:00.000Z"),
    })

    await expect(service.activate({
      serverUrl: "http://localhost:3000",
      email: "USER@EXAMPLE.COM",
      activationCode: "ABCD-1234",
    })).resolves.toMatchObject({
      status: "active",
      email: "user@example.com",
    })

    await expect(store.getSingleton()).resolves.toMatchObject({
      email: "user@example.com",
      leaseToken,
      publicKey: keys.publicKey,
    })
  })

  it("resets activation while preserving the local device id", async () => {
    const keys = createKeys()
    const deviceId = "device-1"
    const leaseToken = signLease({
      tokenId: "token-1",
      accountId: "account-1",
      email: "user@example.com",
      licenseId: "license-1",
      deviceIdHash: hashDeviceId(deviceId),
      issuedAt: "2026-04-29T00:00:00.000Z",
      expiresAt: "2026-05-29T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "key-1",
    }, keys.privateKey)
    const store = new MemoryNamespace<CoreLicenseV1>({
      id: "license",
      schemaVersion: 1,
      deviceId,
      deviceIdHash: hashDeviceId(deviceId),
      serverUrl: "http://localhost:3000",
      email: "user@example.com",
      publicKey: keys.publicKey,
      keyId: "key-1",
      leaseToken,
      leaseExpiresAt: "2026-05-29T00:00:00.000Z",
      activatedAt: "2026-04-29T00:00:00.000Z",
      lastRenewedAt: "2026-04-29T00:00:00.000Z",
    })
    const client = {
      getConfig: vi.fn(),
      redeem: vi.fn(),
      renew: vi.fn(),
    } as unknown as LicenseClient

    const service = new LicenseService({
      store,
      client,
      appVersion: "0.0.0",
      now: () => new Date("2026-04-30T00:00:00.000Z"),
    })

    await expect(service.resetActivation()).resolves.toMatchObject({
      status: "not_activated",
      email: null,
      serverUrl: null,
      deviceIdHash: null,
    })
    await expect(store.getSingleton()).resolves.toMatchObject({
      deviceId,
      deviceIdHash: null,
      serverUrl: null,
      email: null,
      publicKey: null,
      keyId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      activatedAt: null,
      lastRenewedAt: null,
    })
  })

  it("clears a stored lease when startup validation is rejected by the server", async () => {
    const keys = createKeys()
    const deviceId = "device-1"
    const leaseToken = signLease({
      tokenId: "token-1",
      accountId: "account-1",
      email: "user@example.com",
      licenseId: "license-1",
      deviceIdHash: hashDeviceId(deviceId),
      issuedAt: "2026-04-29T00:00:00.000Z",
      expiresAt: "2026-05-29T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "key-1",
    }, keys.privateKey)
    const store = new MemoryNamespace<CoreLicenseV1>({
      id: "license",
      schemaVersion: 1,
      deviceId,
      deviceIdHash: hashDeviceId(deviceId),
      serverUrl: "http://localhost:3000",
      email: "user@example.com",
      publicKey: keys.publicKey,
      keyId: "key-1",
      leaseToken,
      leaseExpiresAt: "2026-05-29T00:00:00.000Z",
      activatedAt: "2026-04-29T00:00:00.000Z",
      lastRenewedAt: "2026-04-29T00:00:00.000Z",
    })
    const rejection = Object.assign(new Error("License is not active"), { status: 403 })
    const client = {
      getConfig: vi.fn().mockResolvedValue({
        keyId: "key-1",
        leaseDays: 30,
        serverTime: "2026-04-30T00:00:00.000Z",
        publicKey: keys.publicKey,
      }),
      validate: vi.fn().mockRejectedValue(rejection),
      redeem: vi.fn(),
      renew: vi.fn(),
    } as unknown as LicenseClient

    const service = new LicenseService({
      store,
      client,
      appVersion: "0.0.0",
      now: () => new Date("2026-04-30T00:00:00.000Z"),
    })

    try {
      service.start()
      await flushPromises()

      await expect(service.getStatus()).resolves.toMatchObject({
        status: "not_activated",
      })
      await expect(store.getSingleton()).resolves.toMatchObject({
        leaseToken: null,
        leaseExpiresAt: null,
      })
      expect(client.validate).toHaveBeenCalledTimes(1)
      expect(client.renew).not.toHaveBeenCalled()
    } finally {
      service.stop()
    }
  })
})

function createKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  return {
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
  }
}

function signLease(payload: LicenseLeasePayload, privateKeyPem: string): string {
  const encodedPayload = encode(payload)
  const signature = sign(null, Buffer.from(encodedPayload), createPrivateKey(privateKeyPem))
  return encode({
    payload,
    signature: signature.toString("base64url"),
  })
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly name = "core.license"
  readonly schemaVersion = 1
  readonly backend = "encrypted-json" as const

  constructor(private singleton: T | null) {}

  async getSingleton(): Promise<T | null> {
    return this.singleton
  }

  async setSingleton(value: T): Promise<void> {
    this.singleton = value
  }

  async list(): Promise<T[]> {
    return this.singleton ? [this.singleton] : []
  }

  async get(id: string): Promise<T | null> {
    return this.singleton && this.singleton.id === id ? this.singleton : null
  }

  async upsert(item: T & { id: string }): Promise<void> {
    this.singleton = item
  }

  async remove(): Promise<void> {
    this.singleton = null
  }

  onChange(_listener: DataChangeListener<T>): () => void {
    return () => undefined
  }
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
