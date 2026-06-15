import { Buffer } from "node:buffer"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { BadRequestException, type INestApplication, NotFoundException, UnauthorizedException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { DriveBrowserSnapshotDto, DriveItemDto, DrivePublicationDto } from "@synapse/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { DriveAdminController, DriveLocalStorageController, DrivePublicController, DriveUserController } from "./drive.controller"
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
  readonly put: (path: string) => SupertestRequest
  readonly delete: (path: string) => SupertestRequest
}

describe("DriveController", () => {
  let app: INestApplication | null = null
  const originalPagesPublicUrl = process.env.PAGES_PUBLIC_URL
  const originalAppPublicUrl = process.env.APP_PUBLIC_URL
  const drive = {
    listItems: vi.fn(),
    prepareFolderUpload: vi.fn(),
    deleteItem: vi.fn(),
    getDeleteImpact: vi.fn(),
    listShares: vi.fn(),
    listPublications: vi.fn(),
    createShare: vi.fn(),
    publishPage: vi.fn(),
    publishSite: vi.fn(),
    redeployPublication: vi.fn(),
    disablePublication: vi.fn(),
    resolvePublishedAssetAccess: vi.fn(),
    resolvePublicShareAccess: vi.fn(),
    listPublicFolderChildren: vi.fn(),
    createDownloadUrlForShare: vi.fn(),
    createDownloadUrlForShareChild: vi.fn(),
    createFolderZipEntriesForShare: vi.fn(),
    getOwnerConsoleRootBrowserSnapshot: vi.fn(),
    getOwnerBrowserSnapshot: vi.fn(),
    getShareBrowserSnapshot: vi.fn(),
    createDownloadUrlForOwnerBrowserItem: vi.fn(),
    createFolderZipEntriesForOwnerBrowserItem: vi.fn(),
    resolveOwnerRenderAccess: vi.fn(),
    createDownloadUrlForShareBrowserItem: vi.fn(),
    openShareBrowserItemDownload: vi.fn(),
    createFolderZipEntriesForShareBrowserItem: vi.fn(),
    listAdminItems: vi.fn(),
  }
  const storage = {
    getObjectStream: vi.fn(async () => ({ stream: Readable.from("brief"), size: 5n, contentType: "text/plain" })),
  }

  beforeEach(async () => {
    drive.listItems.mockReset()
    drive.prepareFolderUpload.mockReset()
    drive.deleteItem.mockReset()
    drive.getDeleteImpact.mockReset()
    drive.listShares.mockReset()
    drive.listPublications.mockReset()
    drive.createShare.mockReset()
    drive.publishPage.mockReset()
    drive.publishSite.mockReset()
    drive.redeployPublication.mockReset()
    drive.disablePublication.mockReset()
    drive.resolvePublishedAssetAccess.mockReset()
    drive.resolvePublicShareAccess.mockReset()
    drive.listPublicFolderChildren.mockReset()
    drive.createDownloadUrlForShare.mockReset()
    drive.createDownloadUrlForShareChild.mockReset()
    drive.createFolderZipEntriesForShare.mockReset()
    drive.getOwnerConsoleRootBrowserSnapshot.mockReset()
    drive.getOwnerBrowserSnapshot.mockReset()
    drive.getShareBrowserSnapshot.mockReset()
    drive.createDownloadUrlForOwnerBrowserItem.mockReset()
    drive.createFolderZipEntriesForOwnerBrowserItem.mockReset()
    drive.resolveOwnerRenderAccess.mockReset()
    drive.createDownloadUrlForShareBrowserItem.mockReset()
    drive.openShareBrowserItemDownload.mockReset()
    drive.createFolderZipEntriesForShareBrowserItem.mockReset()
    drive.listAdminItems.mockReset()
    storage.getObjectStream.mockReset()
    storage.getObjectStream.mockResolvedValue({ stream: Readable.from("brief"), size: 5n, contentType: "text/plain" })
    restoreEnv("PAGES_PUBLIC_URL", originalPagesPublicUrl)
    restoreEnv("APP_PUBLIC_URL", originalAppPublicUrl)
    drive.resolvePublishedAssetAccess.mockRejectedValue(new NotFoundException("网页未找到"))
    drive.resolvePublicShareAccess.mockRejectedValue(new NotFoundException("文件未找到"))
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController, DrivePublicController],
      providers: [
        { provide: DriveService, useValue: drive },
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
    restoreEnv("PAGES_PUBLIC_URL", originalPagesPublicUrl)
    restoreEnv("APP_PUBLIC_URL", originalAppPublicUrl)
  })

  it("requires user auth for /api/drive/items", async () => {
    await request(app!.getHttpServer()).get("/api/drive/items").expect(401)
  })

  it("requires user auth for owner direct file responses", async () => {
    await request(app!.getHttpServer()).get("/drive/items/root-1/download").expect(401)
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
      await request(userApp.getHttpServer()).get("/api/drive/browser/owner/items/root-1/items/child-1").expect(200)

      expect(drive.getOwnerConsoleRootBrowserSnapshot).toHaveBeenCalledWith("user-1", { offset: 100, limit: 50 })
      expect(drive.getOwnerBrowserSnapshot).toHaveBeenCalledWith({
        userId: "user-1",
        rootItemId: "root-1",
        surface: "console",
        childrenPage: undefined,
      })
      expect(drive.getOwnerBrowserSnapshot).toHaveBeenCalledWith({
        userId: "user-1",
        rootItemId: "root-1",
        currentItemId: "child-1",
        surface: "standalone",
        childrenPage: undefined,
      })
    } finally {
      await userApp.close()
    }
  })

  it("records audit when admins list drive items", async () => {
    const auditLog = { record: vi.fn(async () => undefined) }
    const controller = new DriveAdminController(drive as unknown as DriveService, auditLog as never)
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
      drive.createDownloadUrlForOwnerBrowserItem.mockResolvedValue({ url: "https://cos.example/owner-download", fileName: "brief.txt" })
      drive.resolveOwnerRenderAccess
        .mockRejectedValueOnce(new BadRequestException("只能访问 HTML 或 Markdown 文件。"))
        .mockResolvedValueOnce({
          stream: Readable.from("<!doctype html><html><body>Notes</body></html>"),
          contentType: "text/html; charset=utf-8",
          csp: "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; frame-ancestors 'none';",
        })

      const download = await request(userApp.getHttpServer()).get("/drive/items/root-1/items/file-1/download").expect(302)
      expect(download.headers.location).toBe("https://cos.example/owner-download")
      expect(drive.createDownloadUrlForOwnerBrowserItem).toHaveBeenCalledWith({
        userId: "user-1",
        rootItemId: "root-1",
        currentItemId: "file-1",
      })

      await request(userApp.getHttpServer()).get("/drive/items/root-1/render").expect(400)

      const render = await request(userApp.getHttpServer())
        .get("/drive/items/root-1/items/file-1/render")
        .expect(200)
      expect(render.headers["content-type"]).toContain("text/html; charset=utf-8")
      expect(render.headers["content-security-policy"]).toContain("default-src 'none'")
      expect(render.text).toContain("Notes")
      expect(drive.resolveOwnerRenderAccess).toHaveBeenLastCalledWith({
        userId: "user-1",
        rootItemId: "root-1",
        currentItemId: "file-1",
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
      drive.prepareFolderUpload.mockResolvedValue({ root: { id: "folder-1" }, entries: [] })
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

  it("calls publication services through the user API", async () => {
    process.env.PAGES_PUBLIC_URL = "https://pages.example"
    const publication = createPublication()
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
      drive.listPublications.mockResolvedValue({
        items: [publication],
        page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
      })
      drive.publishPage.mockResolvedValue(publication)
      drive.publishSite.mockResolvedValue({ ...publication, type: "site" })
      drive.redeployPublication.mockResolvedValue(publication)
      drive.disablePublication.mockResolvedValue({ ok: true })

      await request(userApp.getHttpServer()).get("/api/drive/publications?offset=20&limit=10").expect(200)
      await request(userApp.getHttpServer()).post("/api/drive/items/file-1/publications/page").expect(201)
      await request(userApp.getHttpServer()).post("/api/drive/items/folder-1/publications/site").expect(201)
      await request(userApp.getHttpServer()).post("/api/drive/publications/pub-row-1/redeploy").expect(201)
      await request(userApp.getHttpServer()).delete("/api/drive/publications/pub-row-1").expect(200)

      expect(drive.listPublications).toHaveBeenCalledWith("user-1", "https://pages.example", { offset: 20, limit: 10 })
      expect(drive.publishPage).toHaveBeenCalledWith("user-1", "file-1", "https://pages.example", {
        passwordEnabled: true,
        expiresIn: "3d",
      }, expect.objectContaining({ ipAddress: expect.any(String) }))
      expect(drive.publishSite).toHaveBeenCalledWith("user-1", "folder-1", "https://pages.example", {
        passwordEnabled: true,
        expiresIn: "3d",
      }, expect.objectContaining({ ipAddress: expect.any(String) }))
      expect(drive.redeployPublication).toHaveBeenCalledWith("user-1", "pub-row-1", "https://pages.example", expect.objectContaining({ ipAddress: expect.any(String) }))
      expect(drive.disablePublication).toHaveBeenCalledWith("user-1", "pub-row-1", expect.objectContaining({ ipAddress: expect.any(String) }))
    } finally {
      await userApp.close()
    }
  })

  it("passes access settings through share and publish APIs", async () => {
    process.env.PAGES_PUBLIC_URL = "https://pages.example"
    process.env.APP_PUBLIC_URL = "https://app.example"
    const publication = createPublication()
    const share = {
      id: "share-row-1",
      shareId: "shr_public",
      itemId: "file-1",
      enabled: true,
      url: "https://app.example/files/shr_public",
      urlWithPassword: null,
      passwordEnabled: false,
      password: null,
      expiresAt: null,
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
      drive.publishPage.mockResolvedValue(publication)
      drive.publishSite.mockResolvedValue({ ...publication, type: "site" })

      await request(userApp.getHttpServer())
        .post("/api/drive/items/file-1/share")
        .send({ passwordEnabled: false, expiresIn: "3d" })
        .expect(201)
      await request(userApp.getHttpServer())
        .post("/api/drive/items/file-1/publications/page")
        .send({ passwordEnabled: true, expiresIn: "30d" })
        .expect(201)
      await request(userApp.getHttpServer())
        .post("/api/drive/items/folder-1/publications/site")
        .send({ expiresIn: "1y" })
        .expect(201)

      expect(drive.createShare).toHaveBeenCalledWith("user-1", "file-1", "https://app.example", {
        passwordEnabled: false,
        expiresIn: "3d",
      }, expect.objectContaining({ ipAddress: expect.any(String) }))
      expect(drive.publishPage).toHaveBeenCalledWith("user-1", "file-1", "https://pages.example", {
        passwordEnabled: true,
        expiresIn: "30d",
      }, expect.objectContaining({ ipAddress: expect.any(String) }))
      expect(drive.publishSite).toHaveBeenCalledWith("user-1", "folder-1", "https://pages.example", {
        passwordEnabled: true,
        expiresIn: "1y",
      }, expect.objectContaining({ ipAddress: expect.any(String) }))
    } finally {
      await userApp.close()
    }
  })

  it("passes disablePublications through delete requests", async () => {
    process.env.PAGES_PUBLIC_URL = "https://pages.example"
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
      drive.deleteItem.mockResolvedValue({ ok: true })

      await request(userApp.getHttpServer())
        .delete("/api/drive/items/file-1")
        .send({ disablePublications: true })
        .expect(200)

      expect(drive.deleteItem).toHaveBeenCalledWith("user-1", "file-1", "user-1", expect.any(String), {
        disablePublications: true,
        publicAppUrl: "https://pages.example",
      })
    } finally {
      await userApp.close()
    }
  })

  it("rejects unknown delete request fields", async () => {
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
      const response = await request(userApp.getHttpServer())
        .delete("/api/drive/items/file-1")
        .send({ disablePublications: true, extra: true })
        .expect(400)

      expect(response.text).toContain("删除请求无效")
      expect(drive.deleteItem).not.toHaveBeenCalled()
    } finally {
      await userApp.close()
    }
  })

  it("calls delete impact and share listing through the user API", async () => {
    process.env.PAGES_PUBLIC_URL = "https://pages.example"
    process.env.APP_PUBLIC_URL = "https://app.example"
    const publication = createPublication()
    const share = {
      id: "share-row-1",
      shareId: "shr_public",
      itemId: "file-1",
      itemName: "report.html",
      itemType: "file",
      sourceDeleted: false,
      url: "https://app.example/files/shr_public",
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
      drive.getDeleteImpact.mockResolvedValue({ publications: [publication] })
      drive.listShares.mockResolvedValue({
        items: [share],
        page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
      })

      await request(userApp.getHttpServer()).get("/api/drive/items/file-1/delete-impact").expect(200)
      await request(userApp.getHttpServer()).get("/api/drive/shares?offset=5&limit=10").expect(200)

      expect(drive.getDeleteImpact).toHaveBeenCalledWith("user-1", "file-1", "https://pages.example")
      expect(drive.listShares).toHaveBeenCalledWith("user-1", "https://app.example", { offset: 5, limit: 10 })
    } finally {
      await userApp.close()
    }
  })

  it("falls back to APP_PUBLIC_URL when PAGES_PUBLIC_URL is blank", async () => {
    process.env.PAGES_PUBLIC_URL = "   "
    process.env.APP_PUBLIC_URL = "https://app.example"
    const publication = createPublication({ url: "https://app.example/pages/pub_public" })
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
      drive.publishPage.mockResolvedValue(publication)

      await request(userApp.getHttpServer()).post("/api/drive/items/file-1/publications/page").expect(201)

      expect(drive.publishPage).toHaveBeenCalledWith("user-1", "file-1", "https://app.example", {
        passwordEnabled: true,
        expiresIn: "3d",
      }, expect.objectContaining({ ipAddress: expect.any(String) }))
    } finally {
      await userApp.close()
    }
  })

  it("rejects share URL generation when APP_PUBLIC_URL is missing", async () => {
    process.env.PAGES_PUBLIC_URL = ""
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

  it("serves a published page through the server proxy", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({
      status: "ok",
      value: {
        stream: Readable.from(["<h1>Hello</h1>"]),
        contentType: "text/html; charset=utf-8",
        size: 14n,
      },
    })

    const response = await request(app!.getHttpServer()).get("/pages/pub_page").expect(200)
    expect(response.text).toBe("<h1>Hello</h1>")
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.headers["content-length"]).toBe("14")
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
    expect(response.headers["referrer-policy"]).toBe("no-referrer")
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'")
    expect(drive.resolvePublishedAssetAccess).toHaveBeenCalledWith({
      publishId: "pub_page",
      type: "page",
      relativePath: "index.html",
      password: undefined,
      cookie: undefined,
    })
  })

  it("serves site assets through the server proxy", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({
      status: "ok",
      value: {
        stream: Readable.from(["window.ok = true"]),
        contentType: "application/javascript; charset=utf-8",
        size: 16n,
      },
    })

    const response = await request(app!.getHttpServer()).get("/sites/pub_site/app.js").expect(200)
    expect(response.text).toBe("window.ok = true")
    expect(response.headers["content-type"]).toContain("javascript")
    expect(drive.resolvePublishedAssetAccess).toHaveBeenCalledWith({
      publishId: "pub_site",
      type: "site",
      relativePath: "app.js",
      password: undefined,
      cookie: undefined,
    })
  })

  it("redirects site roots and serves the site index for empty asset paths", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({
      status: "ok",
      value: {
        stream: Readable.from(["<main>Site</main>"]),
        contentType: "text/html; charset=utf-8",
        size: 17n,
      },
    })

    const redirect = await request(app!.getHttpServer()).get("/sites/pub_site").expect(302)
    expect(redirect.headers.location).toBe("/sites/pub_site/")

    const index = await request(app!.getHttpServer()).get("/sites/pub_site/").expect(200)
    expect(index.text).toBe("<main>Site</main>")
    expect(drive.resolvePublishedAssetAccess).toHaveBeenCalledWith({
      publishId: "pub_site",
      type: "site",
      relativePath: "index.html",
      password: undefined,
      cookie: undefined,
    })
  })

  it("returns the same public not found text for missing publications", async () => {
    const response = await request(app!.getHttpServer()).get("/pages/pub_missing").expect(404)
    expect(response.text).toContain("drive-public-status-shell")
    expect(response.text).toContain("网页未找到")
    expect(response.text).not.toContain("pub_missing")
    expect(response.text).not.toContain("publication")
    expect(response.headers["content-type"]).toContain("text/html")
  })

  it("returns public not found when published page password unlock cannot resolve access", async () => {
    drive.resolvePublishedAssetAccess.mockRejectedValue(new NotFoundException("网页未找到"))

    const response = await request(app!.getHttpServer())
      .post("/pages/pub_missing")
      .send({ password: "letmein" })
      .expect(404)

    expect(response.text).toContain("drive-public-status-shell")
    expect(response.text).toContain("网页未找到")
    expect(response.text).not.toContain("pub_missing")
    expect(response.text).not.toContain("letmein")
    expect(response.headers["content-type"]).toContain("text/html")
    expect(drive.resolvePublishedAssetAccess).toHaveBeenCalledWith({
      publishId: "pub_missing",
      type: "page",
      relativePath: "index.html",
      password: "letmein",
      cookie: undefined,
    })
  })

  it("returns public not found when published site password unlock hits an invalid path", async () => {
    drive.resolvePublishedAssetAccess.mockRejectedValue(new Error("Invalid publication path"))

    const response = await request(app!.getHttpServer())
      .post("/sites/pub_site/private")
      .send({ password: "letmein" })
      .expect(404)

    expect(response.text).toContain("drive-public-status-shell")
    expect(response.text).toContain("网页未找到")
    expect(response.text).not.toContain("pub_site")
    expect(response.text).not.toContain("private")
    expect(response.headers["content-type"]).toContain("text/html")
    expect(drive.resolvePublishedAssetAccess).toHaveBeenCalledWith({
      publishId: "pub_site",
      type: "site",
      relativePath: "private",
      password: "letmein",
      cookie: undefined,
    })
  })

  it("returns public not found when a published asset stream fails before sending headers", async () => {
    const error = new Error("stream failed")
    drive.resolvePublishedAssetAccess.mockResolvedValue({
      status: "ok",
      value: {
        stream: new Readable({
          read() {
            this.destroy(error)
          },
        }),
        contentType: "text/html; charset=utf-8",
        size: undefined,
      },
    })

    const response = await request(app!.getHttpServer()).get("/pages/pub_broken").expect(404)

    expect(response.text).toContain("drive-public-status-shell")
    expect(response.text).toContain("网页未找到")
    expect(response.text).not.toContain("stream failed")
    expect(drive.resolvePublishedAssetAccess).toHaveBeenCalledWith({
      publishId: "pub_broken",
      type: "page",
      relativePath: "index.html",
      password: undefined,
      cookie: undefined,
    })
  })

  it("renders password page for protected published html routes", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({ status: "password_required" })

    const page = await request(app!.getHttpServer()).get("/pages/pub_locked").expect(200)
    expect(page.text).toContain("drive-password-shell")
    expect(page.text).toContain("访问密码")
    expect(page.text).toContain('name="password"')
    expect(page.text).toContain('action="/pages/pub_locked"')
    expect(page.text).toContain(">打开</button>")

    const site = await request(app!.getHttpServer()).get("/sites/pub_locked/").expect(200)
    expect(site.text).toContain("drive-password-shell")
    expect(site.text).toContain("访问密码")
    expect(site.text).toContain('name="password"')
    expect(site.text).toContain('action="/sites/pub_locked/"')
    expect(site.text).toContain(">打开</button>")
  })

  it("renders password errors when posted published passwords are wrong", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({ status: "password_required" })

    const response = await request(app!.getHttpServer())
      .post("/pages/pub_locked")
      .send({ password: "wrong" })
      .expect(200)

    expect(response.text).toContain("密码错误")
    expect(response.text).toContain('aria-invalid="true"')
    expect(response.text).toContain('aria-describedby="drive-password-error"')
    expect(response.text).toContain('id="drive-password-error"')
    expect(response.text).toContain('action="/pages/pub_locked"')
  })

  it("reads published access cookies from resource scoped slots", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({ status: "password_required" })
    const cookieHeader = [
      `${driveAccessCookieName("page", "pub_page")}=page-cookie`,
      `${driveAccessCookieName("site", "pub_site")}=site-cookie`,
    ].join("; ")

    await request(app!.getHttpServer()).get("/pages/pub_page").set("Cookie", cookieHeader).expect(200)
    await request(app!.getHttpServer()).get("/sites/pub_site/").set("Cookie", cookieHeader).expect(200)

    expect(drive.resolvePublishedAssetAccess).toHaveBeenNthCalledWith(1, {
      publishId: "pub_page",
      type: "page",
      relativePath: "index.html",
      password: undefined,
      cookie: "page-cookie",
    })
    expect(drive.resolvePublishedAssetAccess).toHaveBeenNthCalledWith(2, {
      publishId: "pub_site",
      type: "site",
      relativePath: "index.html",
      password: undefined,
      cookie: "site-cookie",
    })
  })

  it("unlocks published password query and redirects to clean html urls", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({
      status: "ok",
      cookie: "cookie-value",
      value: {
        stream: Readable.from(["<h1>unlocked</h1>"]),
        contentType: "text/html; charset=utf-8",
        size: 17n,
      },
    })

    const page = await request(app!.getHttpServer()).get("/pages/pub_locked?password=AbC234xy").expect(302)
    const pageCookie = page.headers["set-cookie"]
    expect(page.headers.location).toBe("/pages/pub_locked")
    expect(Array.isArray(pageCookie) ? pageCookie.join(";") : pageCookie).toContain(`${driveAccessCookieName("page", "pub_locked")}=cookie-value`)
    expect(Array.isArray(pageCookie) ? pageCookie.join(";") : pageCookie).toContain("HttpOnly")

    const site = await request(app!.getHttpServer()).get("/sites/pub_locked/?password=AbC234xy").expect(302)
    const siteCookie = site.headers["set-cookie"]
    expect(site.headers.location).toBe("/sites/pub_locked/")
    expect(Array.isArray(siteCookie) ? siteCookie.join(";") : siteCookie).toContain(`${driveAccessCookieName("site", "pub_locked")}=cookie-value`)
    expect(Array.isArray(siteCookie) ? siteCookie.join(";") : siteCookie).toContain("HttpOnly")
  })

  it("unlocks site root password query before adding the trailing slash", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({
      status: "ok",
      cookie: "cookie-value",
      value: {
        stream: Readable.from(["<h1>unlocked</h1>"]),
        contentType: "text/html; charset=utf-8",
        size: 17n,
      },
    })

    const response = await request(app!.getHttpServer()).get("/sites/pub_locked?password=AbC234xy").expect(302)
    const cookie = response.headers["set-cookie"]

    expect(response.headers.location).toBe("/sites/pub_locked/")
    expect(Array.isArray(cookie) ? cookie.join(";") : cookie).toContain(`${driveAccessCookieName("site", "pub_locked")}=cookie-value`)
    expect(drive.resolvePublishedAssetAccess).toHaveBeenCalledWith({
      publishId: "pub_locked",
      type: "site",
      relativePath: "index.html",
      password: "AbC234xy",
      cookie: undefined,
    })
  })

  it("cleans stale password query for published pages even without a new cookie", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({
      status: "ok",
      value: {
        stream: Readable.from(["<h1>public</h1>"]),
        contentType: "text/html; charset=utf-8",
        size: 15n,
      },
    })

    const response = await request(app!.getHttpServer()).get("/pages/pub_page?password=stale").expect(302)

    expect(response.headers.location).toBe("/pages/pub_page")
    expect(drive.resolvePublishedAssetAccess).toHaveBeenCalledWith({
      publishId: "pub_page",
      type: "page",
      relativePath: "index.html",
      password: "stale",
      cookie: undefined,
    })
  })

  it("returns typed password-required responses for protected share browser APIs", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({ status: "password_required" })

    const response = await request(app!.getHttpServer()).get("/api/drive/browser/shares/shr_locked").expect(200)

    expect(response.body).toEqual({ passwordRequired: true, message: "请输入密码。" })
    expect(drive.listPublicFolderChildren).not.toHaveBeenCalled()
    expect(drive.createDownloadUrlForShare).not.toHaveBeenCalled()
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
      password: "letmein",
      cookie: "access-cookie",
      childrenPage: { offset: 20, limit: 10 },
    })
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
      itemId: "file-1",
      password: "letmein",
      cookie: "access-cookie",
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

  it("does not serve protected site static assets before unlock", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({ status: "static_denied" })

    const response = await request(app!.getHttpServer()).get("/sites/pub_site/app.js").expect(403)

    expect(response.text).toBe("访问受限")
  })

  it("leaves share browser page routes to the SPA", async () => {
    await request(app!.getHttpServer()).get("/files/shr_file").expect(404)
    expect(drive.resolvePublicShareAccess).not.toHaveBeenCalled()
    expect(drive.createDownloadUrlForShare).not.toHaveBeenCalled()
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
      .post("/files/shr_file")
      .send({ password: "letmein" })
      .expect(302)
    const setCookie = response.headers["set-cookie"]

    expect(response.headers.location).toBe("/files/shr_file")
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
      .post("/files/shr_file/download")
      .send({ password: "letmein" })
      .expect(302)
    const setCookie = response.headers["set-cookie"]

    expect(response.headers.location).toBe("/files/shr_file/download")
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain(`${driveAccessCookieName("share", "shr_file")}=posted-cookie`)
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: "letmein",
      cookie: undefined,
    })
  })

  it("posts share passwords for child folder zip downloads and redirects back", async () => {
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
      .post("/files/shr_folder/items/folder-2/zip")
      .send({ password: "letmein" })
      .expect(302)
    const setCookie = response.headers["set-cookie"]

    expect(response.headers.location).toBe("/files/shr_folder/items/folder-2/zip")
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

    const response = await request(app!.getHttpServer()).get("/files/shr_file/download?password=stale").expect(302)

    expect(response.headers.location).toBe("/files/shr_file/download")
    expect(drive.createDownloadUrlForShareBrowserItem).not.toHaveBeenCalled()
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: "stale",
      cookie: undefined,
    })
  })

  it("renders password errors when posted share passwords are wrong", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({ status: "password_required" })

    const response = await request(app!.getHttpServer())
      .post("/files/shr_file")
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
      .post("/files/shr_file/download")
      .send({ password: "wrong" })
      .expect(200)

    expect(response.text).toContain("密码错误")
    expect(response.text).toContain("drive-password-shell")
    expect(response.text).toContain('action="/files/shr_file/download"')
    expect(response.text).toContain('aria-invalid="true"')
    expect(response.text).toContain('aria-describedby="drive-password-error"')
  })

  it("streams canonical and legacy public file downloads", async () => {
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
      .mockResolvedValueOnce({ stream: Readable.from("legacy"), fileName: "legacy.txt", size: 6n, contentType: "text/plain" })

    const download = await request(app!.getHttpServer()).get("/files/shr_folder/download").expect(200)
    expect(download.text).toBe("root")
    expect(download.headers["content-disposition"]).toContain("root.txt")
    expect(drive.openShareBrowserItemDownload).toHaveBeenCalledWith({ shareId: "shr_folder", cookie: undefined, password: undefined })
    const childDownload = await request(app!.getHttpServer()).get("/files/shr_folder/items/file-1/download").expect(200)
    expect(childDownload.text).toBe("child")
    expect(childDownload.headers["content-disposition"]).toContain("child.txt")
    expect(drive.openShareBrowserItemDownload).toHaveBeenCalledWith({ shareId: "shr_folder", itemId: "file-1", cookie: undefined, password: undefined })
    const legacyChildDownload = await request(app!.getHttpServer()).get("/files/shr_folder/file-1/download").expect(200)
    expect(legacyChildDownload.text).toBe("legacy")
    expect(legacyChildDownload.headers["content-disposition"]).toContain("legacy.txt")
    expect(drive.openShareBrowserItemDownload).toHaveBeenCalledWith({ shareId: "shr_folder", itemId: "file-1", cookie: undefined, password: undefined })
    expect(drive.createDownloadUrlForShareBrowserItem).not.toHaveBeenCalled()
  })

  it("streams public child folder zip archives", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      value: {
        type: "folder",
        item: createDriveItem({ id: "folder-1", name: "交接材料", type: "folder" }),
        ownerId: "user-1",
        storageKey: null,
      },
    })
    drive.createFolderZipEntriesForShareBrowserItem.mockResolvedValue({
      filename: "资料.zip",
      entries: [{ path: "brief.txt", storageKey: "drive/file-1" }],
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const response = await request(app!.getHttpServer()).get("/files/shr_folder/items/folder-2/zip").expect(200)

    expect(response.headers["content-type"]).toContain("application/zip")
    expect(response.headers["content-disposition"]).toBe(
      "attachment; filename=\"__.zip\"; filename*=UTF-8''%E8%B5%84%E6%96%99.zip",
    )
    expect(drive.createFolderZipEntriesForShareBrowserItem).toHaveBeenCalledWith({
      shareId: "shr_folder",
      itemId: "folder-2",
      cookie: undefined,
      password: undefined,
    })
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
      drive.createFolderZipEntriesForOwnerBrowserItem.mockResolvedValue({
        filename: "项目资料.zip",
        entries: [{ path: "brief.txt", storageKey: "drive/file-1" }],
      })

      const response = await request(userApp.getHttpServer()).get("/drive/items/root-1/items/folder-2/zip").expect(200)

      expect(response.headers["content-type"]).toContain("application/zip")
      expect(response.headers["content-disposition"]).toBe(
        "attachment; filename=\"____.zip\"; filename*=UTF-8''%E9%A1%B9%E7%9B%AE%E8%B5%84%E6%96%99.zip",
      )
      expect(drive.createFolderZipEntriesForOwnerBrowserItem).toHaveBeenCalledWith({
        userId: "user-1",
        rootItemId: "root-1",
        currentItemId: "folder-2",
      })
    } finally {
      await userApp.close()
    }
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
      browserUrl: "/files/shr_file",
      downloadUrl: "/files/shr_file/download",
    },
    breadcrumbs: [{ id: "file-1", name: "brief.txt", browserUrl: "/files/shr_file" }],
    children: [],
    preview: {
      kind: "text",
      text: "brief",
      html: null,
      truncated: false,
      imageUrl: null,
      visitUrl: null,
    },
    canDownload: true,
    canZip: false,
  }
}

function createPublication(input: Partial<DrivePublicationDto> = {}): DrivePublicationDto {
  return {
    id: "pub-row-1",
    publishId: "pub_public",
    type: "page",
    name: "report.html",
    status: "active",
    sourceItemId: "file-1",
    sourceDeleted: false,
    url: "https://pages.example/pages/pub_public",
    urlWithPassword: "https://pages.example/pages/pub_public?password=ABCDEFGH",
    passwordEnabled: true,
    password: "ABCDEFGH",
    expiresAt: "2026-06-16T00:00:00.000Z",
    currentDeploymentId: "dep-1",
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...input,
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

function driveAccessCookieName(kind: "share" | "page" | "site", publicId: string): string {
  return `synapse_drive_access_${kind}_${Buffer.from(publicId, "utf8").toString("base64url")}`
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
