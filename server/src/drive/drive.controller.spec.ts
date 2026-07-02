import { Buffer } from "node:buffer"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable, Writable } from "node:stream"
import { BadRequestException, type INestApplication, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { DriveBrowserSnapshotDto, DriveItemDto } from "@synapse/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AdminAuthService } from "../admin-auth/admin-auth.service"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { DriveAnnotationService } from "./drive-annotation.service"
import { DriveChangeLogService } from "./drive-change-log"
import { DriveDocumentImageService } from "./drive-document-image.service"
import { DriveAdminController, DriveLocalStorageController, DrivePublicController, DriveUserController } from "./drive.controller"
import { DrivePublicAssetService } from "./drive-public-asset.service"
import { DriveSiteService } from "./drive-site.service"
import { DriveService } from "./drive.service"
import { LocalDriveStorage } from "./drive-storage"

type SupertestResponse = { readonly body: unknown; readonly text: string; readonly headers: Record<string, string> }
type SupertestRequest = {
  readonly send: (body: unknown) => SupertestRequest
  readonly set: (field: string, value: string | readonly string[]) => SupertestRequest
  readonly expect: (status: number) => Promise<SupertestResponse>
}
const request = require("supertest") as (server: unknown) => {
  readonly get: (path: string) => SupertestRequest
  readonly post: (path: string) => SupertestRequest
  readonly patch: (path: string) => SupertestRequest
  readonly put: (path: string) => SupertestRequest
  readonly delete: (path: string) => SupertestRequest
}

describe("DriveController", () => {
  let app: INestApplication | null = null
  const originalAppPublicUrl = process.env.APP_PUBLIC_URL
  const drive = {
    listItems: vi.fn(),
    listItemsPage: vi.fn(),
    prepareFolderUpload: vi.fn(),
    deleteItem: vi.fn(),
    listTrash: vi.fn(),
    restoreItem: vi.fn(),
    hideTrashedItem: vi.fn(),
    listFileVersions: vi.fn(),
    restoreFileVersion: vi.fn(),
    updateFileVersionPin: vi.fn(),
    deleteFileVersion: vi.fn(),
    openFileVersionDownload: vi.fn(),
    listShares: vi.fn(),
    createShare: vi.fn(),
    resolvePublicShareAccess: vi.fn(),
    getOwnerConsoleRootBrowserSnapshot: vi.fn(),
    getOwnerBrowserSnapshot: vi.fn(),
    getShareBrowserSnapshot: vi.fn(),
    resolveOwnerRenderAccess: vi.fn(),
    resolveShareRenderAccess: vi.fn(),
    openOwnerBrowserItemDownload: vi.fn(),
    openShareBrowserItemDownload: vi.fn(),
    listAdminItems: vi.fn(),
    getAdminStorageSummary: vi.fn(),
    openAdminItemDownload: vi.fn(),
    restoreItemAsAdmin: vi.fn(),
  }
  const publicAssets = {
    listAdminAssets: vi.fn(),
    getAdminAsset: vi.fn(),
    listAdminAccessLogs: vi.fn(),
    listAdminRevisions: vi.fn(),
    openAdminRevisionDownload: vi.fn(),
  }
  const annotations = {
    listOwnerAnnotations: vi.fn(),
    createOwnerAnnotation: vi.fn(),
    replyOwnerAnnotation: vi.fn(),
    updateOwnerComment: vi.fn(),
    deleteOwnerComment: vi.fn(),
    deleteOwnerThread: vi.fn(),
    listShareAnnotations: vi.fn(),
    createShareAnnotation: vi.fn(),
    replyShareAnnotation: vi.fn(),
    updateShareComment: vi.fn(),
    deleteShareComment: vi.fn(),
    deleteShareThread: vi.fn(),
  }
  const documentImages = {
    scanOwnerItemImages: vi.fn(),
    importOwnerItemImages: vi.fn(),
  }
  const sites = {
    preflightSite: vi.fn(),
    createSite: vi.fn(),
    listSites: vi.fn(),
    updateSiteAccess: vi.fn(),
    disableSite: vi.fn(),
    enableSite: vi.fn(),
    deleteSite: vi.fn(),
    republishSite: vi.fn(),
    resolvePublicSite: vi.fn(),
    verifySitePassword: vi.fn(),
    createSiteAccessCookie: vi.fn(),
  }
  const changes = {
    list: vi.fn(),
  }
  const storage = {
    getObjectStream: vi.fn(async () => ({ stream: Readable.from("brief"), size: 5n, contentType: "text/plain" })),
  }

  beforeEach(async () => {
    drive.listItems.mockReset()
    drive.listItemsPage.mockReset()
    drive.prepareFolderUpload.mockReset()
    drive.deleteItem.mockReset()
    drive.listTrash.mockReset()
    drive.restoreItem.mockReset()
    drive.hideTrashedItem.mockReset()
    drive.listFileVersions.mockReset()
    drive.restoreFileVersion.mockReset()
    drive.updateFileVersionPin.mockReset()
    drive.deleteFileVersion.mockReset()
    drive.openFileVersionDownload.mockReset()
    drive.listShares.mockReset()
    drive.createShare.mockReset()
    drive.resolvePublicShareAccess.mockReset()
    drive.getOwnerConsoleRootBrowserSnapshot.mockReset()
    drive.getOwnerBrowserSnapshot.mockReset()
    drive.getShareBrowserSnapshot.mockReset()
    drive.resolveOwnerRenderAccess.mockReset()
    drive.resolveShareRenderAccess.mockReset()
    drive.openOwnerBrowserItemDownload.mockReset()
    drive.openShareBrowserItemDownload.mockReset()
    drive.listAdminItems.mockReset()
    drive.getAdminStorageSummary.mockReset()
    drive.openAdminItemDownload.mockReset()
    drive.restoreItemAsAdmin.mockReset()
    publicAssets.listAdminAssets.mockReset()
    publicAssets.getAdminAsset.mockReset()
    publicAssets.listAdminAccessLogs.mockReset()
    publicAssets.listAdminRevisions.mockReset()
    publicAssets.openAdminRevisionDownload.mockReset()
    annotations.listOwnerAnnotations.mockReset()
    annotations.createOwnerAnnotation.mockReset()
    annotations.replyOwnerAnnotation.mockReset()
    annotations.updateOwnerComment.mockReset()
    annotations.deleteOwnerComment.mockReset()
    annotations.deleteOwnerThread.mockReset()
    annotations.listShareAnnotations.mockReset()
    annotations.createShareAnnotation.mockReset()
    annotations.replyShareAnnotation.mockReset()
    annotations.updateShareComment.mockReset()
    annotations.deleteShareComment.mockReset()
    annotations.deleteShareThread.mockReset()
    documentImages.scanOwnerItemImages.mockReset()
    documentImages.importOwnerItemImages.mockReset()
    sites.preflightSite.mockReset()
    sites.createSite.mockReset()
    sites.listSites.mockReset()
    sites.updateSiteAccess.mockReset()
    sites.disableSite.mockReset()
    sites.enableSite.mockReset()
    sites.deleteSite.mockReset()
    sites.republishSite.mockReset()
    sites.resolvePublicSite.mockReset()
    sites.verifySitePassword.mockReset()
    sites.createSiteAccessCookie.mockReset()
    changes.list.mockReset()
    storage.getObjectStream.mockReset()
    storage.getObjectStream.mockResolvedValue({ stream: Readable.from("brief"), size: 5n, contentType: "text/plain" })
    restoreEnv("APP_PUBLIC_URL", originalAppPublicUrl)
    drive.resolvePublicShareAccess.mockRejectedValue(new NotFoundException("文件未找到"))
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController, DrivePublicController],
      providers: [
        { provide: DriveService, useValue: drive },
        { provide: DrivePublicAssetService, useValue: publicAssets },
        { provide: DriveAnnotationService, useValue: annotations },
        { provide: DriveSiteService, useValue: sites },
        { provide: DriveChangeLogService, useValue: changes },
        { provide: "DriveStoragePort", useValue: storage },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: vi.fn(() => { throw new UnauthorizedException("未登录或登录已过期。") }) })
      .compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = null
    vi.unstubAllGlobals()
    restoreEnv("APP_PUBLIC_URL", originalAppPublicUrl)
  })

  it("requires user auth for /api/drive/items", async () => {
    await request(app!.getHttpServer()).get("/api/drive/items").expect(401)
  })

  it("requires user auth for share root image source scans", async () => {
    await request(app!.getHttpServer())
      .get("/api/drive/browser/shares/share-1/image-sources")
      .expect(401)
  })

  it("lists Drive changes for the authenticated user", async () => {
    changes.list.mockResolvedValue({
      items: [],
      nextCursor: "42",
      hasMore: false,
      resyncRequired: false,
    })
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [
        { provide: DriveService, useValue: drive },
        { provide: DriveChangeLogService, useValue: changes },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          context.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        }),
      })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      const response = await request(userApp.getHttpServer())
        .get("/api/drive/changes?cursor=41&limit=50")
        .expect(200)
      expect(response.body).toEqual({
        items: [],
        nextCursor: "42",
        hasMore: false,
        resyncRequired: false,
      })
      expect(changes.list).toHaveBeenCalledWith("user-1", { cursor: "41", limit: 50 })
    } finally {
      await userApp.close()
    }
  })

  it("keeps legacy Drive item list responses and supports paged item lists", async () => {
    drive.listItems.mockResolvedValue([{ id: "legacy-item" }])
    drive.listItemsPage.mockResolvedValue({
      items: [{ id: "paged-item" }],
      page: { offset: 20, limit: 10, hasMore: false, nextOffset: null },
    })
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [
        { provide: DriveService, useValue: drive },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          context.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        }),
      })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      const legacyResponse = await request(userApp.getHttpServer())
        .get("/api/drive/items?parentId=folder-1")
        .expect(200)
      expect(legacyResponse.body).toEqual([{ id: "legacy-item" }])
      expect(drive.listItems).toHaveBeenCalledWith("user-1", "folder-1")
      expect(drive.listItemsPage).not.toHaveBeenCalled()

      const pagedResponse = await request(userApp.getHttpServer())
        .get("/api/drive/items?parentId=folder-1&offset=20&limit=10")
        .expect(200)
      expect(pagedResponse.body).toEqual({
        items: [{ id: "paged-item" }],
        page: { offset: 20, limit: 10, hasMore: false, nextOffset: null },
      })
      expect(drive.listItemsPage).toHaveBeenCalledWith("user-1", "folder-1", { offset: 20, limit: 10 })
    } finally {
      await userApp.close()
    }
  })

  it("requires user auth for owner direct file responses", async () => {
    await request(app!.getHttpServer()).get("/drive/items/root-1/download").expect(401)
  })

  it("creates a Drive site through the authenticated Drive API", async () => {
    const site = createDriveSite()
    vi.stubEnv("APP_PUBLIC_URL", "https://app.example.test")
    sites.createSite.mockResolvedValue(site)
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [
        { provide: DriveService, useValue: drive },
        { provide: DriveAnnotationService, useValue: annotations },
        { provide: DriveSiteService, useValue: sites },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          context.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        }),
      })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      const response = await request(userApp.getHttpServer())
        .post("/api/drive/sites")
        .send({
          sourceFolderItemId: "folder-1",
          name: "产品原型",
          entryPath: null,
          accessMode: "public",
          expiresIn: "forever",
        })
        .expect(201)
      expect((response.body as { readonly siteId?: string }).siteId).toBe("site_public")
      expect(sites.createSite).toHaveBeenCalledWith("user-1", expect.any(String), {
        sourceFolderItemId: "folder-1",
        name: "产品原型",
        entryPath: null,
        accessMode: "public",
        expiresIn: "forever",
      })
    } finally {
      await userApp.close()
    }
  })

  it("allows protected Drive site creation without a user-supplied password", async () => {
    const site = createDriveSite({
      accessMode: "password",
      passwordEnabled: true,
      password: "AbC234xy",
      urlWithPassword: "https://app.example/sites/site_public/?password=AbC234xy",
    })
    vi.stubEnv("APP_PUBLIC_URL", "https://app.example.test")
    sites.createSite.mockResolvedValue(site)
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [
        { provide: DriveService, useValue: drive },
        { provide: DriveAnnotationService, useValue: annotations },
        { provide: DriveSiteService, useValue: sites },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          context.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        }),
      })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      await request(userApp.getHttpServer())
        .post("/api/drive/sites")
        .send({
          sourceFolderItemId: "folder-1",
          name: "产品原型",
          entryPath: null,
          accessMode: "password",
          expiresIn: "3d",
        })
        .expect(201)
      expect(sites.createSite).toHaveBeenCalledWith("user-1", expect.any(String), {
        sourceFolderItemId: "folder-1",
        name: "产品原型",
        entryPath: null,
        accessMode: "password",
        expiresIn: "3d",
      })
    } finally {
      await userApp.close()
    }
  })

  it("serves nested static site assets from the copied deployment", async () => {
    sites.resolvePublicSite.mockResolvedValue({
      status: "ok",
      site: createDriveSite({ accessMode: "public" }),
      asset: {
        storageKey: "drive-sites/site_public/dep-1/assets/app.css",
        relativePath: "assets/app.css",
        contentType: "text/css",
        size: 16n,
      },
    })
    storage.getObjectStream.mockResolvedValue({ stream: Readable.from("body{}"), size: 6n, contentType: "text/css" })

    const response = await request(app!.getHttpServer()).get("/sites/site_public/assets/app.css").expect(200)
    expect(response.headers["content-type"]).toContain("text/css")
    expect(response.headers["cache-control"]).toBe("public, max-age=300")
    expect(response.text).toBe("body{}")
  })

  it("serves the static site root without a redirect loop", async () => {
    sites.resolvePublicSite.mockResolvedValue({
      status: "ok",
      site: createDriveSite({ accessMode: "public" }),
      asset: {
        storageKey: "drive-sites/site_public/dep-1/index.html",
        relativePath: "index.html",
        contentType: "text/html",
        size: 16n,
      },
    })
    storage.getObjectStream.mockResolvedValue({ stream: Readable.from("<h1>Home</h1>"), size: 13n, contentType: "text/html" })

    const response = await request(app!.getHttpServer()).get("/sites/site_public/").expect(200)
    expect(sites.resolvePublicSite).toHaveBeenCalledWith("site_public", { cookie: null, relativePath: "" })
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.text).toBe("<h1>Home</h1>")
  })

  it("prevents shared caching for protected static site assets", async () => {
    sites.resolvePublicSite.mockResolvedValue({
      status: "ok",
      site: createDriveSite({ siteId: "site_secret", accessMode: "password" }),
      asset: {
        storageKey: "drive-sites/site_secret/dep-1/assets/app.js",
        relativePath: "assets/app.js",
        contentType: "text/javascript",
        size: 17n,
      },
    })
    storage.getObjectStream.mockResolvedValue({ stream: Readable.from("console.log(1)"), size: 14n, contentType: "text/javascript" })

    const response = await request(app!.getHttpServer()).get("/sites/site_secret/assets/app.js").expect(200)

    expect(response.headers["content-type"]).toContain("text/javascript")
    expect(response.headers["cache-control"]).toBe("private, no-store")
    expect(response.headers.vary).toBe("Cookie")
    expect(response.text).toBe("console.log(1)")
  })

  it("accepts password query links for protected static sites", async () => {
    sites.createSiteAccessCookie.mockResolvedValue("signed-site-cookie")

    const response = await request(app!.getHttpServer())
      .get("/sites/site_secret/?password=AbC234xy")
      .expect(302)

    expect(sites.createSiteAccessCookie).toHaveBeenCalledWith("site_secret", "AbC234xy")
    expect(response.headers.location).toBe("/sites/site_secret/")
    const setCookie = response.headers["set-cookie"]
    const serializedCookie = Array.isArray(setCookie) ? setCookie.join("\n") : setCookie
    expect(serializedCookie).toContain("drive_access_site_")
    expect(serializedCookie).toContain("signed-site-cookie")
  })

  it("does not leak protected static assets without a site cookie", async () => {
    sites.resolvePublicSite.mockResolvedValue({ status: "password_required" })

    await request(app!.getHttpServer()).get("/sites/site_secret/assets/app.js").expect(404)
    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("calls owner browser APIs with the authenticated user and surface", async () => {
    const snapshot = createBrowserSnapshot()
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [{ provide: DriveService, useValue: drive }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          context.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        }),
      })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      drive.getOwnerConsoleRootBrowserSnapshot.mockResolvedValue(snapshot)
      drive.getOwnerBrowserSnapshot.mockResolvedValue(snapshot)

      await request(userApp.getHttpServer()).get("/api/drive/browser/owner/root?childrenOffset=100&childrenLimit=50").expect(200)
      await request(userApp.getHttpServer()).get("/api/drive/browser/owner/items/root-1?surface=console").expect(200)
      await request(userApp.getHttpServer()).get("/api/drive/browser/owner/items/child-1").expect(200)

      expect(drive.getOwnerConsoleRootBrowserSnapshot).toHaveBeenCalledWith("user-1", { offset: 100, limit: 50 })
      expect(drive.getOwnerBrowserSnapshot).toHaveBeenCalledWith({
        userId: "user-1",
        itemId: "root-1",
        surface: "console",
        childrenPage: undefined,
      })
      expect(drive.getOwnerBrowserSnapshot).toHaveBeenCalledWith({
        userId: "user-1",
        itemId: "child-1",
        surface: "standalone",
        childrenPage: undefined,
      })
    } finally {
      await userApp.close()
    }
  })

  it("routes owner annotation requests through the annotation service", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [
        { provide: DriveService, useValue: drive },
        { provide: DriveAnnotationService, useValue: annotations },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          context.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        }),
      })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      annotations.listOwnerAnnotations.mockResolvedValue([])
      annotations.createOwnerAnnotation.mockResolvedValue(createAnnotationThread())
      annotations.replyOwnerAnnotation.mockResolvedValue(createAnnotationComment())
      annotations.updateOwnerComment.mockResolvedValue(createAnnotationComment())
      annotations.deleteOwnerComment.mockResolvedValue({ ok: true })
      annotations.deleteOwnerThread.mockResolvedValue({ ok: true })

      await request(userApp.getHttpServer()).get("/api/drive/browser/owner/items/item-1/annotations").expect(200)
      await request(userApp.getHttpServer())
        .post("/api/drive/browser/owner/items/item-1/annotations")
        .send(createAnnotationInput())
        .expect(201)
      await request(userApp.getHttpServer())
        .post("/api/drive/browser/owner/items/item-1/annotations/thread-1/comments")
        .send({ parentCommentId: null, body: "Reply body" })
        .expect(201)
      await request(userApp.getHttpServer())
        .patch("/api/drive/browser/owner/items/item-1/annotations/comments/comment-1")
        .send({ body: "Updated body" })
        .expect(200)
      await request(userApp.getHttpServer()).delete("/api/drive/browser/owner/items/item-1/annotations/comments/comment-1").expect(200)
      await request(userApp.getHttpServer()).delete("/api/drive/browser/owner/items/item-1/annotations/thread-1").expect(200)

      expect(annotations.listOwnerAnnotations).toHaveBeenCalledWith("user-1", "item-1")
      expect(annotations.createOwnerAnnotation).toHaveBeenCalledWith(
        "user-1",
        "item-1",
        expect.objectContaining({ body: "Comment body" }),
        expect.objectContaining({ ipAddress: expect.any(String) }),
      )
      expect(annotations.replyOwnerAnnotation).toHaveBeenCalledWith(
        "user-1",
        "item-1",
        "thread-1",
        { parentCommentId: null, body: "Reply body" },
        expect.objectContaining({ ipAddress: expect.any(String) }),
      )
      expect(annotations.updateOwnerComment).toHaveBeenCalledWith(
        "user-1",
        "item-1",
        "comment-1",
        { body: "Updated body" },
        expect.objectContaining({ ipAddress: expect.any(String) }),
      )
      expect(annotations.deleteOwnerComment).toHaveBeenCalledWith("user-1", "item-1", "comment-1", expect.objectContaining({ ipAddress: expect.any(String) }))
      expect(annotations.deleteOwnerThread).toHaveBeenCalledWith("user-1", "item-1", "thread-1", expect.objectContaining({ ipAddress: expect.any(String) }))
    } finally {
      await userApp.close()
    }
  })

  it("routes owner browser image source requests through the document image service", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [
        { provide: DriveService, useValue: drive },
        { provide: DriveDocumentImageService, useValue: documentImages },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          context.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        }),
      })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      vi.stubEnv("APP_PUBLIC_URL", "https://app.example.test")
      documentImages.scanOwnerItemImages.mockResolvedValue({ sources: [] })
      documentImages.importOwnerItemImages.mockResolvedValue({ sources: [], imported: [] })

      await request(userApp.getHttpServer()).get("/api/drive/browser/owner/items/item-1/image-sources").expect(200)
      await request(userApp.getHttpServer())
        .post("/api/drive/browser/owner/items/item-1/image-sources/import")
        .send({ baseVersionId: "version-1", sources: [{ src: "https://example.com/a.png" }] })
        .expect(201)

      expect(documentImages.scanOwnerItemImages).toHaveBeenCalledWith({
        actorUserId: "user-1",
        itemId: "item-1",
      })
      expect(documentImages.importOwnerItemImages).toHaveBeenCalledWith(expect.objectContaining({
        actorUserId: "user-1",
        itemId: "item-1",
        body: { baseVersionId: "version-1", sources: [{ src: "https://example.com/a.png" }] },
      }))
    } finally {
      await userApp.close()
    }
  })

  it("routes owner file version operations through the authenticated user", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [{ provide: DriveService, useValue: drive }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          context.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        }),
      })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      drive.listFileVersions.mockResolvedValue({ items: [], total: 0, page: { offset: 10, limit: 5, hasMore: false, nextOffset: null } })
      drive.restoreFileVersion.mockResolvedValue({ id: "file-1" })
      drive.updateFileVersionPin.mockResolvedValue({ id: "ver-1", isPinned: true })
      drive.deleteFileVersion.mockResolvedValue({ ok: true })

      await request(userApp.getHttpServer()).get("/api/drive/items/file-1/versions?offset=10&limit=5").expect(200)
      await request(userApp.getHttpServer()).post("/api/drive/items/file-1/versions/ver-1/restore").expect(201)
      await request(userApp.getHttpServer()).patch("/api/drive/items/file-1/versions/ver-1").send({ isPinned: true }).expect(200)
      await request(userApp.getHttpServer()).delete("/api/drive/items/file-1/versions/ver-1").expect(200)

      expect(drive.listFileVersions).toHaveBeenCalledWith("user-1", "file-1", { offset: 10, limit: 5 })
      expect(drive.restoreFileVersion).toHaveBeenCalledWith("user-1", "file-1", "ver-1", expect.any(Object))
      expect(drive.updateFileVersionPin).toHaveBeenCalledWith("user-1", "file-1", "ver-1", true, expect.any(Object))
      expect(drive.deleteFileVersion).toHaveBeenCalledWith("user-1", "file-1", "ver-1", expect.any(Object))
    } finally {
      await userApp.close()
    }
  })

  it("routes owner trash operations through the authenticated user", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [{ provide: DriveService, useValue: drive }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          context.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        }),
      })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      drive.listTrash.mockResolvedValue({ items: [], total: 0, page: { offset: 10, limit: 5, hasMore: false, nextOffset: null } })
      drive.restoreItem.mockResolvedValue({ id: "file-1" })
      drive.hideTrashedItem.mockResolvedValue({ ok: true })

      await request(userApp.getHttpServer()).get("/api/drive/trash?offset=10&limit=5").expect(200)
      await request(userApp.getHttpServer()).post("/api/drive/items/file-1/restore").expect(201)
      await request(userApp.getHttpServer()).delete("/api/drive/trash/file-1").expect(200)

      expect(drive.listTrash).toHaveBeenCalledWith("user-1", { offset: 10, limit: 5 })
      expect(drive.restoreItem).toHaveBeenCalledWith("user-1", "file-1", "user-1", expect.any(String))
      expect(drive.hideTrashedItem).toHaveBeenCalledWith("user-1", "file-1", "user-1", expect.any(String))
    } finally {
      await userApp.close()
    }
  })

  it("records audit when admins list drive items", async () => {
    const auditLog = { record: vi.fn(async () => undefined) }
    const controller = new DriveAdminController(drive as unknown as DriveService, publicAssets as never, auditLog as never)
    drive.listAdminItems.mockResolvedValue({
      data: [{ id: "item-1" }],
      total: 1,
      page: 2,
      pageSize: 10,
    })

    const result = await controller.listItems({
      page: "2",
      pageSize: "10",
      userId: "user-1",
      storageStatus: "active",
      search: "report",
    }, {
      admin: { email: "admin@example.com" },
      ip: "127.0.0.1",
    } as never)

    expect(result).toMatchObject({ total: 1, page: 2, pageSize: 10 })
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.drive.items.list",
      targetType: "drive_item",
      targetId: "list",
      ipAddress: "127.0.0.1",
      detail: expect.objectContaining({
        page: 2,
        pageSize: 10,
        count: 1,
        total: 1,
        filters: expect.objectContaining({
          userId: "user-1",
          storageStatus: "active",
          search: "report",
        }),
      }),
    }))
  })

  it("routes admin public asset APIs and audits downloads", async () => {
    process.env.APP_PUBLIC_URL = "https://dashboard.example"
    const auditLog = { record: vi.fn(async () => undefined) }
    const controller = new DriveAdminController(drive as unknown as DriveService, publicAssets as never, auditLog as never)
    const response = createDownloadResponse()
    publicAssets.listAdminAssets.mockResolvedValue({ data: [{ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ" }], total: 1, page: 1, pageSize: 20 })
    publicAssets.getAdminAsset.mockResolvedValue({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ" })
    publicAssets.listAdminAccessLogs.mockResolvedValue({
      data: [{ referer: "https://secret.example/path?token=leak", userAgent: "Sensitive Browser" }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    publicAssets.listAdminRevisions.mockResolvedValue({ data: [{ id: "rev-1" }], total: 1, page: 1, pageSize: 20 })
    publicAssets.openAdminRevisionDownload.mockResolvedValue({
      stream: Readable.from("old"),
      fileName: "logo-old.png",
      size: 3n,
      contentType: "image/png",
    })
    drive.openAdminItemDownload.mockResolvedValue({
      stream: Readable.from("file"),
      fileName: "brief.txt",
      size: 4n,
      contentType: "text/plain",
    })
    drive.restoreItemAsAdmin.mockResolvedValue({ id: "item-1" })
    drive.getAdminStorageSummary.mockResolvedValue({ total: { quotaBytes: "1" } })

    const requestContext = {
      admin: { email: "admin@example.com" },
      ip: "127.0.0.1",
      headers: { host: "dashboard.example" },
    } as never

    await controller.listPublicAssets({ page: "1" }, requestContext)
    await controller.getPublicAsset("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", requestContext)
    await controller.listPublicAssetAccessLogs("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", { page: "1" }, requestContext)
    await controller.listPublicAssetRevisions("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", { page: "1" }, requestContext)
    await controller.downloadPublicAssetRevision("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", "rev-1", requestContext, response as never)
    await controller.downloadItem("item-1", requestContext, response as never)
    await controller.restoreItem("item-1", requestContext)
    await controller.getStorageSummary(requestContext)

    expect(publicAssets.listAdminAssets).toHaveBeenCalledWith("https://dashboard.example", expect.objectContaining({ pagination: expect.any(Object) }))
    expect(publicAssets.getAdminAsset).toHaveBeenCalledWith("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", "https://dashboard.example")
    expect(publicAssets.listAdminAccessLogs).toHaveBeenCalledWith("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", expect.objectContaining({ page: 1 }))
    expect(publicAssets.listAdminRevisions).toHaveBeenCalledWith("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", expect.objectContaining({ page: 1 }))
    expect(publicAssets.openAdminRevisionDownload).toHaveBeenCalledWith("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", "rev-1")
    expect(drive.openAdminItemDownload).toHaveBeenCalledWith("item-1")
    expect(drive.restoreItemAsAdmin).toHaveBeenCalledWith("item-1", "admin@example.com", "127.0.0.1")
    expect(drive.getAdminStorageSummary).toHaveBeenCalled()
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.drive.public_assets.list",
      targetType: "drive_public_asset",
      targetId: "list",
      detail: expect.objectContaining({ count: 1, total: 1 }),
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.drive.public_asset.get",
      targetType: "drive_public_asset",
      targetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.drive.public_asset_access_logs.list",
      targetType: "drive_public_asset",
      targetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      detail: expect.objectContaining({ count: 1, total: 1 }),
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.drive.public_asset_revisions.list",
      targetType: "drive_public_asset",
      targetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      detail: expect.objectContaining({ count: 1, total: 1 }),
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.drive.public_asset_revision.download",
      targetType: "drive_public_asset_revision",
      targetId: "rev-1",
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.drive.item.download",
      targetType: "drive_item",
      targetId: "item-1",
    }))
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("secret.example")
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("Sensitive Browser")
    expect(response.attachment).toHaveBeenCalledWith("logo-old.png")
    expect(response.attachment).toHaveBeenCalledWith("brief.txt")
  })

  it("records failed admin download audits when stream transfer fails", async () => {
    const auditLog = { record: vi.fn(async () => undefined) }
    const controller = new DriveAdminController(drive as unknown as DriveService, publicAssets as never, auditLog as never)
    const requestContext = {
      admin: { email: "admin@example.com" },
      ip: "127.0.0.1",
      headers: { host: "dashboard.example" },
    } as never

    drive.openAdminItemDownload.mockResolvedValue({
      stream: createFailingReadable("drive stream failed token=secret"),
      fileName: "brief.txt",
      size: 4n,
      contentType: "text/plain",
    })

    await expect(controller.downloadItem("item-1", requestContext, createDownloadResponse() as never))
      .rejects.toThrow("drive stream failed")

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      adminEmail: "admin@example.com",
      action: "admin.drive.item.download",
      targetType: "drive_item",
      targetId: "item-1",
      detail: expect.objectContaining({
        itemId: "item-1",
        name: "brief.txt",
        status: "failed",
        errorName: "Error",
        errorLength: "drive stream failed token=secret".length,
      }),
    }))
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("token=secret")
  })

  it("redirects owner direct downloads and renders owner files", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DrivePublicController],
      providers: [
        { provide: DriveService, useValue: drive },
        { provide: "DriveStoragePort", useValue: storage },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: vi.fn((context) => {
        context.switchToHttp().getRequest().user = { id: "user-1" }
        return true
      }) })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      drive.openOwnerBrowserItemDownload.mockResolvedValue({
        stream: Readable.from("brief"),
        fileName: "brief.txt",
        size: 5n,
        contentType: "text/plain",
      })
      drive.resolveOwnerRenderAccess
        .mockRejectedValueOnce(new BadRequestException("只能访问 HTML 文件。"))
        .mockResolvedValueOnce({
          stream: Readable.from("<!doctype html><html><body>Notes</body></html>"),
          contentType: "text/html; charset=utf-8",
        })

      const download = await request(userApp.getHttpServer()).get("/drive/items/file-1/download").expect(200)
      expect(download.text).toBe("brief")
      expect(download.headers["content-disposition"]).toContain("brief.txt")
      expect(drive.openOwnerBrowserItemDownload).toHaveBeenCalledWith({
        userId: "user-1",
        itemId: "file-1",
      })

      await request(userApp.getHttpServer()).get("/drive/items/root-1/render").expect(400)

      const render = await request(userApp.getHttpServer())
        .get("/drive/items/file-1/render")
        .expect(200)
      expect(render.headers["content-type"]).toContain("text/html; charset=utf-8")
      expectDriveHtmlRenderCsp(render.headers["content-security-policy"])
      expect(render.text).toContain("Notes")
      expect(drive.resolveOwnerRenderAccess).toHaveBeenLastCalledWith({
        userId: "user-1",
        itemId: "file-1",
      })
    } finally {
      await userApp.close()
    }
  })

  it("rejects oversized local uploads before accepting the request body", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-upload-"))
    const localStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveLocalStorageController],
      providers: [{ provide: LocalDriveStorage, useValue: localStorage }],
    }).compile()
    const localApp = moduleRef.createNestApplication()
    await localApp.init()
    try {
      const upload = await localStorage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain", expectedSize: 5n })
      const uploadToken = upload.url.split("/").at(-1)
      if (!uploadToken) throw new Error("missing upload token")

      await request(localApp.getHttpServer())
        .put(`/api/drive/local-upload/${uploadToken}`)
        .set("Content-Type", "text/plain")
        .send("too-large")
        .expect(413)
    } finally {
      await localApp.close()
      await rm(root, { force: true, recursive: true })
    }
  })

  it("returns a controlled error when a local download object is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-download-"))
    const localStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveLocalStorageController],
      providers: [{ provide: LocalDriveStorage, useValue: localStorage }],
    }).compile()
    const localApp = moduleRef.createNestApplication()
    await localApp.init()
    try {
      const upload = await localStorage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain", expectedSize: 5n })
      const uploadToken = upload.url.split("/").at(-1)
      if (!uploadToken) throw new Error("missing upload token")
      await localStorage.acceptUpload(uploadToken, Readable.from("brief"))
      const download = await localStorage.createDownloadUrl({ key: "drive/item-1", filename: "brief.txt" })
      const downloadToken = download.url.split("/").at(-1)
      if (!downloadToken) throw new Error("missing download token")
      await localStorage.deleteObject("drive/item-1")

      const response = await request(localApp.getHttpServer())
        .get(`/api/drive/local-download/${downloadToken}`)
        .expect(404)

      expect(response.body).toEqual({ error: "文件不存在或已被删除。" })
    } finally {
      await localApp.close()
      await rm(root, { force: true, recursive: true })
    }
  })

  it("redacts local download failure logs", async () => {
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const sensitiveError = new Error("download failed Authorization: Bearer canary-token apiKey=canary-key https://user:pass@example.test/private /Users/example/file.txt")
    Object.assign(sensitiveError, { storageKey: "drive/item-secret-storage-key" })
    const localStorage = {
      resolveDownload: vi.fn(() => {
        throw sensitiveError
      }),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveLocalStorageController],
      providers: [{ provide: LocalDriveStorage, useValue: localStorage }],
    }).compile()
    const localApp = moduleRef.createNestApplication()
    await localApp.init()
    try {
      await request(localApp.getHttpServer())
        .get("/api/drive/local-download/download-token")
        .expect(500)

      expect(warnSpy).toHaveBeenCalled()
      const payload = JSON.stringify(warnSpy.mock.calls.at(-1)?.[0])
      expect(payload).not.toContain("canary-token")
      expect(payload).not.toContain("canary-key")
      expect(payload).not.toContain("user:pass")
      expect(payload).not.toContain("/Users/example/file.txt")
      expect(payload).not.toContain("drive/item-secret-storage-key")
    } finally {
      await localApp.close()
      warnSpy.mockRestore()
    }
  })

  it("returns public not found for missing browser share ids", async () => {
    const response = await request(app!.getHttpServer()).get("/api/drive/browser/shares/shr_missing").expect(404)
    expect(response.text).toContain("文件未找到")
  })

  it("prepares folder uploads through the user API", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [{ provide: DriveService, useValue: drive }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: vi.fn((context) => {
        context.switchToHttp().getRequest().user = { id: "user-1" }
        return true
      }) })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      process.env.APP_PUBLIC_URL = "https://app.example"
      drive.prepareFolderUpload.mockResolvedValue({ root: { id: "folder-1" }, rootCreated: true, entries: [] })
      await request(userApp.getHttpServer())
        .post("/api/drive/uploads/folder/prepare")
        .send({ parentId: null, folderName: "交接材料", files: [{ relativePath: "brief.txt", size: "11", mimeType: "text/plain" }] })
        .expect(201)
      expect(drive.prepareFolderUpload).toHaveBeenCalledWith("user-1", expect.objectContaining({
        parentId: null,
        folderName: "交接材料",
      }), expect.objectContaining({ ipAddress: expect.any(String) }))
    } finally {
      await userApp.close()
    }
  })

  it("passes access settings through share APIs", async () => {
    process.env.APP_PUBLIC_URL = "https://app.example"
    const share = {
      id: "share-row-1",
      shareId: "shr_public",
      itemId: "file-1",
      enabled: true,
      url: "https://app.example/share/shr_public",
      urlWithPassword: "https://app.example/share/shr_public",
      passwordEnabled: false,
      password: null,
      expiresAt: null,
      accessMode: "link_read",
      editorEmails: [],
      createdAt: "2026-06-09T00:00:00.000Z",
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [{ provide: DriveService, useValue: drive }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: vi.fn((context) => {
        context.switchToHttp().getRequest().user = { id: "user-1" }
        return true
      }) })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      drive.createShare.mockResolvedValue(share)

      await request(userApp.getHttpServer())
        .post("/api/drive/items/file-1/share")
        .send({ passwordEnabled: false, expiresIn: "3d" })
        .expect(201)

      expect(drive.createShare).toHaveBeenCalledWith("user-1", "file-1", "https://app.example", {
        passwordEnabled: false,
        expiresIn: "3d",
        accessMode: "link_read",
        editorEmails: [],
      }, expect.objectContaining({ ipAddress: expect.any(String) }))
    } finally {
      await userApp.close()
    }
  })

  it("rejects share URL generation when APP_PUBLIC_URL is missing", async () => {
    process.env.APP_PUBLIC_URL = ""
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController],
      providers: [{ provide: DriveService, useValue: drive }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: vi.fn((context) => {
        context.switchToHttp().getRequest().user = { id: "user-1" }
        return true
      }) })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      await request(userApp.getHttpServer())
        .post("/api/drive/items/file-1/share")
        .set("Host", "evil.example.com")
        .expect(500)

      expect(drive.createShare).not.toHaveBeenCalled()
    } finally {
      await userApp.close()
    }
  })

  it("returns typed password-required responses for protected share browser APIs", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({ status: "password_required" })

    const response = await request(app!.getHttpServer()).get("/api/drive/browser/shares/shr_locked").expect(200)

    expect(response.body).toEqual({ passwordRequired: true, message: "请输入密码。" })
    expect(drive.getShareBrowserSnapshot).not.toHaveBeenCalled()
  })

  it("reads share browser access cookies from resource scoped slots", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({ status: "password_required" })
    const cookieHeader = [
      `${driveAccessCookieName("share", "shr_file")}=file-cookie`,
      `${driveAccessCookieName("share", "shr_folder")}=folder-cookie`,
    ].join("; ")

    await request(app!.getHttpServer()).get("/api/drive/browser/shares/shr_file").set("Cookie", cookieHeader).expect(200)
    await request(app!.getHttpServer()).get("/api/drive/browser/shares/shr_folder").set("Cookie", cookieHeader).expect(200)

    expect(drive.resolvePublicShareAccess).toHaveBeenNthCalledWith(1, {
      shareId: "shr_file",
      password: undefined,
      cookie: "file-cookie",
    })
    expect(drive.resolvePublicShareAccess).toHaveBeenNthCalledWith(2, {
      shareId: "shr_folder",
      password: undefined,
      cookie: "folder-cookie",
    })
  })

  it("routes share annotation reads publicly and writes through authenticated users", async () => {
    annotations.listShareAnnotations.mockResolvedValue([])
    annotations.createShareAnnotation.mockResolvedValue(createAnnotationThread())
    annotations.replyShareAnnotation.mockResolvedValue(createAnnotationComment())
    annotations.updateShareComment.mockResolvedValue(createAnnotationComment())
    annotations.deleteShareComment.mockResolvedValue({ ok: true })
    annotations.deleteShareThread.mockResolvedValue({ ok: true })

    const cookieHeader = `${driveAccessCookieName("share", "shr_file")}=file-cookie`
    await request(app!.getHttpServer())
      .get("/api/drive/browser/shares/shr_file/items/file-1/annotations")
      .set("Cookie", cookieHeader)
      .expect(200)

    expect(annotations.listShareAnnotations).toHaveBeenCalledWith({
      shareId: "shr_file",
      itemId: "file-1",
      cookie: "file-cookie",
      actorUserId: null,
    })

    const dashboardAuth = {
      verifyDashboardSession: vi.fn(async () => ({
        id: "reader-1",
        email: "reader@example.com",
        displayName: "Reader",
        role: "user" as const,
      })),
    }
    const readModuleRef = await Test.createTestingModule({
      controllers: [DrivePublicController],
      providers: [
        { provide: DriveService, useValue: drive },
        { provide: DriveAnnotationService, useValue: annotations },
        { provide: AdminAuthService, useValue: dashboardAuth },
        { provide: "DriveStoragePort", useValue: storage },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: vi.fn(() => { throw new UnauthorizedException("未登录或登录已过期。") }) })
      .compile()
    const readApp = readModuleRef.createNestApplication()
    await readApp.init()
    try {
      await request(readApp.getHttpServer())
        .get("/api/drive/browser/shares/shr_file/items/file-1/annotations")
        .set("Cookie", `${cookieHeader}; synapse_admin=dashboard-cookie`)
        .expect(200)

      expect(dashboardAuth.verifyDashboardSession).toHaveBeenCalledWith("dashboard-cookie")
      expect(annotations.listShareAnnotations).toHaveBeenLastCalledWith({
        shareId: "shr_file",
        itemId: "file-1",
        cookie: "file-cookie",
        actorUserId: "reader-1",
      })
    } finally {
      await readApp.close()
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [DrivePublicController],
      providers: [
        { provide: DriveService, useValue: drive },
        { provide: DriveAnnotationService, useValue: annotations },
        { provide: "DriveStoragePort", useValue: storage },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          context.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        }),
      })
      .compile()
    const shareApp = moduleRef.createNestApplication()
    await shareApp.init()
    try {
      await request(shareApp.getHttpServer())
        .post("/api/drive/browser/shares/shr_file/items/file-1/annotations")
        .set("Cookie", cookieHeader)
        .send(createAnnotationInput())
        .expect(201)
      await request(shareApp.getHttpServer())
        .post("/api/drive/browser/shares/shr_file/items/file-1/annotations/thread-1/comments")
        .set("Cookie", cookieHeader)
        .send({ parentCommentId: "comment-1", body: "Reply body" })
        .expect(201)
      await request(shareApp.getHttpServer())
        .patch("/api/drive/browser/shares/shr_file/items/file-1/annotations/comments/comment-1")
        .set("Cookie", cookieHeader)
        .send({ body: "Updated body" })
        .expect(200)
      await request(shareApp.getHttpServer())
        .delete("/api/drive/browser/shares/shr_file/items/file-1/annotations/comments/comment-1")
        .set("Cookie", cookieHeader)
        .expect(200)
      await request(shareApp.getHttpServer())
        .delete("/api/drive/browser/shares/shr_file/items/file-1/annotations/thread-1")
        .set("Cookie", cookieHeader)
        .expect(200)

      expect(annotations.createShareAnnotation).toHaveBeenCalledWith(expect.objectContaining({
        actorUserId: "user-1",
        shareId: "shr_file",
        itemId: "file-1",
        cookie: "file-cookie",
        body: expect.objectContaining({ body: "Comment body" }),
        auditContext: expect.objectContaining({ ipAddress: expect.any(String) }),
      }))
      expect(annotations.replyShareAnnotation).toHaveBeenCalledWith(expect.objectContaining({
        actorUserId: "user-1",
        shareId: "shr_file",
        itemId: "file-1",
        threadId: "thread-1",
        body: { parentCommentId: "comment-1", body: "Reply body" },
        auditContext: expect.objectContaining({ ipAddress: expect.any(String) }),
      }))
      expect(annotations.updateShareComment).toHaveBeenCalledWith(expect.objectContaining({
        actorUserId: "user-1",
        commentId: "comment-1",
        body: { body: "Updated body" },
        auditContext: expect.objectContaining({ ipAddress: expect.any(String) }),
      }))
      expect(annotations.deleteShareComment).toHaveBeenCalledWith(expect.objectContaining({
        commentId: "comment-1",
        auditContext: expect.objectContaining({ ipAddress: expect.any(String) }),
      }))
      expect(annotations.deleteShareThread).toHaveBeenCalledWith(expect.objectContaining({
        threadId: "thread-1",
        auditContext: expect.objectContaining({ ipAddress: expect.any(String) }),
      }))
    } finally {
      await shareApp.close()
    }
  })

  it("unlocks share browser access and returns the browser snapshot", async () => {
    const snapshot = createBrowserSnapshot()
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      cookie: "access-cookie",
      value: {
        type: "file",
        item: createDriveItem({ id: "file-1", name: "secret.txt" }),
        ownerId: "user-1",
        storageKey: "drive/file-1",
      },
    })
    drive.getShareBrowserSnapshot.mockResolvedValue(snapshot)

    const response = await request(app!.getHttpServer())
      .post("/api/drive/browser/shares/shr_file/access?childrenOffset=20&childrenLimit=10")
      .send({ password: "letmein" })
      .expect(201)
    const setCookie = response.headers["set-cookie"]

    expect(response.body).toEqual(snapshot)
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain(`${driveAccessCookieName("share", "shr_file")}=access-cookie`)
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain("HttpOnly")
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: "letmein",
      cookie: undefined,
    })
    expect(drive.getShareBrowserSnapshot).toHaveBeenCalledWith({
      shareId: "shr_file",
      actorUserId: null,
      itemId: undefined,
      password: "letmein",
      cookie: "access-cookie",
      childrenPage: { offset: 20, limit: 10 },
    })
  })

  it("accepts unlock requests for unprotected shares without requiring a cookie", async () => {
    const snapshot = createBrowserSnapshot()
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      value: {
        type: "file",
        item: createDriveItem({ id: "file-1", name: "brief.txt" }),
        ownerId: "user-1",
        storageKey: "drive/file-1",
      },
    })
    drive.getShareBrowserSnapshot.mockResolvedValue(snapshot)

    const response = await request(app!.getHttpServer())
      .post("/api/drive/browser/shares/shr_file/access")
      .send({ password: "stale" })
      .expect(201)

    expect(response.body).toEqual(snapshot)
    expect(response.headers["set-cookie"]).toBeUndefined()
    expect(drive.getShareBrowserSnapshot).toHaveBeenCalledWith({
      shareId: "shr_file",
      actorUserId: null,
      itemId: undefined,
      password: "stale",
      cookie: undefined,
      childrenPage: undefined,
    })
  })

  it("redirects unprotected share password posts without setting an access cookie", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      value: {
        type: "file",
        item: createDriveItem({ id: "file-1", name: "brief.txt" }),
        ownerId: "user-1",
        storageKey: "drive/file-1",
      },
    })

    const response = await request(app!.getHttpServer())
      .post("/share/shr_file")
      .send({ password: "stale" })
      .expect(302)

    expect(response.headers.location).toBe("/share/shr_file")
    expect(response.headers["set-cookie"]).toBeUndefined()
  })

  it("unlocks share browser child access and returns the child snapshot", async () => {
    const snapshot = createBrowserSnapshot()
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      cookie: "access-cookie",
      value: {
        type: "folder",
        item: createDriveItem({ id: "folder-1", name: "folder", type: "folder" }),
        ownerId: "user-1",
        storageKey: null,
      },
    })
    drive.getShareBrowserSnapshot.mockResolvedValue(snapshot)

    await request(app!.getHttpServer())
      .post("/api/drive/browser/shares/shr_folder/items/file-1/access")
      .send({ password: "letmein" })
      .expect(201)

    expect(drive.getShareBrowserSnapshot).toHaveBeenCalledWith({
      shareId: "shr_folder",
      actorUserId: null,
      itemId: "file-1",
      password: "letmein",
      cookie: "access-cookie",
      childrenPage: undefined,
    })
  })

  it("ignores password query on share browser APIs", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "password_required",
    })

    const response = await request(app!.getHttpServer()).get("/api/drive/browser/shares/shr_file?password=stale").expect(200)

    expect(response.body).toEqual({
      message: "请输入密码。",
      passwordRequired: true,
    })
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: undefined,
      cookie: undefined,
    })
    expect(drive.getShareBrowserSnapshot).not.toHaveBeenCalled()
  })

  it("leaves share browser page routes to the SPA", async () => {
    await request(app!.getHttpServer()).get("/share/shr_file").expect(404)
    expect(drive.resolvePublicShareAccess).not.toHaveBeenCalled()
    expect(drive.openShareBrowserItemDownload).not.toHaveBeenCalled()
  })

  it("posts share passwords and redirects after unlock", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      cookie: "posted-cookie",
      value: {
        type: "file",
        item: createDriveItem({ id: "file-1", name: "brief.txt" }),
        ownerId: "user-1",
        storageKey: "drive/file-1",
      },
    })

    const response = await request(app!.getHttpServer())
      .post("/share/shr_file")
      .send({ password: "letmein" })
      .expect(302)
    const setCookie = response.headers["set-cookie"]

    expect(response.headers.location).toBe("/share/shr_file")
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain(`${driveAccessCookieName("share", "shr_file")}=posted-cookie`)
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: "letmein",
      cookie: undefined,
    })
  })

  it("posts share passwords for direct downloads and redirects back", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      cookie: "posted-cookie",
      value: {
        type: "file",
        item: createDriveItem({ id: "file-1", name: "brief.txt" }),
        ownerId: "user-1",
        storageKey: "drive/file-1",
      },
    })

    const response = await request(app!.getHttpServer())
      .post("/share/shr_file/download")
      .send({ password: "letmein" })
      .expect(302)
    const setCookie = response.headers["set-cookie"]

    expect(response.headers.location).toBe("/share/shr_file/download")
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain(`${driveAccessCookieName("share", "shr_file")}=posted-cookie`)
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: "letmein",
      cookie: undefined,
    })
  })

  it("posts share passwords for child folder downloads and redirects back", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      cookie: "posted-cookie",
      value: {
        type: "folder",
        item: createDriveItem({ id: "folder-1", name: "交接材料", type: "folder" }),
        ownerId: "user-1",
        storageKey: null,
      },
    })

    const response = await request(app!.getHttpServer())
      .post("/share/shr_folder/items/folder-2/download")
      .send({ password: "letmein" })
      .expect(302)
    const setCookie = response.headers["set-cookie"]

    expect(response.headers.location).toBe("/share/shr_folder/items/folder-2/download")
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain(`${driveAccessCookieName("share", "shr_folder")}=posted-cookie`)
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_folder",
      password: "letmein",
      cookie: undefined,
    })
  })

  it("cleans stale password query for share downloads before creating storage URLs", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      value: {
        type: "file",
        item: createDriveItem({ id: "file-1", name: "brief.txt", size: "11" }),
        ownerId: "user-1",
        storageKey: "drive/file-1",
      },
    })

    const response = await request(app!.getHttpServer()).get("/share/shr_file/download?password=stale").expect(302)

    expect(response.headers.location).toBe("/share/shr_file/download")
    expect(drive.openShareBrowserItemDownload).not.toHaveBeenCalled()
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: "stale",
      cookie: undefined,
    })
  })

  it("cleans stale password query for share renders before reading storage", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      value: {
        type: "file",
        item: createDriveItem({ id: "file-1", name: "index.html", size: "11", mimeType: "text/html" }),
        ownerId: "user-1",
        storageKey: "drive/file-1",
      },
      cookie: "render-cookie",
    })

    const response = await request(app!.getHttpServer()).get("/share/shr_file/render?password=stale").expect(302)
    const setCookie = response.headers["set-cookie"]

    expect(response.headers.location).toBe("/share/shr_file/render")
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain(`${driveAccessCookieName("share", "shr_file")}=render-cookie`)
    expect(drive.resolveShareRenderAccess).not.toHaveBeenCalled()
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: "stale",
      cookie: undefined,
    })
  })

  it("allows canonical share renders to be embedded by the share reader", async () => {
    drive.resolveShareRenderAccess.mockResolvedValue({
      status: "ok",
      value: {
        stream: Readable.from("<!doctype html><html><body>Shared page</body></html>"),
        contentType: "text/html; charset=utf-8",
      },
    })

    const response = await request(app!.getHttpServer())
      .get("/share/shr_file/render")
      .expect(200)

    expect(response.headers["content-type"]).toContain("text/html; charset=utf-8")
    expectDriveHtmlRenderCsp(response.headers["content-security-policy"])
    expect(response.text).toContain("Shared page")
    expect(drive.resolveShareRenderAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      itemId: undefined,
      cookie: undefined,
    })
  })

  it("renders password errors when posted share passwords are wrong", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({ status: "password_required" })

    const response = await request(app!.getHttpServer())
      .post("/share/shr_file")
      .send({ password: "wrong" })
      .expect(200)

    expect(response.text).toContain("密码错误")
    expect(response.text).toContain("drive-password-shell")
    expect(response.text).toContain('aria-invalid="true"')
    expect(response.text).toContain('aria-describedby="drive-password-error"')
  })

  it("renders password errors on direct download password posts", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({ status: "password_required" })

    const response = await request(app!.getHttpServer())
      .post("/share/shr_file/download")
      .send({ password: "wrong" })
      .expect(200)

    expect(response.text).toContain("密码错误")
    expect(response.text).toContain("drive-password-shell")
    expect(response.text).toContain('action="/share/shr_file/download"')
    expect(response.text).toContain('aria-invalid="true"')
    expect(response.text).toContain('aria-describedby="drive-password-error"')
  })

  it("renders password pages for protected direct downloads opened without a cookie", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({ status: "password_required" })

    const response = await request(app!.getHttpServer())
      .get("/share/shr_file/download")
      .expect(200)

    expect(response.text).toContain("输入密码")
    expect(response.text).toContain("drive-password-shell")
    expect(response.text).toContain('action="/share/shr_file/download"')
    expect(response.text).toContain("--background: Canvas")
    expect(response.text).toContain("color-scheme: light dark")
    expect(response.text).not.toContain("oklch(")
    expect(response.text).not.toContain("color-mix(")
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: undefined,
      cookie: undefined,
    })
    expect(drive.openShareBrowserItemDownload).not.toHaveBeenCalled()
  })

  it("renders invalid link pages for unavailable direct downloads", async () => {
    drive.resolvePublicShareAccess.mockRejectedValue(new NotFoundException("文件未找到"))

    const response = await request(app!.getHttpServer())
      .get("/share/shr_file/download")
      .expect(404)

    expect(response.text).toContain("链接已失效")
    expect(response.text).toContain("请向文件所有者确认最新链接。")
    expect(response.text).not.toContain("文件未找到")
  })

  it("renders password pages for protected direct renders opened without a cookie", async () => {
    drive.resolveShareRenderAccess.mockResolvedValue({ status: "password_required" })

    const response = await request(app!.getHttpServer())
      .get("/share/shr_file/render")
      .expect(200)

    expect(response.text).toContain("输入密码")
    expect(response.text).toContain("drive-password-shell")
    expect(response.text).toContain('action="/share/shr_file/render"')
    expect(drive.resolveShareRenderAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      itemId: undefined,
      cookie: undefined,
    })
  })

  it("renders invalid link pages for unavailable direct renders", async () => {
    drive.resolveShareRenderAccess.mockRejectedValue(new NotFoundException("文件未找到"))

    const response = await request(app!.getHttpServer())
      .get("/share/shr_file/render")
      .expect(404)

    expect(response.text).toContain("链接已失效")
    expect(response.text).toContain("请向文件所有者确认最新链接。")
    expect(response.text).not.toContain("文件未找到")
  })

  it("streams canonical public file downloads", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      value: {
        type: "folder",
        item: createDriveItem({ id: "folder-1", name: "交接材料", type: "folder" }),
        ownerId: "user-1",
        storageKey: null,
      },
    })
    drive.openShareBrowserItemDownload
      .mockResolvedValueOnce({ stream: Readable.from("root"), fileName: "root.txt", size: 4n, contentType: "text/plain" })
      .mockResolvedValueOnce({ stream: Readable.from("child"), fileName: "child.txt", size: 5n, contentType: "text/plain" })

    const download = await request(app!.getHttpServer()).get("/share/shr_folder/download").expect(200)
    expect(download.text).toBe("root")
    expect(download.headers["content-disposition"]).toContain("root.txt")
    expect(drive.openShareBrowserItemDownload).toHaveBeenCalledWith({ shareId: "shr_folder", cookie: undefined, password: undefined })
    const childDownload = await request(app!.getHttpServer()).get("/share/shr_folder/items/file-1/download").expect(200)
    expect(childDownload.text).toBe("child")
    expect(childDownload.headers["content-disposition"]).toContain("child.txt")
    expect(drive.openShareBrowserItemDownload).toHaveBeenCalledWith({ shareId: "shr_folder", itemId: "file-1", cookie: undefined, password: undefined })
  })

  it("streams public child folder zip archives from download URLs", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      value: {
        type: "folder",
        item: createDriveItem({ id: "folder-1", name: "交接材料", type: "folder" }),
        ownerId: "user-1",
        storageKey: null,
      },
    })
    drive.openShareBrowserItemDownload.mockResolvedValue({
      kind: "zip",
      filename: "资料.zip",
      entries: [
        { path: "empty/", storageKey: null },
        { path: "brief.txt", storageKey: "drive/file-1" },
      ],
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const response = await request(app!.getHttpServer()).get("/share/shr_folder/items/folder-2/download").expect(200)

    expect(response.headers["content-type"]).toContain("application/zip")
    expect(response.headers["content-disposition"]).toBe(
      "attachment; filename=\"__.zip\"; filename*=UTF-8''%E8%B5%84%E6%96%99.zip",
    )
    expect(drive.openShareBrowserItemDownload).toHaveBeenCalledWith({
      shareId: "shr_folder",
      itemId: "folder-2",
      cookie: undefined,
      password: undefined,
    })
    expect(storage.getObjectStream).toHaveBeenCalledTimes(1)
    expect(storage.getObjectStream).toHaveBeenCalledWith({ key: "drive/file-1" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("streams owner folder zip archives with folder names", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DrivePublicController],
      providers: [
        { provide: DriveService, useValue: drive },
        { provide: "DriveStoragePort", useValue: storage },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: vi.fn((context) => {
        context.switchToHttp().getRequest().user = { id: "user-1" }
        return true
      }) })
      .compile()
    const userApp = moduleRef.createNestApplication()
    await userApp.init()
    try {
      drive.openOwnerBrowserItemDownload.mockResolvedValue({
        kind: "zip",
        filename: "项目资料.zip",
        entries: [
          { path: "empty/", storageKey: null },
          { path: "brief.txt", storageKey: "drive/file-1" },
        ],
      })

      const response = await request(userApp.getHttpServer()).get("/drive/items/folder-2/download").expect(200)

      expect(response.headers["content-type"]).toContain("application/zip")
      expect(response.headers["content-disposition"]).toBe(
        "attachment; filename=\"____.zip\"; filename*=UTF-8''%E9%A1%B9%E7%9B%AE%E8%B5%84%E6%96%99.zip",
      )
      expect(drive.openOwnerBrowserItemDownload).toHaveBeenCalledWith({
        userId: "user-1",
        itemId: "folder-2",
      })
      expect(storage.getObjectStream).toHaveBeenCalledTimes(1)
      expect(storage.getObjectStream).toHaveBeenCalledWith({ key: "drive/file-1" })
    } finally {
      await userApp.close()
    }
  })
})

