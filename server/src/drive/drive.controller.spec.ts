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
    publishPage: vi.fn(),
    publishSite: vi.fn(),
    redeployPublication: vi.fn(),
    disablePublication: vi.fn(),
    resolvePublishedAsset: vi.fn(),
    resolvePublicShare: vi.fn(),
    listPublicFolderChildren: vi.fn(),
    createDownloadUrlForShare: vi.fn(),
    createDownloadUrlForShareChild: vi.fn(),
  }

  beforeEach(async () => {
    drive.listItems.mockReset()
    drive.prepareFolderUpload.mockReset()
    drive.deleteItem.mockReset()
    drive.getDeleteImpact.mockReset()
    drive.listShares.mockReset()
    drive.listPublications.mockReset()
    drive.publishPage.mockReset()
    drive.publishSite.mockReset()
    drive.redeployPublication.mockReset()
    drive.disablePublication.mockReset()
    drive.resolvePublishedAsset.mockReset()
    drive.resolvePublicShare.mockReset()
    drive.listPublicFolderChildren.mockReset()
    drive.createDownloadUrlForShare.mockReset()
    drive.createDownloadUrlForShareChild.mockReset()
    restoreEnv("PAGES_PUBLIC_URL", originalPagesPublicUrl)
    restoreEnv("APP_PUBLIC_URL", originalAppPublicUrl)
    drive.resolvePublishedAsset.mockRejectedValue(new NotFoundException("网页未找到"))
    drive.resolvePublicShare.mockRejectedValue(new NotFoundException("文件未找到"))
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
      expect(drive.publishPage).toHaveBeenCalledWith("user-1", "file-1", "https://pages.example")
      expect(drive.publishSite).toHaveBeenCalledWith("user-1", "folder-1", "https://pages.example")
      expect(drive.redeployPublication).toHaveBeenCalledWith("user-1", "pub-row-1", "https://pages.example")
      expect(drive.disablePublication).toHaveBeenCalledWith("user-1", "pub-row-1")
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

      expect(drive.publishPage).toHaveBeenCalledWith("user-1", "file-1", "https://app.example")
    } finally {
      await userApp.close()
    }
  })

  it("serves a published page through the server proxy", async () => {
    drive.resolvePublishedAsset.mockResolvedValue({
      stream: Readable.from(["<h1>Hello</h1>"]),
      contentType: "text/html; charset=utf-8",
      size: 14n,
    })

    const response = await request(app!.getHttpServer()).get("/pages/pub_page").expect(200)
    expect(response.text).toBe("<h1>Hello</h1>")
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.headers["content-length"]).toBe("14")
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
    expect(response.headers["referrer-policy"]).toBe("no-referrer")
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'")
    expect(drive.resolvePublishedAsset).toHaveBeenCalledWith({
      publishId: "pub_page",
      type: "page",
      relativePath: "index.html",
    })
  })

  it("serves site assets through the server proxy", async () => {
    drive.resolvePublishedAsset.mockResolvedValue({
      stream: Readable.from(["window.ok = true"]),
      contentType: "application/javascript; charset=utf-8",
      size: 16n,
    })

    const response = await request(app!.getHttpServer()).get("/sites/pub_site/app.js").expect(200)
    expect(response.text).toBe("window.ok = true")
    expect(response.headers["content-type"]).toContain("javascript")
    expect(drive.resolvePublishedAsset).toHaveBeenCalledWith({
      publishId: "pub_site",
      type: "site",
      relativePath: "app.js",
    })
  })

  it("redirects site roots and serves the site index for empty asset paths", async () => {
    drive.resolvePublishedAsset.mockResolvedValue({
      stream: Readable.from(["<main>Site</main>"]),
      contentType: "text/html; charset=utf-8",
      size: 17n,
    })

    const redirect = await request(app!.getHttpServer()).get("/sites/pub_site").expect(302)
    expect(redirect.headers.location).toBe("/sites/pub_site/")

    const index = await request(app!.getHttpServer()).get("/sites/pub_site/").expect(200)
    expect(index.text).toBe("<main>Site</main>")
    expect(drive.resolvePublishedAsset).toHaveBeenCalledWith({
      publishId: "pub_site",
      type: "site",
      relativePath: "index.html",
    })
  })

  it("returns the same public not found text for missing publications", async () => {
    const response = await request(app!.getHttpServer()).get("/pages/pub_missing").expect(404)
    expect(response.text).toBe("网页未找到")
    expect(response.headers["content-type"]).toContain("text/plain")
  })

  it("returns public not found when a published asset stream fails before sending headers", async () => {
    const error = new Error("stream failed")
    drive.resolvePublishedAsset.mockResolvedValue({
      stream: new Readable({
        read() {
          this.destroy(error)
        },
      }),
      contentType: "text/html; charset=utf-8",
      size: undefined,
    })

    const response = await request(app!.getHttpServer()).get("/pages/pub_broken").expect(404)

    expect(response.text).toBe("网页未找到")
    expect(drive.resolvePublishedAsset).toHaveBeenCalledWith({
      publishId: "pub_broken",
      type: "page",
      relativePath: "index.html",
    })
  })

  it("renders public folder children and redirects public file downloads", async () => {
    drive.resolvePublicShare.mockResolvedValue({
      type: "folder",
      item: { id: "folder-1", name: "交接材料" },
      ownerId: "user-1",
      storageKey: null,
    })
    drive.listPublicFolderChildren.mockResolvedValue({
      item: { id: "folder-1", name: "交接材料" },
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
    const download = await request(app!.getHttpServer()).get("/files/shr_folder/download").expect(302)
    expect(download.headers.location).toBe("https://cos.example/download")
    const childDownload = await request(app!.getHttpServer()).get("/files/shr_folder/file-1/download").expect(302)
    expect(childDownload.headers.location).toBe("https://cos.example/child-download")
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
    currentDeploymentId: "dep-1",
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
