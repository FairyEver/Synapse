import { describe, expect, it } from "vitest"
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  DRIVE_CONSOLE_BROWSER_PATH_PREFIX,
  DRIVE_OWNER_BROWSER_PATH_PREFIX,
  DRIVE_PUBLIC_PATH_PREFIX,
  DRIVE_SHARE_BROWSER_PATH_PREFIX,
  buildConsoleDriveBrowserUrl,
  buildConsoleDriveChildBrowserUrl,
  buildConsoleDriveRootUrl,
  buildDrivePublicationUrl,
  buildDriveShareUrl,
  buildDriveUrlWithPassword,
  buildOwnerDriveBrowserUrl,
  buildOwnerDriveChildBrowserUrl,
  buildOwnerDriveChildDownloadUrl,
  buildOwnerDriveChildRenderUrl,
  buildOwnerDriveChildZipUrl,
  buildOwnerDriveDownloadUrl,
  buildOwnerDriveRenderUrl,
  buildOwnerDriveZipUrl,
  buildShareDriveBrowserUrl,
  buildShareDriveChildZipUrl,
  buildShareDriveDownloadUrl,
  buildShareDriveZipUrl,
  type DriveBrowserPreviewKind,
  maskDriveBrowserUrl,
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

  it("builds owner browser URLs with root and child item ids", () => {
    expect(buildOwnerDriveBrowserUrl("root/a")).toBe("/drive/items/root%2Fa")
    expect(buildOwnerDriveChildBrowserUrl("root/a", "child/b")).toBe("/drive/items/root%2Fa/items/child%2Fb")
    expect(buildOwnerDriveDownloadUrl("root/a")).toBe("/drive/items/root%2Fa/download")
    expect(buildOwnerDriveChildDownloadUrl("root/a", "child/b")).toBe("/drive/items/root%2Fa/items/child%2Fb/download")
    expect(buildOwnerDriveZipUrl("root/a")).toBe("/drive/items/root%2Fa/zip")
    expect(buildOwnerDriveChildZipUrl("root/a", "child/b")).toBe("/drive/items/root%2Fa/items/child%2Fb/zip")
    expect(buildOwnerDriveRenderUrl("root/a")).toBe("/drive/items/root%2Fa/render")
    expect(buildOwnerDriveChildRenderUrl("root/a", "child/b")).toBe("/drive/items/root%2Fa/items/child%2Fb/render")
  })

  it("builds console drive browser URLs with the same child pattern", () => {
    expect(buildConsoleDriveRootUrl()).toBe("/console/drive")
    expect(buildConsoleDriveBrowserUrl("root/a")).toBe("/console/drive/items/root%2Fa")
    expect(buildConsoleDriveChildBrowserUrl("root/a", "child/b"))
      .toBe("/console/drive/items/root%2Fa/items/child%2Fb")
  })

  it("builds share browser URLs with root and child item ids", () => {
    expect(buildShareDriveBrowserUrl("shr/a")).toBe("/files/shr%2Fa")
    expect(buildShareDriveBrowserUrl("shr/a", "child/b")).toBe("/files/shr%2Fa/items/child%2Fb")
    expect(buildShareDriveDownloadUrl("shr/a")).toBe("/files/shr%2Fa/download")
    expect(buildShareDriveDownloadUrl("shr/a", "child/b")).toBe("/files/shr%2Fa/items/child%2Fb/download")
    expect(buildShareDriveZipUrl("shr/a")).toBe("/files/shr%2Fa/zip")
    expect(buildShareDriveChildZipUrl("shr/a", "child/b")).toBe("/files/shr%2Fa/items/child%2Fb/zip")
  })

  it("masks share URL ids for logs", () => {
    expect(maskDriveShareUrl("https://synapse.d2.pub/files/shr_secret"))
      .toBe("https://synapse.d2.pub/files/***")
    expect(maskDriveShareUrl("https://synapse.d2.pub/files/shr_secret/items/item_secret/download"))
      .toBe("https://synapse.d2.pub/files/***/items/***/download")
  })

  it("masks owner and console browser URL ids for logs", () => {
    expect(maskDriveBrowserUrl("/drive/items/root_secret/items/item_secret/render"))
      .toBe("/drive/items/***/items/***/render")
    expect(maskDriveBrowserUrl("https://synapse.d2.pub/console/drive/items/root_secret/items/item_secret"))
      .toBe("https://synapse.d2.pub/console/drive/items/***/items/***")
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

  it("builds password-bearing relative drive URLs", () => {
    expect(buildDriveUrlWithPassword("/files/shr_abc", "AbC234xy"))
      .toBe("/files/shr_abc?password=AbC234xy")
    expect(buildDriveUrlWithPassword("/files/shr_abc?password=old#top", "new"))
      .toBe("/files/shr_abc?password=new#top")
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

  it("redacts drive password query values case-insensitively", () => {
    expect(maskDriveShareUrl("https://synapse.d2.pub/files/shr_secret?Password=AbC234xy"))
      .toBe("https://synapse.d2.pub/files/***?Password=***")
  })

  it("defines the default drive access settings", () => {
    expect(DRIVE_DEFAULT_ACCESS_SETTINGS).toEqual({ passwordEnabled: true, expiresIn: "3d" })
  })

  it("allows markdown as a drive browser preview kind", () => {
    const kind: DriveBrowserPreviewKind = "markdown"

    expect(kind).toBe("markdown")
  })

  it("uses the files public prefix", () => {
    expect(DRIVE_PUBLIC_PATH_PREFIX).toBe("/files")
    expect(DRIVE_SHARE_BROWSER_PATH_PREFIX).toBe("/files")
    expect(DRIVE_OWNER_BROWSER_PATH_PREFIX).toBe("/drive/items")
    expect(DRIVE_CONSOLE_BROWSER_PATH_PREFIX).toBe("/console/drive")
  })
})
