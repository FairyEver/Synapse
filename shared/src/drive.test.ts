import { describe, expect, it } from "vitest"
import {
  DRIVE_DEFAULT_QUOTA_BYTES,
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES,
  DRIVE_PUBLIC_ASSET_PATH_PREFIX,
  DRIVE_MAX_FILE_BYTES,
  DRIVE_CONSOLE_BROWSER_PATH_PREFIX,
  DRIVE_OWNER_BROWSER_PATH_PREFIX,
  DRIVE_SITE_DEFAULT_PAGE_SIZE,
  DRIVE_SITE_MAX_PAGE_SIZE,
  DRIVE_SITE_PATH_PREFIX,
  DRIVE_PUBLIC_PATH_PREFIX,
  DRIVE_SHARE_BROWSER_PATH_PREFIX,
  buildConsoleDriveBrowserUrl,
  buildConsoleDriveItemBrowserUrl,
  buildConsoleDriveRootUrl,
  buildDrivePublicAssetUrl,
  buildDriveSiteUrl,
  buildDriveShareUrl,
  buildDriveUrlWithPassword,
  buildOwnerDriveBrowserUrl,
  buildOwnerDriveDownloadUrl,
  buildOwnerDriveRenderUrl,
  buildShareDriveBrowserUrl,
  buildShareDriveDownloadUrl,
  buildShareDriveRenderUrl,
  inferDrivePublicAssetMimeType,
  isDrivePublicAssetId,
  parseDrivePublicAssetUrl,
  type DriveDocumentImageSource,
  type DriveAnnotationAnchorStatus,
  type DriveAnnotationCommentDto,
  type DriveAnnotationCreateInput,
  type DriveAnnotationTargetKind,
  type DriveAnnotationThreadDto,
  type DriveBrowserPreviewKind,
  maskDriveBrowserUrl,
  maskDriveShareUrl,
} from "./drive"