describe("DrivePublicController public asset streaming", () => {
  it("requires revalidation for public asset cache hits", async () => {
    const publicAssets = {
      resolvePublicAsset: vi.fn(async () => ({
        status: "ok",
        assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
        publicAssetId: "public-asset-1",
        userId: "user-1",
        storageKey: "drive/item-1",
        name: "logo.png",
        mimeType: "image/png",
        size: 8n,
        etag: "\"etag-1\"",
      })),
      recordAccessSafely: vi.fn(async () => undefined),
    }
    const storage = {
      getObjectStream: vi.fn(async () => ({
        stream: Readable.from("content"),
        size: 7n,
        contentType: "image/png",
      })),
    }
    const controller = new DrivePublicController({} as DriveService, storage as never, publicAssets as never)
    const response = createPublicAssetResponse()

    await controller.sendPublicAsset(
      "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      { headers: {}, ip: "127.0.0.1", method: "GET" } as never,
      response as never,
    )

    expect(response.headers.get("Cache-Control")).toBe("no-cache, must-revalidate")
    expect(response.headers.get("ETag")).toBe("\"etag-1\"")
  })

  it("keeps public asset 304 responses revalidation-only", async () => {
    const publicAssets = {
      resolvePublicAsset: vi.fn(async () => ({
        status: "not_modified",
        publicAssetId: "public-asset-1",
        userId: "user-1",
        etag: "\"etag-1\"",
      })),
      recordAccessSafely: vi.fn(async () => undefined),
    }
    const controller = new DrivePublicController({} as DriveService, {} as never, publicAssets as never)
    const response = createPublicAssetResponse()

    await controller.sendPublicAsset(
      "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      { headers: { "if-none-match": "\"etag-1\"" }, ip: "127.0.0.1", method: "GET" } as never,
      response as never,
    )

    expect(response.headers.get("Cache-Control")).toBe("no-cache, must-revalidate")
    expect(response.headers.get("ETag")).toBe("\"etag-1\"")
    expect(response.status).toHaveBeenCalledWith(304)
  })

  it("records failed public asset access when streaming fails after headers are sent", async () => {
    const publicAssets = {
      resolvePublicAsset: vi.fn(async () => ({
        status: "ok",
        assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
        publicAssetId: "public-asset-1",
        userId: "user-1",
        storageKey: "drive/item-1",
        name: "logo.png",
        mimeType: "image/png",
        size: 8n,
        etag: "\"etag-1\"",
      })),
      recordAccessSafely: vi.fn(async () => undefined),
    }
    const storage = {
      getObjectStream: vi.fn(async () => ({
        stream: createPartiallyFailingReadable("object stream failed token=secret"),
        size: 8n,
        contentType: "image/png",
      })),
    }
    const controller = new DrivePublicController({} as DriveService, storage as never, publicAssets as never)
    const response = createHeadersSentResponse()

    await controller.sendPublicAsset(
      "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      {
        headers: {
          referer: "https://example.test/image?token=secret",
          "user-agent": "Image Browser",
        },
        ip: "127.0.0.1",
        method: "GET",
      } as never,
      response as never,
    )

    expect(publicAssets.recordAccessSafely).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      publicAssetId: "public-asset-1",
      userId: "user-1",
      method: "GET",
      statusCode: 500,
      bytes: 0n,
    }))
  })
})

