import { type INestApplication, NotFoundException, UnauthorizedException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { DrivePublicController, DriveUserController } from "./drive.controller"
import { DriveService } from "./drive.service"

type SupertestResponse = { readonly text: string; readonly headers: Record<string, string> }
type SupertestChain = {
  readonly expect: (status: number) => Promise<SupertestResponse>
}
const request = require("supertest") as (server: unknown) => {
  readonly get: (path: string) => SupertestChain
  readonly post: (path: string) => { readonly send: (body: unknown) => SupertestChain }
}

describe("DriveController", () => {
  let app: INestApplication | null = null
  const drive = {
    listItems: vi.fn(),
    prepareFolderUpload: vi.fn(),
    resolvePublicShare: vi.fn(),
    listPublicFolderChildren: vi.fn(),
    createDownloadUrlForShare: vi.fn(),
    createDownloadUrlForShareChild: vi.fn(),
  }

  beforeEach(async () => {
    drive.listItems.mockReset()
    drive.prepareFolderUpload.mockReset()
    drive.resolvePublicShare.mockReset()
    drive.listPublicFolderChildren.mockReset()
    drive.createDownloadUrlForShare.mockReset()
    drive.createDownloadUrlForShareChild.mockReset()
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
