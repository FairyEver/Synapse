import { describe, expect, it } from "vitest"
import { DRIVE_PUBLIC_PATH_PREFIX, buildDriveShareUrl, maskDriveShareUrl } from "./drive"

describe("drive URL helpers", () => {
  it("builds public drive share URLs", () => {
    expect(buildDriveShareUrl({ publicAppUrl: "https://synapse.d2.pub/", shareId: "shr_abc" }))
      .toBe("https://synapse.d2.pub/files/shr_abc")
  })

  it("encodes share ids", () => {
    expect(buildDriveShareUrl({ publicAppUrl: "https://synapse.d2.pub", shareId: "shr_a/b" }))
      .toBe("https://synapse.d2.pub/files/shr_a%2Fb")
  })

  it("masks share URL ids for logs", () => {
    expect(maskDriveShareUrl("https://synapse.d2.pub/files/shr_secret"))
      .toBe("https://synapse.d2.pub/files/***")
  })

  it("uses the files public prefix", () => {
    expect(DRIVE_PUBLIC_PATH_PREFIX).toBe("/files")
  })
})
