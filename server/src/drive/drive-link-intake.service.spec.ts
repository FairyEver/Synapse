import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { DriveLinkIntakeService } from "./drive-link-intake.service"
import { renderDriveMarkdownFragment } from "./drive-markdown-renderer"

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
        relativeImages: [],
      },
      edit: null,
      annotation: null,
      canDownload: true,
      canZip: false,
    })),
    openShareBrowserItemDownload: vi.fn(),
    prepareOpenApiShareDownload: vi.fn(async (input: { readonly sourceType: "share" | "share_item" }) => ({
      status: "ok" as const,
      artifact: {
        sourceType: input.sourceType,
        artifactType: "file" as const,
        fileName: "需求说明.md",
        mimeType: "text/markdown",
        size: 12n,
        entryPath: null,
        target: { kind: "share" as const, shareId: "shr_123", itemId: "item-1" },
        entries: [],
      },
    })),
  }
  const sites = {
    resolvePublicSite: vi.fn(async () => ({
      status: "ok",
      asset: { relativePath: "index.html", storageKey: "site/index.html", contentType: "text/html" },
    })),
    listPublicSiteAssets: vi.fn(async () => ({
      status: "ok",
      entries: [
        { kind: "folder", relativePath: "assets", contentType: null, size: 0n },
        { kind: "file", relativePath: "index.html", storageKey: "site/index.html", contentType: "text/html", size: 15n },
        { kind: "file", relativePath: "pages/create-task.html", storageKey: "site/pages/create-task.html", contentType: "text/html", size: 20n },
        { kind: "file", relativePath: "assets/styles.css", storageKey: "site/assets/styles.css", contentType: "text/css", size: 8n },
        { kind: "file", relativePath: "assets/logo.png", storageKey: "site/assets/logo.png", contentType: "image/png", size: 12n },
      ],
      page: { hasMore: false, nextOffset: null },
    })),
    prepareOpenApiSiteDownload: vi.fn(async (_siteId: string, input: { readonly sourceType: "site" | "site_path" }) => ({
      status: "ok" as const,
      artifact: {
        sourceType: input.sourceType,
        artifactType: "archive" as const,
        fileName: "Site.zip",
        mimeType: "application/zip",
        size: null,
        entryPath: "index.html",
        target: { kind: "site" as const, siteId: "site_123", deploymentId: "deployment-1" },
        entries: [],
      },
    })),
  }
  const publicAssets = {
    resolvePublicAsset: vi.fn(async () => ({
      status: "ok",
      assetId: "asset_123",
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
  const annotations = {
    getShareAnnotationSnapshot: vi.fn(async () => ({ itemId: "item-1", canComment: true, threads: [] })),
    createShareAnnotationByQuote: vi.fn(async () => ({ id: "thread-1" })),
    replyShareAnnotation: vi.fn(async () => ({ id: "comment-2" })),
    updateShareComment: vi.fn(async () => ({ id: "comment-2" })),
    deleteShareComment: vi.fn(async () => ({ ok: true })),
    deleteShareThread: vi.fn(async () => ({ ok: true })),
  }

  return {
    drive,
    sites,
    publicAssets,
    storage,
    annotations,
    service: new DriveLinkIntakeService({ drive, sites, publicAssets, storage, annotations, publicAppUrl, ...overrides } as never),
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

  it("does not mark share image links as readable text", async () => {
    const { service, drive } = createService()
    drive.resolvePublicShareAccess.mockResolvedValueOnce({
      status: "ok",
      value: {
        id: "share-record-1",
        shareId: "shr_123",
        ownerId: "owner-1",
        type: "file",
        storageKey: "objects/logo.png",
        accessMode: "link_read",
        editorEmails: [],
        item: {
          id: "image-1",
          parentId: null,
          type: "file",
          name: "logo.png",
          size: "12",
          mimeType: "image/png",
          storageStatus: "active",
          shared: true,
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      },
    } as never)

    await expect(service.resolve({ url: `${publicAppUrl}/share/shr_123` })).resolves.toMatchObject({
      ok: true,
      linkType: "share",
      access: { status: "ok", canRead: true, canReadText: false, canDownload: true },
      root: { name: "logo.png", type: "file", previewKind: "image" },
    })
  })

  it("uses password query values from generated share links", async () => {
    const { service, drive } = createService()

    await service.resolve({ url: `${publicAppUrl}/share/shr_123?password=query-secret` })

    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_123",
      password: "query-secret",
      cookie: undefined,
    })
  })

  it("prepares all supported Open API link types without opening object streams", async () => {
    const { service, drive, sites, storage } = createService()

    await expect(service.prepareDownloadArtifact({
      url: `${publicAppUrl}/share/shr_123/items/item-1?password=query-secret`,
    })).resolves.toMatchObject({ sourceType: "share_item", artifactType: "file" })
    expect(drive.prepareOpenApiShareDownload).toHaveBeenCalledWith({
      shareId: "shr_123",
      itemId: "item-1",
      password: "query-secret",
      sourceType: "share_item",
    })

    await expect(service.prepareDownloadArtifact({
      url: `${publicAppUrl}/sites/site_123/docs/index.html`,
    })).resolves.toMatchObject({
      sourceType: "site_path",
      artifactType: "archive",
      entryPath: "index.html",
    })
    expect(sites.prepareOpenApiSiteDownload).toHaveBeenCalledWith("site_123", {
      password: undefined,
      relativePath: "docs/index.html",
      sourceType: "site_path",
    })

    await expect(service.prepareDownloadArtifact({
      url: `${publicAppUrl}/files/asset_123`,
    })).resolves.toMatchObject({
      sourceType: "public_asset",
      artifactType: "file",
      target: { kind: "public_asset", assetId: "asset_123", publicAssetId: "asset_123" },
    })
    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("rejects external origins before resolving any source", async () => {
    const { service, drive, sites, publicAssets } = createService()

    await expect(service.prepareDownloadArtifact({
      url: "https://outside.example/share/shr_123",
    })).rejects.toMatchObject({ reason: "unsupported_link" })
    expect(drive.prepareOpenApiShareDownload).not.toHaveBeenCalled()
    expect(sites.prepareOpenApiSiteDownload).not.toHaveBeenCalled()
    expect(publicAssets.resolvePublicAsset).not.toHaveBeenCalled()
  })

  it("lists and mutates shared Markdown annotations using itemId before path", async () => {
    const { service, drive, annotations } = createService()
    const base = { url: `${publicAppUrl}/share/shr_123?password=query-secret`, password: "explicit-secret", itemId: "item-1", path: "ignored.md" }

    await expect(service.listAnnotationThreads(base, "user-1")).resolves.toEqual({ itemId: "item-1", canComment: true, threads: [] })
    await service.createAnnotationThread({ ...base, target: { exact: "正文" }, body: "评论", idempotencyKey: "thread-key-1" }, { actorUserId: "user-1" })
    await service.createAnnotationComment({ ...base, threadId: "thread-1", parentCommentId: "comment-1", body: "回复" }, { actorUserId: "user-1" })
    await service.updateAnnotationComment({ ...base, commentId: "comment-2", body: "编辑" }, { actorUserId: "user-1" })
    await service.deleteAnnotationComment({ ...base, commentId: "comment-2" }, { actorUserId: "user-1" })
    await service.deleteAnnotationThread({ ...base, threadId: "thread-1" }, { actorUserId: "user-1" })

    expect(drive.getShareBrowserSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      shareId: "shr_123",
      itemId: "item-1",
      password: "explicit-secret",
      actorUserId: "user-1",
    }))
    expect(annotations.getShareAnnotationSnapshot).toHaveBeenCalledWith({
      shareId: "shr_123",
      itemId: "item-1",
      password: "explicit-secret",
      actorUserId: "user-1",
    })
    expect(annotations.createShareAnnotationByQuote).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user-1",
      itemId: "item-1",
      target: { exact: "正文" },
      idempotencyKey: "thread-key-1",
    }))
    expect(annotations.replyShareAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "thread-1",
      body: { parentCommentId: "comment-1", body: "回复" },
    }))
  })

  it("resolves a share folder child path for annotation management", async () => {
    const { service, drive, annotations } = createService()
    drive.getShareBrowserSnapshot
      .mockResolvedValueOnce({
        current: { id: "folder-1", name: "docs", type: "folder", mimeType: null },
        children: [{ id: "item-prd", name: "PRD.md", type: "file", mimeType: "text/markdown" }],
        childrenPage: { hasMore: false, nextOffset: null },
      } as never)
      .mockResolvedValueOnce({
        current: { id: "item-prd", name: "PRD.md", type: "file", mimeType: "text/markdown" },
        children: [],
      } as never)

    await service.listAnnotationThreads({ url: `${publicAppUrl}/share/shr_123`, path: "PRD.md" }, "user-1")

    expect(annotations.getShareAnnotationSnapshot).toHaveBeenCalledWith(expect.objectContaining({ itemId: "item-prd" }))
  })

  it("rejects annotation management for non-share links and non-md items", async () => {
    const { service, drive, annotations } = createService()
    await expect(service.listAnnotationThreads({ url: `${publicAppUrl}/sites/site_123/` }, "user-1"))
      .rejects.toThrow("评论管理仅支持 Synapse 分享链接。")

    drive.getShareBrowserSnapshot.mockResolvedValueOnce({
      current: { id: "item-txt", name: "notes.txt", type: "file", mimeType: "text/plain" },
      children: [],
    } as never)
    await expect(service.listAnnotationThreads({ url: `${publicAppUrl}/share/shr_123` }, "user-1"))
      .rejects.toThrow("评论管理仅支持 .md 文档。")

    drive.getShareBrowserSnapshot.mockResolvedValueOnce({
      current: { id: "item-mdx", name: "notes.mdx", type: "file", mimeType: "text/markdown" },
      children: [],
    } as never)
    await expect(service.listAnnotationThreads({ url: `${publicAppUrl}/share/shr_123` }, "user-1"))
      .rejects.toThrow("评论管理仅支持 .md 文档。")
    expect(annotations.getShareAnnotationSnapshot).not.toHaveBeenCalled()
  })

  it("rejects drive-shaped links from other origins before resolving content", async () => {
    const { service, drive, sites, publicAssets } = createService()
    const url = "https://example.com/share/shr_123"

    await expect(service.resolve({ url })).rejects.toThrow("仅支持当前 Synapse 公共地址的云盘链接。")
    await expect(service.list({ url })).rejects.toThrow("仅支持当前 Synapse 公共地址的云盘链接。")
    await expect(service.readText({ url })).rejects.toThrow("仅支持当前 Synapse 公共地址的云盘链接。")
    await expect((service as unknown as {
      openDownload: (input: { readonly url: string }) => Promise<unknown>
    }).openDownload({ url })).rejects.toThrow("仅支持当前 Synapse 公共地址的云盘链接。")

    expect(drive.resolvePublicShareAccess).not.toHaveBeenCalled()
    expect(drive.getShareBrowserSnapshot).not.toHaveBeenCalled()
    expect(sites.resolvePublicSite).not.toHaveBeenCalled()
    expect(publicAssets.resolvePublicAsset).not.toHaveBeenCalled()
  })

  it("resolves direct share child links from the target item snapshot", async () => {
    const { service, drive } = createService()
    drive.resolvePublicShareAccess.mockResolvedValueOnce({
      status: "ok",
      value: {
        id: "share-record-1",
        shareId: "shr_123",
        ownerId: "owner-1",
        type: "folder",
        storageKey: "",
        accessMode: "link_read",
        editorEmails: [],
        item: {
          id: "folder-1",
          parentId: null,
          name: "交付包",
          type: "folder",
          size: "0",
          mimeType: "",
          storageStatus: "active",
          shared: true,
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      },
    })
    drive.getShareBrowserSnapshot.mockResolvedValueOnce({
      context: "share",
      surface: "standalone",
      current: {
        id: "item-prd",
        name: "PRD.md",
        type: "file",
        size: "8",
        mimeType: "text/markdown",
        updatedAt: "2026-06-28T00:00:00.000Z",
        previewKind: "markdown",
        browserUrl: "/share/shr_123/items/item-prd",
        downloadUrl: "/share/shr_123/items/item-prd/download",
      },
      breadcrumbs: [],
      children: [],
      childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
      preview: { kind: "markdown", text: "# PRD", html: "<h1>PRD</h1>", outline: [], truncated: false, imageUrl: null, visitUrl: null },
      edit: null,
      annotation: null,
      canDownload: true,
      canZip: false,
    } as never)

    await expect(service.resolve({ url: `${publicAppUrl}/share/shr_123/items/item-prd`, password: "secret" })).resolves.toMatchObject({
      ok: true,
      linkType: "share_item",
      access: { status: "ok", canRead: true, canList: false, canReadText: true, canDownload: true },
      root: { name: "PRD.md", type: "file", previewKind: "markdown" },
      ref: { kind: "share", shareId: "shr_123", itemId: "item-prd" },
    })
    expect(drive.getShareBrowserSnapshot).toHaveBeenCalledWith({
      shareId: "shr_123",
      itemId: "item-prd",
      password: "secret",
      cookie: undefined,
    })
  })

  it("returns password_required without echoing password", async () => {
    const { service, drive } = createService()
    drive.resolvePublicShareAccess.mockResolvedValueOnce({ status: "password_required" } as never)

    await expect(service.resolve({ url: `${publicAppUrl}/share/shr_123`, password: "secret" })).resolves.toMatchObject({
      access: { status: "password_required", canRead: false },
      root: { name: "受密码保护的分享", type: "protected", previewKind: "download-only" },
    })
    await expect(service.resolve({ url: `${publicAppUrl}/share/shr_123`, password: "secret" }))
      .resolves.not.toHaveProperty("password")
  })

  it("asks for passwords before listing, reading, or downloading protected share links", async () => {
    const { service, drive } = createService()
    drive.resolvePublicShareAccess.mockResolvedValue({ status: "password_required" } as never)

    await expect(service.list({ url: `${publicAppUrl}/share/shr_123` })).rejects.toThrow("该链接需要密码。")
    await expect(service.readText({ url: `${publicAppUrl}/share/shr_123` })).rejects.toThrow("该链接需要密码。")
    await expect((service as unknown as {
      openDownload: (input: { readonly url: string }) => Promise<unknown>
    }).openDownload({ url: `${publicAppUrl}/share/shr_123` })).rejects.toThrow("该链接需要密码。")

    expect(drive.getShareBrowserSnapshot).not.toHaveBeenCalled()
    expect(drive.openShareBrowserItemDownload).not.toHaveBeenCalled()
  })

  it("returns a protected root placeholder for password-required sites", async () => {
    const { service, sites } = createService()
    sites.resolvePublicSite.mockResolvedValueOnce({ status: "password_required" } as never)

    await expect(service.resolve({ url: `${publicAppUrl}/sites/site_123/` })).resolves.toMatchObject({
      linkType: "site",
      access: { status: "password_required", canRead: false, canList: false, canReadText: false, canDownload: false },
      root: { name: "受密码保护的站点", type: "protected", previewKind: "download-only" },
    })
  })

  it("passes passwords when resolving protected site links", async () => {
    const { service, sites } = createService()

    await expect(service.resolve({ url: `${publicAppUrl}/sites/site_public/`, password: "secret" })).resolves.toMatchObject({
      linkType: "site",
      access: { status: "ok" },
      root: { name: "index.html", type: "site" },
    })
    expect(sites.resolvePublicSite).toHaveBeenCalledWith("site_public", {
      cookie: null,
      password: "secret",
      relativePath: "",
    })
    await expect(service.resolve({ url: `${publicAppUrl}/sites/site_public/`, password: "secret" }))
      .resolves.not.toHaveProperty("password")
  })

  it("marks resolved site links as listable", async () => {
    const { service } = createService()

    await expect(service.resolve({ url: `${publicAppUrl}/sites/site_public/` })).resolves.toMatchObject({
      linkType: "site",
      access: { status: "ok", canRead: true, canList: true, canReadText: true, canDownload: true },
      root: { name: "index.html", type: "site", previewKind: "html-source" },
      ref: { kind: "site", siteId: "site_public", path: null },
    })
  })

  it("keeps resolved site path links listable", async () => {
    const { service, sites } = createService()
    sites.resolvePublicSite.mockResolvedValueOnce({
      status: "ok",
      asset: { relativePath: "pages/create-task.html", storageKey: "site/pages/create-task.html", contentType: "text/html" },
    } as never)

    await expect(service.resolve({ url: `${publicAppUrl}/sites/site_public/pages/create-task.html` })).resolves.toMatchObject({
      linkType: "site_path",
      access: { status: "ok", canRead: true, canList: true, canReadText: true, canDownload: true },
      root: { name: "pages/create-task.html", type: "site", previewKind: "html-source" },
      ref: { kind: "site", siteId: "site_public", path: "pages/create-task.html" },
    })
  })

  it("does not mark site image links as readable text", async () => {
    const { service, sites } = createService()
    sites.resolvePublicSite.mockResolvedValueOnce({
      status: "ok",
      asset: { relativePath: "assets/logo.png", storageKey: "site/assets/logo.png", contentType: "image/png" },
    } as never)

    await expect(service.resolve({ url: `${publicAppUrl}/sites/site_123/assets/logo.png` })).resolves.toMatchObject({
      ok: true,
      linkType: "site_path",
      access: { status: "ok", canRead: true, canReadText: false, canDownload: true },
      root: { name: "assets/logo.png", type: "site", previewKind: "image" },
    })
  })

  it("uses password query values from generated site links", async () => {
    const { service, sites } = createService()

    await service.list({ url: `${publicAppUrl}/sites/site_123/?password=site-secret` })

    expect(sites.listPublicSiteAssets).toHaveBeenCalledWith("site_123", expect.objectContaining({
      password: "site-secret",
    }))
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

  it("lists published site assets for Drive link intake", async () => {
    const { service, sites } = createService()

    await expect(service.list({ url: `${publicAppUrl}/sites/site_public/` })).resolves.toEqual({
      items: [
        { path: "assets", name: "assets", type: "folder", mimeType: null, previewKind: "download-only", size: "0" },
        { path: "index.html", name: "index.html", type: "file", mimeType: "text/html", previewKind: "html-source", size: "15" },
        { path: "pages/create-task.html", name: "create-task.html", type: "file", mimeType: "text/html", previewKind: "html-source", size: "20" },
        { path: "assets/styles.css", name: "styles.css", type: "file", mimeType: "text/css", previewKind: "text", size: "8" },
        { path: "assets/logo.png", name: "logo.png", type: "file", mimeType: "image/png", previewKind: "image", size: "12" },
      ],
      page: { hasMore: false, nextOffset: null },
    })
    expect(sites.listPublicSiteAssets).toHaveBeenCalledWith("site_public", {
      cookie: null,
      password: undefined,
      path: "",
      offset: undefined,
      limit: undefined,
    })
  })

  it("lists the exact published site asset for concrete site file links", async () => {
    const { service, sites } = createService()
    sites.listPublicSiteAssets.mockResolvedValueOnce({
      status: "ok",
      entries: [
        {
          kind: "file",
          relativePath: "pages/create-task.html",
          storageKey: "site/pages/create-task.html",
          contentType: "text/html",
          size: 20n,
        },
      ],
      page: { hasMore: false, nextOffset: null },
    } as never)

    await expect(service.list({ url: `${publicAppUrl}/sites/site_public/pages/create-task.html` })).resolves.toEqual({
      items: [
        {
          path: "pages/create-task.html",
          name: "create-task.html",
          type: "file",
          mimeType: "text/html",
          previewKind: "html-source",
          size: "20",
        },
      ],
      page: { hasMore: false, nextOffset: null },
    })
    expect(sites.listPublicSiteAssets).toHaveBeenCalledWith("site_public", {
      cookie: null,
      password: undefined,
      path: "pages/create-task.html",
      offset: undefined,
      limit: undefined,
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

  it("returns current Markdown image ids only for complete untruncated text", async () => {
    const { service, drive } = createService()
    const baseSnapshot = await drive.getShareBrowserSnapshot()
    const markdown = "# 需求\n\n![架构图](./images/architecture.png \"V1\")"
    const rendered = await renderDriveMarkdownFragment(markdown)
    const snapshot = {
      ...baseSnapshot,
      current: { ...baseSnapshot.current, size: String(Buffer.byteLength(markdown)) },
      preview: {
        ...baseSnapshot.preview,
        text: markdown,
        html: rendered.html,
        markdownProjection: rendered.projection,
      },
      edit: {
        canEdit: true,
        editorKind: "monaco",
        currentVersionId: "version-2",
        reason: null,
      },
    }
    drive.getShareBrowserSnapshot.mockResolvedValue(snapshot as never)

    const complete = await service.readText({ url: `${publicAppUrl}/share/shr_123`, maxBytes: 1024 })
    expect(complete.source.versionId).toBe("version-2")
    expect(complete.markdownImages).toEqual([
      {
        imageId: rendered.projection.images?.[0]?.imageId,
        index: 1,
        source: "./images/architecture.png",
        alt: "架构图",
        title: "V1",
      },
    ])

    const truncated = await service.readText({ url: `${publicAppUrl}/share/shr_123`, maxBytes: 8 })
    expect(truncated.truncated).toBe(true)
    expect(truncated.markdownImages).toBeUndefined()
  })

  it("does not split UTF-8 characters when limiting share text bytes", async () => {
    const { service } = createService()

    await expect(service.readText({ url: `${publicAppUrl}/share/shr_123`, maxBytes: 7 })).resolves.toMatchObject({
      text: "# 需",
      truncated: true,
    })
  })

  it("reads empty markdown text from a share link", async () => {
    const { service, drive } = createService()
    drive.getShareBrowserSnapshot.mockResolvedValueOnce({
      context: "share",
      surface: "standalone",
      current: {
        id: "item-empty",
        name: "empty.md",
        type: "file",
        size: "0",
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
        text: "",
        html: "",
        outline: [],
        truncated: false,
        imageUrl: null,
        visitUrl: null,
        relativeImages: [],
      },
      edit: null,
      annotation: null,
      canDownload: true,
      canZip: false,
    } as never)

    await expect(service.readText({ url: `${publicAppUrl}/share/shr_123`, maxBytes: 64 })).resolves.toMatchObject({
      path: "empty.md",
      mimeType: "text/markdown",
      previewKind: "markdown",
      text: "",
      truncated: false,
      source: { linkType: "share" },
    })
  })

  it("resolves share-relative paths before reading text", async () => {
    const { service, drive } = createService()
    drive.getShareBrowserSnapshot
      .mockResolvedValueOnce({
        context: "share",
        surface: "standalone",
        current: { id: "folder-1", name: "交付包", type: "folder", size: "0", mimeType: null, updatedAt: "2026-06-28T00:00:00.000Z", previewKind: "download-only", browserUrl: "/share/shr_123", downloadUrl: "/share/shr_123/download" },
        breadcrumbs: [],
        children: [{ id: "item-prd", name: "PRD.md", type: "file", size: "8", mimeType: "text/markdown", updatedAt: "2026-06-28T00:00:00.000Z", previewKind: "markdown", browserUrl: "/share/shr_123/items/item-prd", downloadUrl: "/share/shr_123/items/item-prd/download" }],
        childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
        preview: null,
        edit: null,
        annotation: null,
        canDownload: true,
        canZip: true,
      } as never)
      .mockResolvedValueOnce({
        context: "share",
        surface: "standalone",
        current: { id: "item-prd", name: "PRD.md", type: "file", size: "8", mimeType: "text/markdown", updatedAt: "2026-06-28T00:00:00.000Z", previewKind: "markdown", browserUrl: "/share/shr_123/items/item-prd", downloadUrl: "/share/shr_123/items/item-prd/download" },
        breadcrumbs: [],
        children: [],
        childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
        preview: { kind: "markdown", text: "# PRD", html: "<h1>PRD</h1>", outline: [], truncated: false, imageUrl: null, visitUrl: null },
        edit: null,
        annotation: null,
        canDownload: true,
        canZip: false,
      } as never)

    await expect(service.readText({ url: `${publicAppUrl}/share/shr_123`, path: "PRD.md" })).resolves.toMatchObject({
      path: "PRD.md",
      text: "# PRD",
      previewKind: "markdown",
    })
    expect(drive.getShareBrowserSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ itemId: "item-prd" }))
  })

  it("opens a concrete file stream for Drive link downloads", async () => {
    const { service, drive } = createService()
    drive.getShareBrowserSnapshot
      .mockResolvedValueOnce({
        context: "share",
        surface: "standalone",
        current: { id: "folder-1", name: "交付包", type: "folder", size: "0", mimeType: null, updatedAt: "2026-06-28T00:00:00.000Z", previewKind: "download-only", browserUrl: "/share/shr_123", downloadUrl: "/share/shr_123/download" },
        breadcrumbs: [],
        children: [{ id: "item-json", name: "sample-data.json", type: "file", size: "13", mimeType: "application/json", updatedAt: "2026-06-28T00:00:00.000Z", previewKind: "text", browserUrl: "/share/shr_123/items/item-json", downloadUrl: "/share/shr_123/items/item-json/download" }],
        childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
        preview: null,
        edit: null,
        annotation: null,
        canDownload: true,
        canZip: true,
      } as never)
    drive.openShareBrowserItemDownload.mockResolvedValueOnce({
      kind: "file",
      stream: Readable.from("{\"ok\":true}"),
      fileName: "sample-data.json",
      size: 11n,
      contentType: "application/json",
    })

    await expect((service as unknown as {
      openDownload: (input: { readonly url: string; readonly path?: string }) => Promise<unknown>
    }).openDownload({ url: `${publicAppUrl}/share/shr_123`, path: "sample-data.json" })).resolves.toMatchObject({
      fileName: "sample-data.json",
      size: 11n,
      contentType: "application/json",
    })
  })

  it("reads public text assets with the requested byte limit", async () => {
    const { service, publicAssets, storage } = createService()
    publicAssets.resolvePublicAsset.mockResolvedValue({
      status: "ok",
      assetId: "asset_123",
      publicAssetId: "public-asset-row-1",
      userId: "owner-1",
      name: "notes.md",
      mimeType: "text/markdown",
      size: 12n,
      storageKey: "drive/public/notes",
      etag: "etag-notes",
    })
    storage.getObjectStream.mockResolvedValue({
      stream: Readable.from("# 说明文档"),
      size: 14n,
      contentType: "text/markdown",
    })

    await expect(service.resolve({ url: `${publicAppUrl}/files/asset_123` })).resolves.toMatchObject({
      access: { canReadText: true },
      root: { previewKind: "markdown" },
    })
    await expect(service.readText({ url: `${publicAppUrl}/files/asset_123`, maxBytes: 5 })).resolves.toMatchObject({
      path: "notes.md",
      mimeType: "text/markdown",
      previewKind: "markdown",
      truncated: true,
      source: { linkType: "public_asset" },
    })
  })

  it("rejects non-text public asset reads", async () => {
    const { service, publicAssets } = createService()
    publicAssets.resolvePublicAsset.mockResolvedValue({
      status: "ok",
      assetId: "asset_123",
      publicAssetId: "public-asset-row-1",
      userId: "owner-1",
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 12n,
      storageKey: "drive/public/report",
      etag: "etag-report",
    })

    await expect(service.readText({ url: `${publicAppUrl}/files/asset_123` })).rejects.toThrow("该链接不是可读取的文本内容")
  })
})
