import { describe, expect, it } from "vitest"
import { findPinnedKey, hasPinnedKeys } from "../pinned-keys"

describe("pinned-keys", () => {
  it("finds the production key by keyId", () => {
    const key = findPinnedKey("prod-key-001")
    expect(key).not.toBeNull()
    expect(key!.keyId).toBe("prod-key-001")
    expect(key!.publicKey).toContain("-----BEGIN PUBLIC KEY-----")
  })

  it("returns null for unknown keyId", () => {
    expect(findPinnedKey("unknown-key")).toBeNull()
  })

  it("reports pinned keys exist", () => {
    expect(hasPinnedKeys()).toBe(true)
  })
})
