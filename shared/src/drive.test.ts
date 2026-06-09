import { describe, expect, it } from "vitest"
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  DRIVE_PUBLIC_PATH_PREFIX,
  buildDrivePublicationUrl,
  buildDriveShareUrl,
  buildDriveUrlWithPassword,
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

  it("builds password-bearing drive URLs", () => {
    expect(buildDriveUrlWithPassword("https://synapse.d2.pub/files/shr_abc", "AbC234xy"))
      .toBe("https://synapse.d2.pub/files/shr_abc?password=AbC234xy")
    expect(buildDriveUrlWithPassword("https://synapse.d2.pub/sites/pub_abc/?x=1", "AbC234xy"))
      .toBe("https://synapse.d2.pub/sites/pub_abc/?x=1&password=AbC234xy")
  })

  it("does not add a password query when the password is null", () => {
    expect(buildDriveUrlWithPassword("https://synapse.d2.pub/files/shr_abc", null))
      .toBe("https://synapse.d2.pub/files/shr_abc")
  })

  it("redacts drive password query values", () => {
    expect(maskDriveShareUrl("https://synapse.d2.pub/files/shr_secret?password=AbC234xy"))
      .toBe("https://synapse.d2.pub/files/***?password=***")
    expect(maskDrivePublicUrl("https://synapse.d2.pub/sites/pub_secret/app.js?password=AbC234xy"))
      .toBe("https://synapse.d2.pub/sites/***/app.js?password=***")
  })

  it("defines the default drive access settings", () => {
    expect(DRIVE_DEFAULT_ACCESS_SETTINGS).toEqual({ passwordEnabled: true, expiresIn: "7d" })
  })

  it("uses the files public prefix", () => {
    expect(DRIVE_PUBLIC_PATH_PREFIX).toBe("/files")
  })
})
