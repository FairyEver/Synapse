import { describe, expect, it } from "vitest"
import {
  createDrivePublicAssetId,
  createDriveShareId,
  createDriveSiteId,
  driveOverwriteStorageKeyForSession,
  driveStorageKeyForItem,
  isValidDriveItemName,
} from "./drive-token"

describe("drive token helpers", () => {
  it("creates URL-safe share ids", () => {
    expect(createDriveShareId()).toMatch(/^shr_[A-Za-z0-9_-]{32,}$/u)
  })

  it("creates share ids without look-alike characters", () => {
    // 无歧义字母表：没有 I/L/O/U，长度仍是 32。少一个字符的链接会 404，
    // 而这两个字符正是被读错的那一对。
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const id = createDriveShareId()
      expect(id).toMatch(/^shr_[0-9A-HJKMNP-TV-Z]{32}$/u)
      expect(id).toHaveLength(36)
    }
  })

  it("creates fixed-length public asset ids", () => {
    expect(createDrivePublicAssetId()).toMatch(/^asset_[0-9A-Za-z]{32}$/u)
    expect(createDrivePublicAssetId()).toHaveLength(38)
  })

  it("creates URL-safe Drive site ids", () => {
    expect(createDriveSiteId()).toMatch(/^site_[A-Za-z0-9_-]{32,}$/u)
  })

  it("creates Drive site ids without look-alike characters", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const id = createDriveSiteId()
      expect(id).toMatch(/^site_[0-9A-HJKMNP-TV-Z]{32}$/u)
      expect(id).toHaveLength(37)
    }
  })

  it("builds storage keys from server item ids", () => {
    expect(driveStorageKeyForItem("item_123")).toBe("drive/item_123")
  })

  it("builds item-scoped overwrite storage keys", () => {
    expect(driveOverwriteStorageKeyForSession("item_123", "session_456")).toBe("drive/item_123/overwrites/session_456")
  })

  it("accepts normal file names", () => {
    expect(isValidDriveItemName("handoff.docx")).toBe(true)
  })

  it("rejects empty names and path separators", () => {
    expect(isValidDriveItemName("")).toBe(false)
    expect(isValidDriveItemName("../secret")).toBe(false)
    expect(isValidDriveItemName("a/b.txt")).toBe(false)
  })

  it("rejects Windows-unsafe item names", () => {
    for (const name of [
      "CON",
      "NUL.txt",
      "COM1",
      "LPT9.log",
      "report.",
      "report ",
      "bad:name.txt",
      "bad|name.txt",
      "bad\u0001name.txt",
    ]) {
      expect(isValidDriveItemName(name)).toBe(false)
    }
  })
})