describe("DrivePublicController link intake", () => {
  it("resolves a Drive link without requiring user auth", async () => {
    const links = {
      resolve: vi.fn(async () => ({
        ok: true,
        linkType: "share",
        access: { status: "ok", canRead: true, canList: false, canReadText: true, canDownload: true },
        root: { name: "需求说明.md", type: "file", previewKind: "markdown" },
        ref: { kind: "share", shareId: "shr_123", itemId: null, siteId: null, path: null, assetId: null },
      })),
    }
    const controller = new DrivePublicController({} as never, {} as never, undefined, undefined, undefined, undefined, undefined, links as never)

    await expect(controller.resolveDriveLink({ url: "https://synapse.test/share/shr_123" })).resolves.toMatchObject({
      linkType: "share",
      root: { name: "需求说明.md" },
    })
  })

  it("streams Drive link download content through the link-intake endpoint", async () => {
    const chunks: Buffer[] = []
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      },
    }) as Writable & {
      attachment: ReturnType<typeof vi.fn>
      setHeader: ReturnType<typeof vi.fn>
    }
    response.attachment = vi.fn(() => response)
    response.setHeader = vi.fn(() => response)
    const links = {
      openDownload: vi.fn(async () => ({
        stream: Readable.from("{\"ok\":true}"),
        fileName: "sample-data.json",
        size: 11n,
        contentType: "application/json",
      })),
    }
    const controller = new DrivePublicController({} as never, {} as never, undefined, undefined, undefined, undefined, undefined, links as never)

    await (controller as unknown as {
      downloadDriveLinkFile: (body: unknown, response: Writable) => Promise<void>
    }).downloadDriveLinkFile({ url: "https://synapse.test/share/shr_123", path: "sample-data.json" }, response)

    expect(Buffer.concat(chunks).toString("utf8")).toBe("{\"ok\":true}")
    expect(response.attachment).toHaveBeenCalledWith("sample-data.json")
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/json")
    expect(response.setHeader).toHaveBeenCalledWith("Content-Length", "11")
  })
})

