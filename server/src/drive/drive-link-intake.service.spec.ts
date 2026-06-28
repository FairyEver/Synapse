import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { DriveLinkIntakeService } from "./drive-link-intake.service"

const publicAppUrl = "https://synapse.test"

function createService(overrides: Partial<ConstructorParameters<typeof DriveLinkIntakeService>[0]> = {}) {
  const drive = {
    resolvePublicShareAccess: vi.fn(async () => ({
      status: "ok",
      value: {
        id: "share-record-1",
        shareId: "shr_123",
        ownerId: "owner-1",
        type: "file",
        storageKey: "objects/req.md",
        accessMode: "link_read",
        editorEmails: [],
        item: {
          id: "item-1",
          parentId: null,
          type: "file",
          name: "需求说明.md",
          size: "12",
          mimeType: "text/markdown",
          storageStatus: "active",
          shared: true,
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      },
    })),
    getShareBrowserSnapshot: vi.fn(async () => ({
      context: "share",
      surface: "standalone",
      current: {
        id: "item-1",
        name: "需求说明.md",
        type: "file",
        size: "12",
        mimeType: "text/markdown",
        updatedAt: "2026-06-28T00:00:00.000Z",
        previewKind: "markdown",
        browserUrl: "/share/shr_123",
        downloadUrl: "/share/shr_123/download",
      },
      breadcrumbs: [],
      children: [],
      childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
      preview: {
        kind: "markdown",
        text: "# 需求\n正文",
        html: "<h1>需求</h1><p>正文</p>",
        outline: [],
        truncated: false,
        imageUrl: null,
        visitUrl: null,
      },
      edit: null,
      annotation: null,
      canDownload: true,
      canZip: false,
    })),
    openShareBrowserItemDownload: vi.fn(),
  }
  const sites = {
    resolvePublicSite: vi.fn(async () => ({
      status: "ok",
      asset: { relativePath: "index.html", storageKey: "site/index.html", contentType: "text/html" },
    })),
  }
  const publicAssets = {
    resolvePublicAsset: vi.fn(async () => ({
      status: "ok",
      publicAssetId: "asset_123",
      userId: "owner-1",
      name: "screen.png",
      mimeType: "image/png",
      size: 12n,
      storageKey: "assets/screen.png",
      etag: "etag",
    })),
  }
  const storage = {
    getObjectStream: vi.fn(async () => ({
      stream: Readable.from("<html>ok</html>"),
      size: 15n,
      contentType: "text/html",
    })),
  }

  return {
    drive,
    sites,
    publicAssets,
    storage,
    service: new DriveLinkIntakeService({ drive, sites, publicAssets, storage, publicAppUrl, ...overrides } as never),
  }
}

describe("DriveLinkIntakeService", () => {
  it("resolves a share markdown link", async () => {
    const { service } = createService()

    await expect(service.resolve({ url: `${publicAppUrl}/share/shr_123` })).resolves.toMatchObject({
      ok: true,
      linkType: "share",
      access: { status: "ok", canRead: true, canReadText: true },
      root: { name: "需求说明.md", type: "file", previewKind: "markdown" },
      ref: { kind: "share", shareId: "shr_123", itemId: null },
    })
  })

  it("returns password_required without echoing password", async () => {
    const { service, drive } = createService()
    drive.resolvePublicShareAccess.mockResolvedValueOnce({ status: "password_required" } as never)

    await expect(service.resolve({ url: `${publicAppUrl}/share/shr_123`, password: "secret" })).resolves.toMatchObject({
      access: { status: "password_required", canRead: false },
    })
    await expect(service.resolve({ url: `${publicAppUrl}/share/shr_123`, password: "secret" }))
      .resolves.not.toHaveProperty("password")
  })

  it("lists share folder children from a browser snapshot", async () => {
    const { service, drive } = createService()
    drive.getShareBrowserSnapshot.mockResolvedValueOnce({
      context: "share",
      surface: "standalone",
      current: { id: "folder-1", name: "交付包", type: "folder", size: "0", mimeType: null, updatedAt: "2026-06-28T00:00:00.000Z", previewKind: "download-only", browserUrl: "/share/shr_123", downloadUrl: "/share/shr_123/download" },
      breadcrumbs: [],
      children: [{ id: "item-1", name: "需求说明.md", type: "file", size: "12", mimeType: "text/markdown", updatedAt: "2026-06-28T00:00:00.000Z", previewKind: "markdown", browserUrl: "/share/shr_123/items/item-1", downloadUrl: "/share/shr_123/items/item-1/download" }],
      childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
      preview: null,
      edit: null,
      annotation: null,
      canDownload: true,
      canZip: true,
    } as never)

    await expect(service.list({ url: `${publicAppUrl}/share/shr_123` })).resolves.toEqual({
      items: [{ path: "需求说明.md", name: "需求说明.md", type: "file", mimeType: "text/markdown", previewKind: "markdown", size: "12", itemId: "item-1" }],
      page: { hasMore: false, nextOffset: null },
    })
  })

  it("reads markdown text from a share link", async () => {
    const { service } = createService()

    await expect(service.readText({ url: `${publicAppUrl}/share/shr_123`, maxBytes: 64 })).resolves.toMatchObject({
      path: "需求说明.md",
      mimeType: "text/markdown",
      previewKind: "markdown",
      text: "# 需求\n正文",
      truncated: false,
      source: { linkType: "share" },
    })
  })

  it("rejects public asset text reads", async () => {
    const { service } = createService()

    await expect(service.readText({ url: `${publicAppUrl}/files/asset_123` })).rejects.toThrow("该链接不是可读取的文本内容")
  })
})
