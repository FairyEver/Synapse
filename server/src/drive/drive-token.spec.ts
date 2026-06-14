import { describe, expect, it } from "vitest"
import {
  createDrivePublishId,
  createDriveShareId,
  drivePublicationStorageKey,
  driveStorageKeyForItem,
  isValidDriveItemName,
} from "./drive-token"

describe("drive token helpers", () => {
  it("creates URL-safe share ids", () => {
    expect(createDriveShareId()).toMatch(/^shr_[A-Za-z0-9_-]{32,}$/u)
  })

  it("creates URL-safe publish ids", () => {
    expect(createDrivePublishId()).toMatch(/^pub_[A-Za-z0-9_-]{32,}$/u)
  })

  it("builds storage keys from server item ids", () => {
    expect(driveStorageKeyForItem("item_123")).toBe("drive/item_123")
  })

  it("builds publication storage keys", () => {
    expect(drivePublicationStorageKey({
      publicationId: "pub-row-1",
      deploymentId: "dep-1",
      relativePath: "assets/app.js",
    })).toBe("drive-publications/pub-row-1/dep-1/assets/app.js")
  })

  it("rejects unsafe publication relative paths", () => {
    expect(() => drivePublicationStorageKey({
      publicationId: "pub-row-1",
      deploymentId: "dep-1",
      relativePath: "../secret.txt",
    })).toThrow("Invalid drive publication relative path.")
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