function createBrowserSnapshot(): DriveBrowserSnapshotDto {
  return {
    context: "share",
    surface: "standalone",
    current: {
      id: "file-1",
      name: "brief.txt",
      type: "file",
      size: "11",
      mimeType: "text/plain",
      updatedAt: "2026-06-09T00:00:00.000Z",
      previewKind: "text",
      browserUrl: "/share/shr_file",
      downloadUrl: "/share/shr_file/download",
    },
    breadcrumbs: [{ id: "file-1", name: "brief.txt", browserUrl: "/share/shr_file" }],
    children: [],
    preview: {
      kind: "text",
      text: "brief",
      html: null,
      outline: null,
      truncated: false,
      imageUrl: null,
      visitUrl: null,
    },
    edit: null,
    annotation: null,
    canDownload: true,
    canZip: false,
  }
}

function createDriveItem(input: Partial<DriveItemDto> = {}): DriveItemDto {
  return {
    id: "file-1",
    parentId: null,
    type: "file",
    name: "brief.txt",
    size: "11",
    mimeType: "text/plain",
    storageStatus: "active",
    shared: false,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...input,
  }
}

function createAnnotationInput() {
  return {
    targetKind: "textRange",
    target: {
      schemaVersion: 1,
      kind: "textRange",
      surface: "markdownRenderedText",
      range: { start: 0, end: 4 },
      quote: { exact: "Note", prefix: "", suffix: "" },
    },
    body: "Comment body",
  }
}

