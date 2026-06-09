import { describe, expect, it } from "vitest"
import {
  DRIVE_PUBLIC_PATH_PREFIX,
  buildDrivePublicationUrl,
  buildDriveShareUrl,
  maskDrivePublicUrl,
  maskDriveShareUrl,
} from "./drive"

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

  it("builds public drive page publication URLs", () => {
    expect(buildDrivePublicationUrl({
      publicAppUrl: "https://synapse.d2.pub/",
      publishId: "pub_abc",
      type: "page",
    })).toBe("https://synapse.d2.pub/pages/pub_abc")
  })

  it("builds public drive site publication URLs", () => {
    expect(buildDrivePublicationUrl({
      publicAppUrl: "https://synapse.d2.pub",
      publishId: "pub_a/b",
      type: "site",
    })).toBe("https://synapse.d2.pub/sites/pub_a%2Fb/")
  })

  it("masks drive publication URLs for logs", () => {
    expect(maskDrivePublicUrl("https://synapse.d2.pub/pages/pub_secret"))
      .toBe("https://synapse.d2.pub/pages/***")
    expect(maskDrivePublicUrl("https://synapse.d2.pub/sites/pub_secret/app.js"))
      .toBe("https://synapse.d2.pub/sites/***/app.js")
  })

  it("uses the files public prefix", () => {
    expect(DRIVE_PUBLIC_PATH_PREFIX).toBe("/files")
  })
})
