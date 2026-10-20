import { describe, expect, it } from "vitest"
import { driveSearchFileType, driveSearchTerms, parseDriveSearchFilters } from "./drive-search.js"

describe("Drive search filters", () => {
  it("normalizes compatibility characters, case and literal punctuation", () => {
    expect(driveSearchTerms(" ＴＥＳＴ 设计_% ")).toEqual(["test", "设计_%"])
    expect(parseDriveSearchFilters({ query: " ＴＥＳＴ ", updatedAfter: "2026-10-01T08:00:00+08:00" })).toEqual({ query: "test", updatedAfter: "2026-10-01T00:00:00.000Z" })
    expect(driveSearchFileType({ type: "file", name: "图片.ＰＮＧ", mimeType: null })).toBe("image")
    expect(driveSearchFileType({ type: "file", name: "data.bin", mimeType: "text/markdown; charset=utf-8" })).toBe("document")
  })
  it("rejects impossible dates and malformed conditions consistently", () => {
    for (const updatedAfter of ["2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-10-01", "2026-10-01T24:00:00Z", "2026-10-01T00:00:00+25:00"]) {
      expect(() => parseDriveSearchFilters({ updatedAfter })).toThrow()
    }
    expect(parseDriveSearchFilters({ updatedAfter: "2024-02-29T00:00:00Z" }).updatedAfter).toBe("2024-02-29T00:00:00.000Z")
    expect(() => parseDriveSearchFilters({ query: ["x"] })).toThrow()
    expect(() => parseDriveSearchFilters({ query: "x".repeat(201) })).toThrow()
    expect(() => parseDriveSearchFilters({ fileType: "video" })).toThrow()
  })
})
