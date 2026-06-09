import { Readable } from "node:stream"
import { type INestApplication, NotFoundException, UnauthorizedException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { DrivePublicationDto } from "@synapse/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { DrivePublicController, DriveUserController } from "./drive.controller"
import { DriveService } from "./drive.service"

type SupertestResponse = { readonly body: unknown; readonly text: string; readonly headers: Record<string, string> }
type SupertestRequest = {
  readonly send: (body: unknown) => SupertestRequest
  readonly expect: (status: number) => Promise<SupertestResponse>
}
const request = require("supertest") as (server: unknown) => {
  readonly get: (path: string) => SupertestRequest
  readonly post: (path: string) => SupertestRequest
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
    restoreEnv("PAGES_PUBLIC_URL", originalPagesPublicUrl)
    restoreEnv("APP_PUBLIC_URL", originalAppPublicUrl)
    drive.resolvePublishedAssetAccess.mockRejectedValue(new NotFoundException("网页未找到"))
    drive.resolvePublicShareAccess.mockRejectedValue(new NotFoundException("文件未找到"))
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController, DrivePublicController],
      providers: [{ provide: DriveService, useValue: drive }],
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
    restoreEnv("PAGES_PUBLIC_URL", originalPagesPublicUrl)
    restoreEnv("APP_PUBLIC_URL", originalAppPublicUrl)
  })

  it("requires user auth for /api/drive/items", async () => {
    await request(app!.getHttpServer()).get("/api/drive/items").expect(401)
  })

  it("returns public not found for missing share ids", async () => {
    const response = await request(app!.getHttpServer()).get("/files/shr_missing").expect(404)
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
      drive.prepareFolderUpload.mockResolvedValue({ root: { id: "folder-1" }, entries: [] })
      await request(userApp.getHttpServer())
        .post("/api/drive/uploads/folder/prepare")
        .send({ parentId: null, folderName: "交接材料", files: [{ relativePath: "brief.txt", size: "11", mimeType: "text/plain" }] })
        .expect(201)
      expect(drive.prepareFolderUpload).toHaveBeenCalledWith("user-1", expect.objectContaining({
        parentId: null,
        folderName: "交接材料",
      }))
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
      drive.listPublications.mockResolvedValue([publication])
      drive.publishPage.mockResolvedValue(publication)
      drive.publishSite.mockResolvedValue({ ...publication, type: "site" })
      drive.redeployPublication.mockResolvedValue(publication)
      drive.disablePublication.mockResolvedValue({ ok: true })

      await request(userApp.getHttpServer()).get("/api/drive/publications").expect(200)
      await request(userApp.getHttpServer()).post("/api/drive/items/file-1/publications/page").expect(201)
      await request(userApp.getHttpServer()).post("/api/drive/items/folder-1/publications/site").expect(201)
      await request(userApp.getHttpServer()).post("/api/drive/publications/pub-row-1/redeploy").expect(201)
      await request(userApp.getHttpServer()).delete("/api/drive/publications/pub-row-1").expect(200)

      expect(drive.listPublications).toHaveBeenCalledWith("user-1", "https://pages.example")
      expect(drive.publishPage).toHaveBeenCalledWith("user-1", "file-1", "https://pages.example", {
        passwordEnabled: true,
        expiresIn: "7d",
      })
      expect(drive.publishSite).toHaveBeenCalledWith("user-1", "folder-1", "https://pages.example", {
        passwordEnabled: true,
        expiresIn: "7d",
      })
      expect(drive.redeployPublication).toHaveBeenCalledWith("user-1", "pub-row-1", "https://pages.example")
      expect(drive.disablePublication).toHaveBeenCalledWith("user-1", "pub-row-1")
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
        .send({ passwordEnabled: false, expiresIn: "forever" })
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
        expiresIn: "forever",
      })
      expect(drive.publishPage).toHaveBeenCalledWith("user-1", "file-1", "https://pages.example", {
        passwordEnabled: true,
        expiresIn: "30d",
      })
      expect(drive.publishSite).toHaveBeenCalledWith("user-1", "folder-1", "https://pages.example", {
        passwordEnabled: true,
        expiresIn: "1y",
      })
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
      drive.listShares.mockResolvedValue([share])

      await request(userApp.getHttpServer()).get("/api/drive/items/file-1/delete-impact").expect(200)
      await request(userApp.getHttpServer()).get("/api/drive/shares").expect(200)

      expect(drive.getDeleteImpact).toHaveBeenCalledWith("user-1", "file-1", "https://pages.example")
      expect(drive.listShares).toHaveBeenCalledWith("user-1", "https://app.example")
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
        expiresIn: "7d",
      })
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
    expect(response.text).toBe("网页未找到")
    expect(response.headers["content-type"]).toContain("text/plain")
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

    expect(response.text).toBe("网页未找到")
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
    expect(page.text).toContain("密码")

    const site = await request(app!.getHttpServer()).get("/sites/pub_locked/").expect(200)
    expect(site.text).toContain("drive-password-shell")
    expect(site.text).toContain("密码")
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
    expect(Array.isArray(pageCookie) ? pageCookie.join(";") : pageCookie).toContain("synapse_drive_access=cookie-value")
    expect(Array.isArray(pageCookie) ? pageCookie.join(";") : pageCookie).toContain("HttpOnly")

    const site = await request(app!.getHttpServer()).get("/sites/pub_locked/?password=AbC234xy").expect(302)
    const siteCookie = site.headers["set-cookie"]
    expect(site.headers.location).toBe("/sites/pub_locked/")
    expect(Array.isArray(siteCookie) ? siteCookie.join(";") : siteCookie).toContain("synapse_drive_access=cookie-value")
    expect(Array.isArray(siteCookie) ? siteCookie.join(";") : siteCookie).toContain("HttpOnly")
  })

  it("renders password page without resource details for protected shares", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({ status: "password_required" })

    const response = await request(app!.getHttpServer()).get("/files/shr_locked").expect(200)

    expect(response.text).toContain("drive-password-shell")
    expect(response.text).toContain("name=\"password\"")
    expect(response.text).not.toContain("secret.txt")
    expect(response.text).not.toContain("交接材料")
    expect(drive.listPublicFolderChildren).not.toHaveBeenCalled()
    expect(drive.createDownloadUrlForShare).not.toHaveBeenCalled()
  })

  it("unlocks password query and redirects to a clean share URL", async () => {
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

    const response = await request(app!.getHttpServer()).get("/files/shr_file?password=letmein&x=1").expect(302)
    const setCookie = response.headers["set-cookie"]

    expect(response.headers.location).toBe("/files/shr_file?x=1")
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain("synapse_drive_access=access-cookie")
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain("HttpOnly")
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: "letmein",
      cookie: undefined,
    })
  })

  it("does not serve protected site static assets before unlock", async () => {
    drive.resolvePublishedAssetAccess.mockResolvedValue({ status: "static_denied" })

    const response = await request(app!.getHttpServer()).get("/sites/pub_site/app.js").expect(403)

    expect(response.text).toBe("访问受限")
  })

  it("renders a file share landing page instead of redirecting to storage", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      value: {
        type: "file",
        item: createDriveItem({ id: "file-1", name: "brief.txt", size: "11" }),
        ownerId: "user-1",
        storageKey: "drive/file-1",
      },
    })

    const response = await request(app!.getHttpServer()).get("/files/shr_file").expect(200)

    expect(response.text).toContain("drive-share-shell")
    expect(response.text).toContain("brief.txt")
    expect(response.text).toContain("./shr_file/download")
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
    expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain("synapse_drive_access=posted-cookie")
    expect(drive.resolvePublicShareAccess).toHaveBeenCalledWith({
      shareId: "shr_file",
      password: "letmein",
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
  })

  it("renders public folder children and redirects public file downloads", async () => {
    drive.resolvePublicShareAccess.mockResolvedValue({
      status: "ok",
      value: {
        type: "folder",
        item: createDriveItem({ id: "folder-1", name: "交接材料", type: "folder" }),
        ownerId: "user-1",
        storageKey: null,
      },
    })
    drive.listPublicFolderChildren.mockResolvedValue({
      item: createDriveItem({ id: "folder-1", name: "交接材料", type: "folder" }),
      children: [{
        id: "file-1",
        type: "file",
        name: "brief.txt",
        size: "11",
        updatedAt: "2026-06-07T08:15:00.000Z",
      }],
    })
    drive.createDownloadUrlForShare.mockResolvedValue({ url: "https://cos.example/download" })
    drive.createDownloadUrlForShareChild.mockResolvedValue({ url: "https://cos.example/child-download" })

    const folder = await request(app!.getHttpServer()).get("/files/shr_folder").expect(200)
    expect(folder.text).toContain("drive-share-shell")
    expect(folder.text).toContain("全部文件")
    expect(folder.text).toContain("交接材料")
    expect(folder.text).toContain("drive-share-list")
    expect(folder.text).not.toContain("搜索云盘内文件")
    expect(folder.text).not.toContain("公开分享")
    expect(folder.text).not.toContain("下载全部")
    expect(folder.text).not.toContain("drive-share-grid")
    expect(folder.text).toContain("brief.txt")
    expect(folder.text).toContain("2026/06/07 16:15")
    expect(folder.text).toContain("./shr_folder/file-1/download")
    expect(drive.listPublicFolderChildren).toHaveBeenCalledWith({ shareId: "shr_folder", cookie: undefined, password: undefined })
    const download = await request(app!.getHttpServer()).get("/files/shr_folder/download").expect(302)
    expect(download.headers.location).toBe("https://cos.example/download")
    expect(drive.createDownloadUrlForShare).toHaveBeenCalledWith({ shareId: "shr_folder", cookie: undefined, password: undefined })
    const childDownload = await request(app!.getHttpServer()).get("/files/shr_folder/file-1/download").expect(302)
    expect(childDownload.headers.location).toBe("https://cos.example/child-download")
    expect(drive.createDownloadUrlForShareChild).toHaveBeenCalledWith({ shareId: "shr_folder", itemId: "file-1", cookie: undefined, password: undefined })
  })
})

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
    uploadStatus: "completed",
    shared: false,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...input,
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