function createAnnotationThread() {
  return {
    id: "thread-1",
    itemId: "item-1",
    baseVersionId: "version-1",
    targetKind: "textRange",
    target: createAnnotationInput().target,
    anchorStatus: "attached",
    author: { id: "user-1", email: "user@example.com", displayName: null },
    comments: [createAnnotationComment()],
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    permissions: { canDelete: true },
  }
}

function createAnnotationComment() {
  return {
    id: "comment-1",
    threadId: "thread-1",
    parentCommentId: null,
    body: "Comment body",
    author: { id: "user-1", email: "user@example.com", displayName: null },
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    deleted: false,
    permissions: { canEdit: true, canDelete: true },
  }
}

function driveAccessCookieName(kind: "share", publicId: string): string {
  return `synapse_drive_access_${kind}_${Buffer.from(publicId, "utf8").toString("base64url")}`
}

function expectDriveHtmlRenderCsp(value: string | undefined): void {
  expect(value).toContain("frame-ancestors 'self'")
  expect(value).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob: data:")
  expect(value).toContain("connect-src 'self' https:")
  expect(value).toContain("sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock")
  expect(value).toContain("object-src 'none'")
  expect(value).toContain("base-uri 'none'")
  expect(value).not.toContain("allow-same-origin")
  expect(value).not.toContain("allow-top-navigation")
  expect(value).not.toContain("script-src 'none'")
}