describe("drive URL helpers", () => {
  it("builds public drive share URLs", () => {
    expect(buildDriveShareUrl({ publicAppUrl: "https://synapse.d2.pub/", shareId: "shr_abc" }))
      .toBe("https://synapse.d2.pub/share/shr_abc")
  })

  it("builds public asset URLs without filenames", () => {
    expect(DRIVE_PUBLIC_ASSET_PATH_PREFIX).toBe("/files")
    expect(buildDrivePublicAssetUrl({
      publicAppUrl: "https://synapse.example/",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    })).toBe("https://synapse.example/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")
  })

  it("parses current public asset URLs", () => {
    expect(parseDrivePublicAssetUrl("https://synapse.test/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")).toEqual({
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    })
    expect(parseDrivePublicAssetUrl("https://synapse.test/files/not-an-asset")).toBeNull()
    expect(parseDrivePublicAssetUrl("https://synapse.test/share/shr_test")).toBeNull()
  })

  it("returns null for malformed encoded public asset paths", () => {
    expect(parseDrivePublicAssetUrl("https://synapse.test/files/%E0%A4%A")).toBeNull()
  })

  it("only parses exact public asset URL paths", () => {
    const assetId = "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ"

    expect(parseDrivePublicAssetUrl(`https://synapse.test//files/${assetId}`)).toBeNull()
    expect(parseDrivePublicAssetUrl(`https://synapse.test/files/${assetId}/`)).toBeNull()
    expect(parseDrivePublicAssetUrl(`https://synapse.test/files//${assetId}`)).toBeNull()
  })

  it("only parses http and https public asset URLs", () => {
    const assetId = "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ"

    expect(parseDrivePublicAssetUrl(`file:///files/${assetId}`)).toBeNull()
    expect(parseDrivePublicAssetUrl(`ftp://synapse.test/files/${assetId}`)).toBeNull()
    expect(parseDrivePublicAssetUrl(`mailto:${assetId}@synapse.test`)).toBeNull()
  })

  it("keeps image source DTO fields stable", () => {
    const source: DriveDocumentImageSource = {
      id: "img_1",
      imageKey: "img_hash",
      src: "https://example.test/a.png",
      kind: "external",
      occurrenceCount: 2,
      altText: "diagram",
      previewUrl: "https://example.test/a.png",
      canImport: true,
      status: "ready",
    }
    expect(source.kind).toBe("external")
    expect(source.occurrenceCount).toBe(2)
  })

  it("sets a bounded image import source limit", () => {
    expect(DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES).toBe(20)
  })

  it("builds canonical site root URLs", () => {
    expect(DRIVE_SITE_PATH_PREFIX).toBe("/sites")
    expect(buildDriveSiteUrl({ publicAppUrl: "https://synapse.test/", siteId: "site_abc" }))
      .toBe("https://synapse.test/sites/site_abc/")
  })

  it("builds password-bearing site URLs", () => {
    const siteUrl = buildDriveSiteUrl({ publicAppUrl: "https://synapse.test/", siteId: "site_abc" })

    expect(buildDriveUrlWithPassword(siteUrl, "AbC234xy"))
      .toBe("https://synapse.test/sites/site_abc/?password=AbC234xy")
  })

  it("keeps site page limits stable", () => {
    expect(DRIVE_SITE_DEFAULT_PAGE_SIZE).toBe(50)
    expect(DRIVE_SITE_MAX_PAGE_SIZE).toBe(200)
  })

  it("trims public app URL whitespace for public asset URLs", () => {
    expect(buildDrivePublicAssetUrl({
      publicAppUrl: " https://synapse.example/ ",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    })).toBe("https://synapse.example/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")
  })

  it("validates public asset ids", () => {
    expect(isDrivePublicAssetId("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")).toBe(true)
    expect(isDrivePublicAssetId("asset_short")).toBe(false)
    expect(isDrivePublicAssetId("shr_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")).toBe(false)
  })

  it("infers public asset image MIME types from filenames", () => {
    expect(inferDrivePublicAssetMimeType("logo.PNG")).toBe("image/png")
    expect(inferDrivePublicAssetMimeType("photo.jpeg")).toBe("image/jpeg")
    expect(inferDrivePublicAssetMimeType("icon.svg")).toBeNull()
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

  it("redacts public asset ids and sensitive query values", () => {
    expect(maskDriveBrowserUrl("https://synapse.d2.pub/files/asset_secret?password=AbC234xy&token=tok_123&name=logo.png"))
      .toBe("https://synapse.d2.pub/files/***?password=***&token=***&name=logo.png")
  })

  it("removes URL userinfo while masking drive browser URLs", () => {
    expect(maskDriveBrowserUrl("https://reader:secret-token@synapse.d2.pub/share/shr_secret?password=AbC234xy"))
      .toBe("https://synapse.d2.pub/share/***?password=***")
    expect(maskDriveBrowserUrl("https://reader:secret-token@example.test/external/page"))
      .toBe("https://example.test/external/page")
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

  it("defines drive annotation DTOs for text range comments", () => {
    const targetKind: DriveAnnotationTargetKind = "textRange"
    const anchorStatus: DriveAnnotationAnchorStatus = "attached"
    const comment: DriveAnnotationCommentDto = {
      id: "comment-1",
      threadId: "thread-1",
      parentCommentId: null,
      body: "Use the shorter term.",
      author: {
        id: "user-1",
        email: "reader@example.com",
        displayName: "Reader",
      },
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
      editedAt: null,
      deletedAt: null,
      deleted: false,
      permissions: { canEdit: true, canDelete: true },
    }
    const thread: DriveAnnotationThreadDto = {
      id: "thread-1",
      itemId: "item-1",
      baseVersionId: "version-1",
      targetKind,
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 3, end: 9 },
        quote: { exact: "重点", prefix: "这是 ", suffix: " 内容" },
      },
      anchorStatus,
      author: comment.author,
      comments: [comment],
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
      permissions: { canDelete: true },
    }
    const input: DriveAnnotationCreateInput = {
      targetKind,
      target: thread.target,
      body: "Comment body",
    }

    expect(thread.comments[0]?.body).toBe("Use the shorter term.")
    expect(input.target.kind).toBe("textRange")
  })

  it("uses the share public prefix", () => {
    expect(DRIVE_PUBLIC_PATH_PREFIX).toBe("/share")
    expect(DRIVE_SHARE_BROWSER_PATH_PREFIX).toBe("/share")
    expect(DRIVE_OWNER_BROWSER_PATH_PREFIX).toBe("/drive/items")
    expect(DRIVE_CONSOLE_BROWSER_PATH_PREFIX).toBe("/console/drive")
  })
})
