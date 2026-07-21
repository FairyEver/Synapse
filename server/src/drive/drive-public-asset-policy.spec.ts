import { describe, expect, it } from "vitest"
import { DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION, DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE } from "@synapse/shared"
import { detectPublicAssetImageType, matchesPublicAssetContentSignature, validatePublicAssetNameAndMime } from "./drive-public-asset-policy"

describe("public asset policy", () => {
  it("accepts png names and mime", () => {
    expect(validatePublicAssetNameAndMime({ name: "logo.png", mimeType: "image/png" })).toEqual({
      extension: "png",
      mimeType: "image/png",
    })
  })

  it("accepts display names without an image extension when MIME is supported", () => {
    expect(validatePublicAssetNameAndMime({ name: "logo", mimeType: "image/png" })).toEqual({
      extension: null,
      mimeType: "image/png",
    })
  })

  it("rejects svg", () => {
    expect(() => validatePublicAssetNameAndMime({ name: "logo.svg", mimeType: "image/svg+xml" })).toThrow(
      DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE,
    )
  })

  it("accepts supported document names and MIME types", () => {
    for (const [extension, mimeType] of Object.entries(DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION)) {
      expect(validatePublicAssetNameAndMime({ name: `document.${extension}`, mimeType })).toEqual({ extension, mimeType })
    }
  })

  it("rejects unsupported active content with the shared format message", () => {
    expect(() => validatePublicAssetNameAndMime({ name: "page.html", mimeType: "text/html" })).toThrow(
      DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE,
    )
  })

  it("rejects extension and MIME mismatches", () => {
    expect(() => validatePublicAssetNameAndMime({ name: "report.pdf", mimeType: "text/plain" })).toThrow(
      "文件类型与扩展名不匹配。",
    )
  })

  it("detects png signature", () => {
    expect(detectPublicAssetImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    )
  })

  it("validates PDF, Office Open XML, and UTF-8 text signatures", () => {
    expect(matchesPublicAssetContentSignature(Buffer.from("%PDF-1.7\n"), DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.pdf)).toBe(true)
    expect(matchesPublicAssetContentSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04]), DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.docx)).toBe(true)
    expect(matchesPublicAssetContentSignature(Buffer.from("# 说明\n", "utf8"), DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.md)).toBe(true)
  })

  it("rejects spoofed document signatures and binary text", () => {
    expect(matchesPublicAssetContentSignature(Buffer.from("not a PDF"), DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.pdf)).toBe(false)
    expect(matchesPublicAssetContentSignature(Buffer.from("not a zip"), DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.xlsx)).toBe(false)
    expect(matchesPublicAssetContentSignature(Buffer.from([0x61, 0x00, 0x62]), DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.txt)).toBe(false)
    expect(matchesPublicAssetContentSignature(Buffer.from([0xff, 0xfe, 0xfd]), DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.csv)).toBe(false)
  })
})
