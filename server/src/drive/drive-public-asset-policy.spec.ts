import { describe, expect, it } from "vitest"
import { detectPublicAssetImageType, validatePublicAssetNameAndMime } from "./drive-public-asset-policy"

describe("public asset policy", () => {
  it("accepts png names and mime", () => {
    expect(validatePublicAssetNameAndMime({ name: "logo.png", mimeType: "image/png" })).toEqual({
      extension: "png",
      mimeType: "image/png",
    })
  })

  it("rejects svg", () => {
    expect(() => validatePublicAssetNameAndMime({ name: "logo.svg", mimeType: "image/svg+xml" })).toThrow(
      "仅支持图片",
    )
  })

  it("detects png signature", () => {
    expect(detectPublicAssetImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    )
  })
})