function createDownloadResponse() {
  const response = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  }) as Writable & {
    attachment: ReturnType<typeof vi.fn>
    setHeader: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
  }
  response.attachment = vi.fn(() => response)
  response.setHeader = vi.fn()
  response.status = vi.fn(() => response)
  response.send = vi.fn(() => response)
  return response
}

function createFailingReadable(message: string): Readable {
  return new Readable({
    read() {
      this.destroy(new Error(message))
    },
  })
}

function createPartiallyFailingReadable(message: string): Readable {
  let sent = false
  return new Readable({
    read() {
      if (sent) return
      sent = true
      this.push(Buffer.from("partial"))
      process.nextTick(() => {
        this.destroy(new Error(message))
      })
    },
  })
}

function createHeadersSentResponse() {
  let headersSent = false
  const response = new Writable({
    write(_chunk, _encoding, callback) {
      headersSent = true
      callback()
    },
  }) as Writable & {
    headersSent: boolean
    removeHeader: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    setHeader: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
  }
  Object.defineProperty(response, "headersSent", {
    get: () => headersSent,
  })
  response.setHeader = vi.fn()
  response.removeHeader = vi.fn()
  response.status = vi.fn(() => response)
  response.send = vi.fn(() => response)
  return response
}

function createPublicAssetResponse() {
  const headers = new Map<string, string>()
  const response = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  }) as Writable & {
    headers: Map<string, string>
    removeHeader: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    setHeader: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
  }
  response.headers = headers
  response.setHeader = vi.fn((name: string, value: string | number | bigint) => {
    headers.set(name, String(value))
    return response
  })
  response.removeHeader = vi.fn((name: string) => {
    headers.delete(name)
    return response
  })
  response.status = vi.fn(() => response)
  response.send = vi.fn(() => response)
  return response
}

function createDriveSite(overrides: Record<string, unknown> = {}) {
  return {
    id: "site-row-1",
    siteId: "site_public",
    name: "产品原型",
    status: "active",
    accessMode: "public",
    url: "https://app.example/sites/site_public/",
    urlWithPassword: "https://app.example/sites/site_public/",
    passwordEnabled: false,
    password: null,
    expiresAt: null,
    sourceFolderItemId: "folder-1",
    sourceFolderName: "产品原型",
    entryPath: "index.html",
    fileCount: 3,
    totalBytes: "128",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    lastPublishedAt: "2026-06-23T00:00:00.000Z",
    ...overrides,
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
