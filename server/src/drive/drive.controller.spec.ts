import { Buffer } from "node:buffer"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable, Writable } from "node:stream"
import { BadRequestException, type INestApplication, NotFoundException, UnauthorizedException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { DriveBrowserSnapshotDto, DriveItemDto } from "@synapse/shared"
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
  readonly patch: (path: string) => SupertestRequest
  readonly put: (path: string) => SupertestRequest
  readonly delete: (path: string) => SupertestRequest
}

describe("DriveController", () => {
  let app: INestApplication | null = null
  const originalAppPublicUrl = process.env.APP_PUBLIC_URL
  const drive = {
    listItems: vi.fn(),
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
  const storage = {
    getObjectStream: vi.fn(async () => ({ stream: Readable.from("brief"), size: 5n, contentType: "text/plain" })),
  }

  beforeEach(async () => {
    drive.listItems.mockReset()
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
    storage.getObjectStream.mockReset()
    storage.getObjectStream.mockResolvedValue({ stream: Readable.from("brief"), size: 5n, contentType: "text/plain" })
    restoreEnv("APP_PUBLIC_URL", originalAppPublicUrl)
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
    publicAssets.listAdminAssets.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
    publicAssets.getAdminAsset.mockResolvedValue({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ" })
    publicAssets.listAdminAccessLogs.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
    publicAssets.listAdminRevisions.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
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
    expect(response.attachment).toHaveBeenCalledWith("logo-old.png")
    expect(response.attachment).toHaveBeenCalledWith("brief.txt")
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
      expect(render.headers["content-security-policy"]).toContain("frame-ancestors 'self'")
      expect(render.headers["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https:")
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
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'self'")
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.headers["content-security-policy"]).toContain("script-src 'none'")
    expect(response.headers["content-security-policy"]).toContain("connect-src 'none'")
    expect(response.headers["content-security-policy"]).toContain("sandbox")
    expect(response.headers["content-security-policy"]).not.toContain("'unsafe-inline' https:")
    expect(response.headers["content-security-policy"]).not.toContain("'unsafe-eval'")
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
      entries: [{ path: "brief.txt", storageKey: "drive/file-1" }],
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
        entries: [{ path: "brief.txt", storageKey: "drive/file-1" }],
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

function driveAccessCookieName(kind: "share", publicId: string): string {
  return `synapse_drive_access_${kind}_${Buffer.from(publicId, "utf8").toString("base64url")}`
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
