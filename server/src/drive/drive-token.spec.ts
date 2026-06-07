import { describe, expect, it } from "vitest"
import { createDriveShareId, driveStorageKeyForItem, isValidDriveItemName } from "./drive-token"

describe("drive token helpers", () => {
  it("creates URL-safe share ids", () => {
    expect(createDriveShareId()).toMatch(/^shr_[A-Za-z0-9_-]{32,}$/u)
  })

  it("builds storage keys from server item ids", () => {
    expect(driveStorageKeyForItem("item_123")).toBe("drive/item_123")
  })

  it("accepts normal file names", () => {
    expect(isValidDriveItemName("handoff.docx")).toBe(true)
  })

  it("rejects empty names and path separators", () => {
    expect(isValidDriveItemName("")).toBe(false)
    expect(isValidDriveItemName("../secret")).toBe(false)
    expect(isValidDriveItemName("a/b.txt")).toBe(false)
  })
})
