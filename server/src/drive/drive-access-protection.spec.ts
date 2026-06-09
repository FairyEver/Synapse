import { describe, expect, it } from "vitest"
import {
  buildDriveAccessCookie,
  computeDriveAccessExpiresAt,
  decryptDrivePassword,
  encryptDrivePassword,
  generateDrivePassword,
  verifyDriveAccessCookie,
} from "./drive-access-protection"

const secret = "user-secret-with-enough-length-32chars"

describe("drive access protection", () => {
  it("generates eight readable characters without ambiguous symbols", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(generateDrivePassword()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$/u)
    }
  })

  it("computes expiration presets", () => {
    const now = new Date("2026-06-09T00:00:00.000Z")
    expect(computeDriveAccessExpiresAt("7d", now)?.toISOString()).toBe("2026-06-16T00:00:00.000Z")
    expect(computeDriveAccessExpiresAt("30d", now)?.toISOString()).toBe("2026-07-09T00:00:00.000Z")
    expect(computeDriveAccessExpiresAt("1y", now)?.toISOString()).toBe("2027-06-09T00:00:00.000Z")
    expect(computeDriveAccessExpiresAt("forever", now)).toBeNull()
  })

  it("encrypts and decrypts readable passwords", () => {
    const encrypted = encryptDrivePassword("AbC234xy", secret)
    expect(encrypted).not.toContain("AbC234xy")
    expect(decryptDrivePassword(encrypted, secret)).toBe("AbC234xy")
  })

  it("binds access cookies to resource identity", () => {
    const cookie = buildDriveAccessCookie({
      kind: "share",
      publicId: "shr_abc",
      expiresAt: new Date("2026-06-16T00:00:00.000Z"),
      secret,
    })
    expect(verifyDriveAccessCookie(cookie, {
      kind: "share",
      publicId: "shr_abc",
      now: new Date("2026-06-10T00:00:00.000Z"),
      resourceExpiresAt: new Date("2026-06-16T00:00:00.000Z"),
      secret,
    })).toBe(true)
    expect(verifyDriveAccessCookie(cookie, {
      kind: "share",
      publicId: "shr_other",
      now: new Date("2026-06-10T00:00:00.000Z"),
      resourceExpiresAt: new Date("2026-06-16T00:00:00.000Z"),
      secret,
    })).toBe(false)
  })
})
