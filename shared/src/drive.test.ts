import { describe, expect, it } from "vitest"
import {
  DRIVE_DEFAULT_QUOTA_BYTES,
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  DRIVE_MAX_FILE_BYTES,
  DRIVE_CONSOLE_BROWSER_PATH_PREFIX,
  DRIVE_OWNER_BROWSER_PATH_PREFIX,
  DRIVE_PUBLIC_PATH_PREFIX,
  DRIVE_SHARE_BROWSER_PATH_PREFIX,
  buildConsoleDriveBrowserUrl,
  buildConsoleDriveItemBrowserUrl,
  buildConsoleDriveRootUrl,
  buildDriveShareUrl,
  buildDriveUrlWithPassword,
  buildOwnerDriveBrowserUrl,
  buildOwnerDriveDownloadUrl,
  buildOwnerDriveRenderUrl,
  buildShareDriveBrowserUrl,
  buildShareDriveDownloadUrl,
  buildShareDriveRenderUrl,
  type DriveBrowserPreviewKind,
  maskDriveBrowserUrl,
  maskDriveShareUrl,
} from "./drive"

describe("drive URL helpers", () => {
  it("builds public drive share URLs", () => {
    expect(buildDriveShareUrl({ publicAppUrl: "https://synapse.d2.pub/", shareId: "shr_abc" }))
      .toBe("https://synapse.d2.pub/share/shr_abc")
  })

  it("encodes share ids", () => {
    expect(buildDriveShareUrl({ publicAppUrl: "https://synapse.d2.pub", shareId: "shr_a/b" }))
      .toBe("https://synapse.d2.pub/share/shr_a%2Fb")
  })

  it("builds owner browser URLs with a single item id", () => {
    expect(buildOwnerDriveBrowserUrl("item/a")).toBe("/drive/items/item%2Fa")
    expect(buildOwnerDriveDownloadUrl("item/a")).toBe("/drive/items/item%2Fa/download")
    expect(buildOwnerDriveRenderUrl("item/a")).toBe("/drive/items/item%2Fa/render")
  })

  it("builds console drive browser URLs for folders", () => {
    expect(buildConsoleDriveRootUrl()).toBe("/console/drive")
    expect(buildConsoleDriveBrowserUrl("folder/a")).toBe("/console/drive/folders/folder%2Fa")
  })

  it("builds console drive browser URLs for files", () => {
    expect(buildConsoleDriveItemBrowserUrl("item/a")).toBe("/console/drive/items/item%2Fa?surface=console")
  })

  it("builds share browser URLs with root and child item ids", () => {
    expect(buildShareDriveBrowserUrl("shr/a")).toBe("/share/shr%2Fa")
    expect(buildShareDriveBrowserUrl("shr/a", "child/b")).toBe("/share/shr%2Fa/items/child%2Fb")
    expect(buildShareDriveDownloadUrl("shr/a")).toBe("/share/shr%2Fa/download")
    expect(buildShareDriveDownloadUrl("shr/a", "child/b")).toBe("/share/shr%2Fa/items/child%2Fb/download")
    expect(buildShareDriveRenderUrl("shr/a")).toBe("/share/shr%2Fa/render")
    expect(buildShareDriveRenderUrl("shr/a", "child/b")).toBe("/share/shr%2Fa/items/child%2Fb/render")
  })

  it("masks share URL ids for logs", () => {
    expect(maskDriveShareUrl("https://synapse.d2.pub/share/shr_secret"))
      .toBe("https://synapse.d2.pub/share/***")
    expect(maskDriveShareUrl("https://synapse.d2.pub/share/shr_secret/items/item_secret/download"))
      .toBe("https://synapse.d2.pub/share/***/items/***/download")
  })

  it("masks owner and console browser URL ids for logs", () => {
    expect(maskDriveBrowserUrl("/drive/items/item_secret/render"))
      .toBe("/drive/items/***/render")
    expect(maskDriveBrowserUrl("https://synapse.d2.pub/console/drive/folders/folder_secret"))
      .toBe("https://synapse.d2.pub/console/drive/folders/***")
    expect(maskDriveBrowserUrl("https://synapse.d2.pub/console/drive/items/item_secret?surface=console"))
      .toBe("https://synapse.d2.pub/console/drive/items/***?surface=console")
  })

  it("builds password-bearing drive URLs", () => {
    expect(buildDriveUrlWithPassword("https://synapse.d2.pub/share/shr_abc", "AbC234xy"))
      .toBe("https://synapse.d2.pub/share/shr_abc?password=AbC234xy")
  })

  it("builds password-bearing relative drive URLs", () => {
    expect(buildDriveUrlWithPassword("/share/shr_abc", "AbC234xy"))
      .toBe("/share/shr_abc?password=AbC234xy")
    expect(buildDriveUrlWithPassword("/share/shr_abc?password=old#top", "new"))
      .toBe("/share/shr_abc?password=new#top")
  })

  it("does not add a password query when the password is null", () => {
    expect(buildDriveUrlWithPassword("https://synapse.d2.pub/share/shr_abc", null))
      .toBe("https://synapse.d2.pub/share/shr_abc")
  })

  it("redacts drive password query values", () => {
    expect(maskDriveShareUrl("https://synapse.d2.pub/share/shr_secret?password=AbC234xy"))
      .toBe("https://synapse.d2.pub/share/***?password=***")
  })

  it("redacts drive password query values case-insensitively", () => {
    expect(maskDriveShareUrl("https://synapse.d2.pub/share/shr_secret?Password=AbC234xy"))
      .toBe("https://synapse.d2.pub/share/***?Password=***")
  })

  it("defines the default drive access settings", () => {
    expect(DRIVE_DEFAULT_ACCESS_SETTINGS).toEqual({
      passwordEnabled: true,
      expiresIn: "3d",
      accessMode: "link_read",
      editorEmails: [],
    })
  })

  it("defines office-oriented drive upload limits", () => {
    expect(DRIVE_MAX_FILE_BYTES).toBe(100 * 1024 * 1024)
    expect(DRIVE_DEFAULT_QUOTA_BYTES).toBe(5 * 1024 * 1024 * 1024)
  })

  it("allows markdown as a drive browser preview kind", () => {
    const kind: DriveBrowserPreviewKind = "markdown"

    expect(kind).toBe("markdown")
  })

  it("uses the share public prefix", () => {
    expect(DRIVE_PUBLIC_PATH_PREFIX).toBe("/share")
    expect(DRIVE_SHARE_BROWSER_PATH_PREFIX).toBe("/share")
    expect(DRIVE_OWNER_BROWSER_PATH_PREFIX).toBe("/drive/items")
    expect(DRIVE_CONSOLE_BROWSER_PATH_PREFIX).toBe("/console/drive")
  })
})
