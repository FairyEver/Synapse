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

  it("creates fixed-length public asset ids", () => {
    expect(createDrivePublicAssetId()).toMatch(/^asset_[0-9A-Za-z]{32}$/u)
    expect(createDrivePublicAssetId()).toHaveLength(38)
  })

  it("creates URL-safe Drive site ids", () => {
    expect(createDriveSiteId()).toMatch(/^site_[A-Za-z0-9_-]{32,}$/u)
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
