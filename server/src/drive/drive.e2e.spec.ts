import { type INestApplication, UnauthorizedException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { Prisma } from "@prisma/client"
import cookieParser from "cookie-parser"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { DriveAdminController, DriveLocalStorageController, DrivePublicController, DriveUserController } from "./drive.controller"
import { DriveLifecycleService } from "./drive-lifecycle.service"
import { DrivePublicAssetService } from "./drive-public-asset.service"
import { DriveService } from "./drive.service"
import { LocalDriveStorage } from "./drive-storage"

type SupertestResponse = { readonly body: any; readonly text: string; readonly headers: Record<string, string | string[] | undefined> }
type SupertestRequest = {
  readonly send: (body: unknown) => SupertestRequest
  readonly set: (field: string, value: string | readonly string[]) => SupertestRequest
  readonly expect: (status: number) => Promise<SupertestResponse>
}

const request = require("supertest") as (server: unknown) => {
  readonly get: (path: string) => SupertestRequest
  readonly head: (path: string) => SupertestRequest
  readonly post: (path: string) => SupertestRequest
  readonly patch: (path: string) => SupertestRequest
  readonly put: (path: string) => SupertestRequest
  readonly delete: (path: string) => SupertestRequest
}

const ownerUser = { id: "owner-user", email: "owner@example.com", passwordHash: "hash" }
const editorUser = { id: "editor-user", email: "editor@example.com", passwordHash: "hash" }
const outsiderUser = { id: "outsider-user", email: "outsider@example.com", passwordHash: "hash" }

describe("Drive share and edit E2E", () => {
  let app: INestApplication | null = null
  let prisma: ReturnType<typeof createPrismaMemory>
  let tempRoot = ""
  const originalEnv = {
    APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
    USER_ACCESS_JWT_SECRET: process.env.USER_ACCESS_JWT_SECRET,
  }

  beforeEach(async () => {
    process.env.USER_ACCESS_JWT_SECRET = "drive-e2e-user-secret-with-32-chars"
    process.env.APP_PUBLIC_URL = "http://synapse.test"
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-e2e-"))
    prisma = createPrismaMemory()
    await prisma.user.create({ data: ownerUser })
    await prisma.user.create({ data: editorUser })
    await prisma.user.create({ data: outsiderUser })

    const localStorage = new LocalDriveStorage({ publicAppUrl: "http://synapse.test", root: tempRoot })
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController, DrivePublicController, DriveLocalStorageController],
      providers: [
        DriveService,
        { provide: "DriveStoragePort", useValue: localStorage },
        { provide: LocalDriveStorage, useValue: localStorage },
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { record: vi.fn(async () => undefined) } },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          const req = context.switchToHttp().getRequest()
          const userId = req.headers["x-test-user-id"]
          if (typeof userId !== "string") throw new UnauthorizedException("未登录或登录已过期。")
          req.user = { id: userId }
          return true
        }),
      })
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = null
    restoreProcessEnv("APP_PUBLIC_URL", originalEnv.APP_PUBLIC_URL)
    restoreProcessEnv("USER_ACCESS_JWT_SECRET", originalEnv.USER_ACCESS_JWT_SECRET)
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  it("covers upload, protected share access, share editing, version conflicts, download, and revocation", async () => {
    const uploaded = await uploadTextFile({
      app: app!,
      userId: ownerUser.id,
      name: "notes.md",
      text: "# 初始\n",
      mimeType: "text/markdown",
    })

    await request(app!.getHttpServer())
      .get(`/api/drive/browser/owner/items/${uploaded.id}`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.current.name).toBe("notes.md")
        expect(response.body.preview.text).toBe("# 初始\n")
        expect(response.body.edit.canEdit).toBe(true)
        expect(response.body.edit.currentVersionId).toBe(uploaded.versionId)
      })

    const staleBaseVersionId = uploaded.versionId
    const ownerEdit = await request(app!.getHttpServer())
      .patch(`/api/drive/browser/owner/items/${uploaded.id}/content`)
      .set("x-test-user-id", ownerUser.id)
      .send({ contentType: "text", text: "# Owner edit\n", baseVersionId: staleBaseVersionId })
      .expect(200)
    expect(ownerEdit.body.item.size).toBe("13")
    expect(ownerEdit.body.version.source).toBe("online_edit")

    await request(app!.getHttpServer())
      .patch(`/api/drive/browser/owner/items/${uploaded.id}/content`)
      .set("x-test-user-id", ownerUser.id)
      .send({ contentType: "text", text: "# stale\n", baseVersionId: staleBaseVersionId })
      .expect(409)

    const share = await request(app!.getHttpServer())
      .post(`/api/drive/items/${uploaded.id}/share`)
      .set("x-test-user-id", ownerUser.id)
      .send({
        passwordEnabled: true,
        expiresIn: "7d",
        accessMode: "specified_users_edit",
        editorEmails: [editorUser.email, editorUser.email.toUpperCase()],
      })
      .expect(201)

    expect(share.body.password).toEqual(expect.any(String))
    expect(share.body.passwordEnabled).toBe(true)
    expect(share.body.editorEmails).toEqual([editorUser.email])

    await request(app!.getHttpServer())
      .get(`/api/drive/browser/shares/${share.body.shareId}`)
      .expect(200)
      .then((response) => {
        expect(response.body).toEqual({ passwordRequired: true, message: "请输入密码。" })
      })

    await request(app!.getHttpServer())
      .post(`/api/drive/browser/shares/${share.body.shareId}/access`)
      .send({ password: "wrong-password" })
      .expect(201)
      .then((response) => {
        expect(response.body.passwordRequired).toBe(true)
        expect(response.headers["set-cookie"]).toBeUndefined()
      })

    const unlocked = await request(app!.getHttpServer())
      .post(`/api/drive/browser/shares/${share.body.shareId}/access`)
      .send({ password: share.body.password })
      .expect(201)
    const cookie = readFirstCookie(unlocked)
    expect(cookie).toContain("synapse_drive_access_share_")
    expect(unlocked.body.current.id).toBe(uploaded.id)
    expect(unlocked.body.preview.text).toBe("# Owner edit\n")
    expect(unlocked.body.edit.canEdit).toBe(false)
    expect(unlocked.body.edit.reason).toBe("login_required")

    await request(app!.getHttpServer())
      .patch(`/api/drive/browser/shares/${share.body.shareId}/content`)
      .set("x-test-user-id", outsiderUser.id)
      .set("Cookie", cookie)
      .send({ contentType: "text", text: "# Outsider\n", baseVersionId: ownerEdit.body.version.id })
      .expect(403)

    const sharedEdit = await request(app!.getHttpServer())
      .patch(`/api/drive/browser/shares/${share.body.shareId}/content`)
      .set("x-test-user-id", editorUser.id)
      .set("Cookie", cookie)
      .send({ contentType: "text", text: "# Shared edit\n", baseVersionId: ownerEdit.body.version.id })
      .expect(200)
    expect(sharedEdit.body.item.size).toBe("14")
    expect(sharedEdit.body.version.source).toBe("online_edit")

    await request(app!.getHttpServer())
      .get(`/share/${share.body.shareId}/download`)
      .set("Cookie", cookie)
      .expect(200)
      .then((response) => {
        expect(response.text).toBe("# Shared edit\n")
      })

    await request(app!.getHttpServer())
      .get(`/api/drive/items/${uploaded.id}/versions?offset=0&limit=10`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBe(3)
        expect(response.body.items.map((version: { readonly source: string }) => version.source)).toEqual([
          "online_edit",
          "online_edit",
          "upload",
        ])
        expect(response.body.items[0].isCurrent).toBe(true)
      })

    await request(app!.getHttpServer())
      .delete(`/api/drive/shares/${share.body.id}`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)

    await request(app!.getHttpServer())
      .get(`/api/drive/browser/shares/${share.body.shareId}`)
      .set("Cookie", cookie)
      .expect(404)
  })

  it("covers folder sharing, child item editing, pagination, zip download, and path boundaries", async () => {
    const folder = await request(app!.getHttpServer())
      .post("/api/drive/folders")
      .set("x-test-user-id", ownerUser.id)
      .send({ parentId: null, name: "Project" })
      .expect(201)

    const childA = await uploadTextFile({
      app: app!,
      userId: ownerUser.id,
      parentId: folder.body.id,
      name: "a.txt",
      text: "A",
      mimeType: "text/plain",
    })
    const childB = await uploadTextFile({
      app: app!,
      userId: ownerUser.id,
      parentId: folder.body.id,
      name: "b.txt",
      text: "B",
      mimeType: "text/plain",
    })
    const outside = await uploadTextFile({
      app: app!,
      userId: ownerUser.id,
      parentId: null,
      name: "outside.txt",
      text: "outside",
      mimeType: "text/plain",
    })

    const share = await request(app!.getHttpServer())
      .post(`/api/drive/items/${folder.body.id}/share`)
      .set("x-test-user-id", ownerUser.id)
      .send({ passwordEnabled: false, expiresIn: "forever", accessMode: "link_edit" })
      .expect(201)

    await request(app!.getHttpServer())
      .get(`/api/drive/browser/shares/${share.body.shareId}?childrenOffset=0&childrenLimit=1`)
      .expect(200)
      .then((response) => {
        expect(response.body.children).toHaveLength(1)
        expect(response.body.childrenPage.hasMore).toBe(true)
        expect(response.body.canZip).toBe(true)
      })

    const edit = await request(app!.getHttpServer())
      .patch(`/api/drive/browser/shares/${share.body.shareId}/items/${childA.id}/content`)
      .set("x-test-user-id", outsiderUser.id)
      .send({ contentType: "text", text: "AA", baseVersionId: childA.versionId })
      .expect(200)
    expect(edit.body.item.id).toBe(childA.id)

    await request(app!.getHttpServer())
      .get(`/api/drive/browser/shares/${share.body.shareId}/items/${outside.id}`)
      .expect(404)

    await request(app!.getHttpServer())
      .get(`/share/${share.body.shareId}/download`)
      .expect(200)
      .then((response) => {
        expect(response.headers["content-type"]).toContain("application/zip")
      })
  })

  it("covers invalid names, upload size enforcement, unsupported edits, and locked edit attempts", async () => {
    await request(app!.getHttpServer())
      .post("/api/drive/uploads/prepare")
      .set("x-test-user-id", ownerUser.id)
      .send({ parentId: null, name: "bad:name.txt", size: "1", mimeType: "text/plain" })
      .expect(400)

    const prepared = await request(app!.getHttpServer())
      .post("/api/drive/uploads/prepare")
      .set("x-test-user-id", ownerUser.id)
      .send({ parentId: null, name: "limited.txt", size: "1", mimeType: "text/plain" })
      .expect(201)
    const token = new URL(prepared.body.upload.url).pathname.split("/").pop()
    await request(app!.getHttpServer())
      .put(`/api/drive/local-upload/${token}`)
      .set("Content-Type", "text/plain")
      .send("too-large")
      .expect(413)
    await request(app!.getHttpServer())
      .post(`/api/drive/uploads/${prepared.body.sessionId}/complete`)
      .set("x-test-user-id", ownerUser.id)
      .expect(400)

    const html = await uploadTextFile({
      app: app!,
      userId: ownerUser.id,
      name: "page.html",
      text: "<h1>Hello</h1>",
      mimeType: "text/html",
    })
    await request(app!.getHttpServer())
      .get(`/drive/items/${html.id}/render`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.text).toBe("<h1>Hello</h1>")
        expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'self'")
      })

    const binary = await uploadTextFile({
      app: app!,
      userId: ownerUser.id,
      name: "file.bin",
      text: "abc",
      mimeType: "application/octet-stream",
    })
    await request(app!.getHttpServer())
      .patch(`/api/drive/browser/owner/items/${binary.id}/content`)
      .set("x-test-user-id", ownerUser.id)
      .send({ contentType: "text", text: "def", baseVersionId: binary.versionId })
      .expect(400)

    const readShare = await request(app!.getHttpServer())
      .post(`/api/drive/items/${binary.id}/share`)
      .set("x-test-user-id", ownerUser.id)
      .send({ passwordEnabled: true, expiresIn: "7d", accessMode: "link_read" })
      .expect(201)
    await request(app!.getHttpServer())
      .patch(`/api/drive/browser/shares/${readShare.body.shareId}/content`)
      .set("x-test-user-id", ownerUser.id)
      .send({ contentType: "text", text: "def", baseVersionId: binary.versionId })
      .expect(401)
  })

  it("covers share setting replacement, share listing, password query redirects, and shared HTML rendering", async () => {
    const html = await uploadTextFile({
      app: app!,
      userId: ownerUser.id,
      name: "reader.html",
      text: "<main>Readable</main>",
      mimeType: "text/html",
    })

    const protectedShare = await request(app!.getHttpServer())
      .post(`/api/drive/items/${html.id}/share`)
      .set("x-test-user-id", ownerUser.id)
      .send({ passwordEnabled: true, expiresIn: "30d", accessMode: "link_read" })
      .expect(201)

    await request(app!.getHttpServer())
      .get("/api/drive/shares?offset=0&limit=5")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.items).toHaveLength(1)
        expect(response.body.items[0]).toMatchObject({
          id: protectedShare.body.id,
          shareId: protectedShare.body.shareId,
          itemName: "reader.html",
          passwordEnabled: true,
          accessMode: "link_read",
        })
        expect(response.body.items[0].urlWithPassword).toBe(`${protectedShare.body.url}?password=${protectedShare.body.password}`)
      })

    const redirect = await request(app!.getHttpServer())
      .get(`/share/${protectedShare.body.shareId}/render?password=${protectedShare.body.password}`)
      .expect(302)
    const cookie = readFirstCookie(redirect)
    expect(redirect.headers.location).toBe(`/share/${protectedShare.body.shareId}/render`)

    await request(app!.getHttpServer())
      .get(`/share/${protectedShare.body.shareId}/render`)
      .set("Cookie", cookie)
      .expect(200)
      .then((response) => {
        expect(response.text).toBe("<main>Readable</main>")
        expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'self'")
      })

    const editableShare = await request(app!.getHttpServer())
      .post(`/api/drive/items/${html.id}/share`)
      .set("x-test-user-id", ownerUser.id)
      .send({ passwordEnabled: false, expiresIn: "forever", accessMode: "link_edit" })
      .expect(201)
    expect(editableShare.body.id).toBe(protectedShare.body.id)
    expect(editableShare.body.shareId).toBe(protectedShare.body.shareId)
    expect(editableShare.body.passwordEnabled).toBe(false)
    expect(editableShare.body.password).toBeNull()

    const edited = await request(app!.getHttpServer())
      .patch(`/api/drive/browser/shares/${editableShare.body.shareId}/content`)
      .set("x-test-user-id", outsiderUser.id)
      .send({ contentType: "text", text: "<main>Edited</main>", baseVersionId: html.versionId })
      .expect(200)
    expect(edited.body.version.source).toBe("online_edit")

    await request(app!.getHttpServer())
      .get(`/share/${editableShare.body.shareId}/render`)
      .expect(200)
      .then((response) => {
        expect(response.text).toBe("<main>Edited</main>")
      })

    await request(app!.getHttpServer())
      .get("/api/drive/shares")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.items[0]).toMatchObject({
          id: protectedShare.body.id,
          passwordEnabled: false,
          password: null,
          accessMode: "link_edit",
        })
        expect(response.body.items[0].urlWithPassword).toBe(editableShare.body.url)
      })
  })

  it("covers same-name overwrite, share continuity, and owner version lifecycle routes", async () => {
    const first = await uploadTextFile({
      app: app!,
      userId: ownerUser.id,
      name: "report.txt",
      text: "version-one",
      mimeType: "text/plain",
    })
    const share = await request(app!.getHttpServer())
      .post(`/api/drive/items/${first.id}/share`)
      .set("x-test-user-id", ownerUser.id)
      .send({ passwordEnabled: false, expiresIn: "forever", accessMode: "link_read" })
      .expect(201)

    const second = await uploadTextFile({
      app: app!,
      userId: ownerUser.id,
      name: "report.txt",
      text: "version-two",
      mimeType: "text/plain",
    })
    expect(second.id).toBe(first.id)

    await request(app!.getHttpServer())
      .get(`/share/${share.body.shareId}/download`)
      .expect(200)
      .then((response) => {
        expect(response.text).toBe("version-two")
      })

    const versions = await request(app!.getHttpServer())
      .get(`/api/drive/items/${first.id}/versions?offset=0&limit=10`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
    expect(versions.body.items.map((version: { readonly versionNumber: number }) => version.versionNumber)).toEqual([2, 1])
    const current = versions.body.items[0]
    const historical = versions.body.items[1]

    await request(app!.getHttpServer())
      .get(`/api/drive/items/${first.id}/versions/${historical.id}/download`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.text).toBe("version-one")
        expect(response.headers["content-disposition"]).toContain("v1-report.txt")
      })

    await request(app!.getHttpServer())
      .patch(`/api/drive/items/${first.id}/versions/${historical.id}`)
      .set("x-test-user-id", ownerUser.id)
      .send({ isPinned: true })
      .expect(200)
      .then((response) => {
        expect(response.body.isPinned).toBe(true)
      })

    await request(app!.getHttpServer())
      .delete(`/api/drive/items/${first.id}/versions/${current.id}`)
      .set("x-test-user-id", ownerUser.id)
      .expect(400)

    await request(app!.getHttpServer())
      .post(`/api/drive/items/${first.id}/versions/${historical.id}/restore`)
      .set("x-test-user-id", ownerUser.id)
      .expect(201)

    await request(app!.getHttpServer())
      .get(`/share/${share.body.shareId}/download`)
      .expect(200)
      .then((response) => {
        expect(response.text).toBe("version-one")
      })

    const restoredVersions = await request(app!.getHttpServer())
      .get(`/api/drive/items/${first.id}/versions?offset=0&limit=10`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
    expect(restoredVersions.body.items.map((version: { readonly source: string }) => version.source)).toEqual([
      "restore",
      "upload",
      "upload",
    ])

    await request(app!.getHttpServer())
      .delete(`/api/drive/items/${first.id}/versions/${current.id}`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
    await request(app!.getHttpServer())
      .get(`/api/drive/items/${first.id}/versions?offset=0&limit=10`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.items.map((version: { readonly id: string }) => version.id)).not.toContain(current.id)
      })
  })
})

describe("Drive public asset user journeys", () => {
  let app: INestApplication | null = null
  let prisma: ReturnType<typeof createPrismaMemory>
  let localStorage: LocalDriveStorage
  let tempRoot = ""
  const originalEnv = {
    APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
    USER_ACCESS_JWT_SECRET: process.env.USER_ACCESS_JWT_SECRET,
  }

  beforeEach(async () => {
    process.env.USER_ACCESS_JWT_SECRET = "drive-e2e-user-secret-with-32-chars"
    process.env.APP_PUBLIC_URL = "http://synapse.test"
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-public-asset-e2e-"))
    prisma = createPrismaMemory()
    await prisma.user.create({ data: ownerUser })
    await prisma.user.create({ data: editorUser })

    localStorage = new LocalDriveStorage({ publicAppUrl: "http://synapse.test", root: tempRoot })
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController, DrivePublicController, DriveLocalStorageController, DriveAdminController],
      providers: [
        DriveService,
        DrivePublicAssetService,
        DriveLifecycleService,
        { provide: "DriveStoragePort", useValue: localStorage },
        { provide: LocalDriveStorage, useValue: localStorage },
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { record: vi.fn(async () => undefined) } },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          const req = context.switchToHttp().getRequest()
          const userId = req.headers["x-test-user-id"]
          if (typeof userId !== "string") throw new UnauthorizedException("未登录或登录已过期。")
          req.user = { id: userId }
          return true
        }),
      })
      .overrideGuard(AdminAuthGuard)
      .useValue({
        canActivate: vi.fn((context) => {
          const req = context.switchToHttp().getRequest()
          const email = req.headers["x-test-admin-email"]
          if (typeof email !== "string") throw new UnauthorizedException("未登录或登录已过期。")
          req.admin = { id: "admin-1", email }
          return true
        }),
      })
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = null
    restoreProcessEnv("APP_PUBLIC_URL", originalEnv.APP_PUBLIC_URL)
    restoreProcessEnv("USER_ACCESS_JWT_SECRET", originalEnv.USER_ACCESS_JWT_SECRET)
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  it("covers upload, public serving, replacement, rename, trash, restore, final hide, and admin observability", async () => {
    await request(app!.getHttpServer())
      .post("/api/drive/public-assets/uploads/prepare")
      .set("x-test-user-id", ownerUser.id)
      .send({ name: "notes.txt", size: "4", mimeType: "text/plain" })
      .expect(400)

    const uploaded = await uploadPublicAssetFile({
      app: app!,
      userId: ownerUser.id,
      name: "logo.png",
      mimeType: "image/png",
      body: pngBytes("first"),
    })
    const assetId = uploaded.asset.assetId
    const itemId = uploaded.asset.itemId
    expect(uploaded.asset.url).toBe(`http://synapse.test/files/${assetId}`)

    await request(app!.getHttpServer())
      .get("/api/drive/items")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body).toEqual([])
      })

    await request(app!.getHttpServer())
      .get("/api/drive/public-assets?offset=0&limit=10")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBe(1)
        expect(response.body.items[0]).toMatchObject({
          assetId,
          itemId,
          name: "logo.png",
          lifecycleStatus: "active",
          accessCount: "0",
        })
      })

    await request(app!.getHttpServer())
      .get(`/files/${assetId}`)
      .set("Referer", "https://example.test/page")
      .expect(200)
      .then((response) => {
        expect((response.body ?? Buffer.from(response.text ?? "")).toString("utf8")).toContain("first")
        expect(response.headers["content-type"]).toContain("image/png")
        expect(response.headers["cache-control"]).toBe("public, max-age=300")
      })

    await request(app!.getHttpServer())
      .head(`/files/${assetId}`)
      .expect(200)
      .then((response) => {
        expect(response.headers["content-length"]).toBe(String(pngBytes("first").length))
      })

    await flushPublicAssetAccessWrites()
    await request(app!.getHttpServer())
      .get(`/api/drive/public-assets/${assetId}`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.accessCount).toBe("1")
        expect(response.body.responseBytes).toBe(String(pngBytes("first").length))
      })

    const replacement = await preparePublicAssetReplace({
      app: app!,
      userId: ownerUser.id,
      assetId,
      name: "logo.webp",
      mimeType: "image/webp",
      body: webpBytes("second"),
    })
    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/${assetId}/replace/${replacement.sessionId}/complete`)
      .set("x-test-user-id", ownerUser.id)
      .expect(201)
      .then((response) => {
        expect(response.body).toMatchObject({
          assetId,
          itemId,
          name: "logo.webp",
          mimeType: "image/webp",
          lifecycleStatus: "active",
        })
      })

    await request(app!.getHttpServer())
      .patch(`/api/drive/public-assets/${assetId}`)
      .set("x-test-user-id", ownerUser.id)
      .send({ name: "brand.png" })
      .expect(400)

    await request(app!.getHttpServer())
      .patch(`/api/drive/public-assets/${assetId}`)
      .set("x-test-user-id", ownerUser.id)
      .send({ name: "brand.webp" })
      .expect(200)
      .then((response) => {
        expect(response.body).toMatchObject({ assetId, itemId, name: "brand.webp" })
        expect(response.body.url).toBe(`http://synapse.test/files/${assetId}`)
      })

    await request(app!.getHttpServer())
      .get(`/api/admin/drive/public-assets/${assetId}/revisions?page=1&pageSize=10`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBe(1)
        expect(response.body.data[0]).toMatchObject({
          assetId,
          itemId,
          name: "logo.png",
          mimeType: "image/png",
        })
      })

    await request(app!.getHttpServer())
      .delete(`/api/drive/public-assets/${assetId}`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.lifecycleStatus).toBe("trashed")
      })

    await request(app!.getHttpServer()).get(`/files/${assetId}`).expect(404)

    await request(app!.getHttpServer())
      .get("/api/drive/trash")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBe(1)
        expect(response.body.items[0]).toMatchObject({
          id: itemId,
          assetId,
          kind: "public_asset",
          name: "brand.webp",
          originalPath: "brand.webp",
        })
      })

    await request(app!.getHttpServer())
      .post(`/api/drive/items/${itemId}/restore`)
      .set("x-test-user-id", ownerUser.id)
      .expect(404)

    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/${assetId}/restore`)
      .set("x-test-user-id", ownerUser.id)
      .expect(201)
      .then((response) => {
        expect(response.body.lifecycleStatus).toBe("active")
      })
    await request(app!.getHttpServer()).get(`/files/${assetId}`).expect(200)

    await request(app!.getHttpServer())
      .delete(`/api/drive/public-assets/${assetId}`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
    await request(app!.getHttpServer())
      .delete(`/api/drive/trash/${itemId}`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)

    await request(app!.getHttpServer())
      .get("/api/drive/public-assets")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.items).toEqual([])
      })
    await request(app!.getHttpServer())
      .get("/api/drive/trash")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.items).toEqual([])
      })
    await request(app!.getHttpServer()).get(`/files/${assetId}`).expect(404)

    await request(app!.getHttpServer())
      .get(`/api/admin/drive/public-assets?lifecycleStatus=hidden&search=${assetId}`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBe(1)
        expect(response.body.data[0]).toMatchObject({
          assetId,
          itemId,
          name: "brand.webp",
          lifecycleStatus: "hidden",
        })
      })

    await flushPublicAssetAccessWrites()
    await request(app!.getHttpServer())
      .get(`/api/admin/drive/public-assets/${assetId}/access-logs?page=1&pageSize=10`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBeGreaterThanOrEqual(3)
        expect(response.body.data.map((entry: { readonly statusCode: number }) => entry.statusCode)).toContain(404)
        expect(response.body.data.map((entry: { readonly method: string }) => entry.method)).toContain("HEAD")
      })

    await request(app!.getHttpServer())
      .post(`/api/admin/drive/items/${itemId}/restore`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(201)
      .then((response) => {
        expect(response.body).toMatchObject({ id: itemId, name: "brand.webp" })
      })
    await request(app!.getHttpServer()).get(`/files/${assetId}`).expect(200)
  })

  it("covers cancellation, invalid image bytes, and cross-user public asset boundaries", async () => {
    const uploaded = await uploadPublicAssetFile({
      app: app!,
      userId: ownerUser.id,
      name: "owner.png",
      mimeType: "image/png",
      body: pngBytes("owner"),
    })
    const assetId = uploaded.asset.assetId

    await request(app!.getHttpServer())
      .get("/api/drive/public-assets")
      .set("x-test-user-id", editorUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.items).toEqual([])
      })
    await request(app!.getHttpServer())
      .get(`/api/drive/public-assets/${assetId}`)
      .set("x-test-user-id", editorUser.id)
      .expect(404)
    await request(app!.getHttpServer())
      .delete(`/api/drive/public-assets/${assetId}`)
      .set("x-test-user-id", editorUser.id)
      .expect(404)
    await request(app!.getHttpServer()).get(`/files/${assetId}`).expect(200)

    const cancelled = await request(app!.getHttpServer())
      .post("/api/drive/public-assets/uploads/prepare")
      .set("x-test-user-id", ownerUser.id)
      .send({ name: "cancelled.png", size: String(pngBytes("cancelled").length), mimeType: "image/png" })
      .expect(201)
    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/uploads/${cancelled.body.sessionId}/cancel`)
      .set("x-test-user-id", ownerUser.id)
      .expect(201)
    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/uploads/${cancelled.body.sessionId}/complete`)
      .set("x-test-user-id", ownerUser.id)
      .expect(404)

    const badBytes = Buffer.from("notimage")
    const invalid = await request(app!.getHttpServer())
      .post("/api/drive/public-assets/uploads/prepare")
      .set("x-test-user-id", ownerUser.id)
      .send({ name: "bad.png", size: String(badBytes.length), mimeType: "image/png" })
      .expect(201)
    const invalidToken = new URL(invalid.body.upload.url).pathname.split("/").pop()
    await request(app!.getHttpServer())
      .put(`/api/drive/local-upload/${invalidToken}`)
      .set("Content-Type", "image/png")
      .send(badBytes)
      .expect(200)
    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/uploads/${invalid.body.sessionId}/complete`)
      .set("x-test-user-id", ownerUser.id)
      .expect(400)

    const replacement = await preparePublicAssetReplace({
      app: app!,
      userId: ownerUser.id,
      assetId,
      name: "owner.webp",
      mimeType: "image/webp",
      body: webpBytes("cancel-replace"),
    })
    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/${assetId}/replace/${replacement.sessionId}/cancel`)
      .set("x-test-user-id", ownerUser.id)
      .expect(201)
    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/${assetId}/replace/${replacement.sessionId}/complete`)
      .set("x-test-user-id", ownerUser.id)
      .expect(404)

    await request(app!.getHttpServer())
      .get(`/api/drive/public-assets/${assetId}`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body).toMatchObject({
          assetId,
          name: "owner.png",
          mimeType: "image/png",
          lifecycleStatus: "active",
        })
      })
    await request(app!.getHttpServer())
      .get(`/api/admin/drive/public-assets/${assetId}/revisions?page=1&pageSize=10`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBe(0)
      })
    await request(app!.getHttpServer())
      .get("/api/drive/public-assets")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBe(1)
        expect(response.body.items.map((item: { readonly name: string }) => item.name)).toEqual(["owner.png"])
      })
    await request(app!.getHttpServer())
      .get("/api/drive/trash")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.items).toEqual([])
      })
  })

  it("covers pagination, downloads, admin filters, revision downloads, cache revalidation, expired sessions, and missing objects", async () => {
    const alpha = await uploadPublicAssetFile({
      app: app!,
      userId: ownerUser.id,
      name: "alpha.png",
      mimeType: "image/png",
      body: pngBytes("alpha"),
    })
    const beta = await uploadPublicAssetFile({
      app: app!,
      userId: ownerUser.id,
      name: "beta.gif",
      mimeType: "image/gif",
      body: gifBytes("beta"),
    })
    const gamma = await uploadPublicAssetFile({
      app: app!,
      userId: editorUser.id,
      name: "gamma.webp",
      mimeType: "image/webp",
      body: webpBytes("gamma"),
    })

    await request(app!.getHttpServer())
      .get("/api/drive/public-assets?offset=0&limit=1")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBe(2)
        expect(response.body.items).toHaveLength(1)
        expect(response.body.page).toMatchObject({ offset: 0, limit: 1, hasMore: true, nextOffset: 1 })
      })
    await request(app!.getHttpServer())
      .get("/api/drive/public-assets?offset=1&limit=1")
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body.items).toHaveLength(1)
        expect(response.body.page).toMatchObject({ offset: 1, limit: 1, hasMore: false, nextOffset: null })
      })
    await request(app!.getHttpServer())
      .get("/api/drive/public-assets?offset=-1")
      .set("x-test-user-id", ownerUser.id)
      .expect(400)
    await request(app!.getHttpServer())
      .get("/api/drive/public-assets?limit=abc")
      .set("x-test-user-id", ownerUser.id)
      .expect(400)

    await request(app!.getHttpServer())
      .get(`/api/drive/public-assets/${alpha.asset.assetId}/download`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect((response.body ?? Buffer.from(response.text ?? "")).toString("utf8")).toContain("alpha")
        expect(response.headers["content-type"]).toContain("image/png")
        expect(response.headers["content-disposition"]).toContain("alpha.png")
        expect(response.headers["content-length"]).toBe(alpha.asset.size)
      })

    await request(app!.getHttpServer())
      .get(`/api/admin/drive/public-assets?userId=${editorUser.id}`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBe(1)
        expect(response.body.data[0]).toMatchObject({
          assetId: gamma.asset.assetId,
          owner: {
            userId: editorUser.id,
            email: editorUser.email,
          },
        })
      })
    await request(app!.getHttpServer())
      .get(`/api/admin/drive/public-assets?search=${encodeURIComponent(editorUser.email)}`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(200)
      .then((response) => {
        expect(response.body.total).toBe(1)
        expect(response.body.data[0].assetId).toBe(gamma.asset.assetId)
      })
    await request(app!.getHttpServer())
      .get("/api/admin/drive/public-assets?sortBy=unknown")
      .set("x-test-admin-email", "admin@example.com")
      .expect(400)

    const replacement = await preparePublicAssetReplace({
      app: app!,
      userId: ownerUser.id,
      assetId: alpha.asset.assetId,
      name: "alpha-next.png",
      mimeType: "image/png",
      body: pngBytes("alpha-next"),
    })
    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/${alpha.asset.assetId}/replace/${replacement.sessionId}/complete`)
      .set("x-test-user-id", ownerUser.id)
      .expect(201)
    const revisions = await request(app!.getHttpServer())
      .get(`/api/admin/drive/public-assets/${alpha.asset.assetId}/revisions?page=1&pageSize=10&sortBy=size&sortOrder=asc`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(200)
    expect(revisions.body.total).toBe(1)
    await request(app!.getHttpServer())
      .get(`/api/admin/drive/public-assets/${alpha.asset.assetId}/revisions/${revisions.body.data[0].id}/download`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(200)
      .then((response) => {
        expect((response.body ?? Buffer.from(response.text ?? "")).toString("utf8")).toContain("alpha")
        expect(response.headers["content-disposition"]).toContain("alpha.png")
        expect(response.headers["content-length"]).toBe(revisions.body.data[0].size)
      })
    const revisionRecord = prisma.__debug.publicAssetRevisions.get(revisions.body.data[0].id)!
    await localStorage.deleteObject(revisionRecord.storageKey)
    await request(app!.getHttpServer())
      .get(`/api/admin/drive/public-assets/${alpha.asset.assetId}/revisions/${revisions.body.data[0].id}/download`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(404)

    const alphaRecord = findPublicAssetDebugRecord(prisma, alpha.asset.assetId)
    alphaRecord.etag = "\"alpha-etag\""
    await request(app!.getHttpServer())
      .get(`/files/${alpha.asset.assetId}`)
      .set("If-None-Match", "\"alpha-etag\"")
      .expect(304)
      .then((response) => {
        expect(response.headers.etag).toBe("\"alpha-etag\"")
      })
    await flushPublicAssetAccessWrites()
    await request(app!.getHttpServer())
      .get(`/api/admin/drive/public-assets/${alpha.asset.assetId}/access-logs?page=1&pageSize=10&sortBy=statusCode&sortOrder=desc`)
      .set("x-test-admin-email", "admin@example.com")
      .expect(200)
      .then((response) => {
        expect(response.body.data.map((entry: { readonly statusCode: number }) => entry.statusCode)).toContain(304)
      })

    const expired = await request(app!.getHttpServer())
      .post("/api/drive/public-assets/uploads/prepare")
      .set("x-test-user-id", ownerUser.id)
      .send({ name: "expired.png", size: String(pngBytes("expired").length), mimeType: "image/png" })
      .expect(201)
    prisma.__debug.sessions.get(expired.body.sessionId)!.expiresAt = new Date(Date.now() - 1000)
    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/uploads/${expired.body.sessionId}/complete`)
      .set("x-test-user-id", ownerUser.id)
      .expect(400)
    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/uploads/${expired.body.sessionId}/complete`)
      .set("x-test-user-id", ownerUser.id)
      .expect(404)

    const betaRecord = findPublicAssetDebugRecord(prisma, beta.asset.assetId)
    await localStorage.deleteObject(betaRecord.storageKey)
    await request(app!.getHttpServer()).get(`/files/${beta.asset.assetId}`).expect(404)
    await flushPublicAssetAccessWrites()
    expect(prisma.__debug.items.get(beta.asset.itemId)!.objectMissing).toBe(true)
    await request(app!.getHttpServer())
      .get(`/api/drive/public-assets/${beta.asset.assetId}/download`)
      .set("x-test-user-id", ownerUser.id)
      .expect(404)
  })

  it("keeps existing public assets available when upload and replace are rejected by quota", async () => {
    const uploaded = await uploadPublicAssetFile({
      app: app!,
      userId: ownerUser.id,
      name: "quota.png",
      mimeType: "image/png",
      body: pngBytes("quota"),
    })
    const assetId = uploaded.asset.assetId
    const usedSize = BigInt(uploaded.asset.size)
    await prisma.driveUsage.update({
      where: { userId: ownerUser.id },
      data: { quotaBytes: usedSize },
    })

    await request(app!.getHttpServer())
      .post("/api/drive/public-assets/uploads/prepare")
      .set("x-test-user-id", ownerUser.id)
      .send({ name: "over-quota.png", size: String(pngBytes("over-quota").length), mimeType: "image/png" })
      .expect(400)

    await request(app!.getHttpServer())
      .post(`/api/drive/public-assets/${assetId}/replace/prepare`)
      .set("x-test-user-id", ownerUser.id)
      .send({ name: "larger.png", size: String(pngBytes("larger-than-current").length), mimeType: "image/png" })
      .expect(400)

    await request(app!.getHttpServer())
      .get(`/files/${assetId}`)
      .expect(200)
      .then((response) => {
        expect((response.body ?? Buffer.from(response.text ?? "")).toString("utf8")).toContain("quota")
      })
    await request(app!.getHttpServer())
      .get(`/api/drive/public-assets/${assetId}`)
      .set("x-test-user-id", ownerUser.id)
      .expect(200)
      .then((response) => {
        expect(response.body).toMatchObject({
          assetId,
          name: "quota.png",
          size: uploaded.asset.size,
          lifecycleStatus: "active",
        })
      })
  })
})

describe("Drive public asset routes", () => {
  let app: INestApplication | null = null
  const publicAssets = {
    resolvePublicAsset: vi.fn(),
    recordAccessSafely: vi.fn(async () => undefined),
  }
  const storage = {
    getObjectStream: vi.fn(async () => ({
      stream: Readable.from(Buffer.from("png-data")),
      size: 8n,
      contentType: "image/png",
    })),
  }

  beforeEach(async () => {
    publicAssets.resolvePublicAsset.mockReset()
    publicAssets.recordAccessSafely.mockReset()
    publicAssets.recordAccessSafely.mockResolvedValue(undefined)
    storage.getObjectStream.mockReset()
    storage.getObjectStream.mockResolvedValue({
      stream: Readable.from(Buffer.from("png-data")),
      size: 8n,
      contentType: "image/png",
    })
    const moduleRef = await Test.createTestingModule({
      controllers: [DrivePublicController],
      providers: [
        { provide: DriveService, useValue: {} },
        { provide: DrivePublicAssetService, useValue: publicAssets },
        { provide: "DriveStoragePort", useValue: storage },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: vi.fn(() => false) })
      .compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = null
  })

  it("serves public assets inline with short public cache", async () => {
    publicAssets.resolvePublicAsset.mockResolvedValue({
      status: "ok",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      publicAssetId: "public-asset-1",
      userId: "user-1",
      storageKey: "drive/item-1",
      name: "标志 logo.png",
      mimeType: "image/png",
      size: 8n,
      etag: "\"etag-1\"",
    })

    const response = await request(app!.getHttpServer()).get("/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ").expect(200)

    expect((response.body ?? Buffer.from(response.text ?? "")).toString("utf8")).toBe("png-data")
    expect(response.headers["cache-control"]).toBe("public, max-age=300")
    expect(response.headers["content-disposition"]).toContain("inline;")
    expect(response.headers["content-disposition"]).toContain('filename="__ logo.png"')
    expect(response.headers["content-disposition"]).toContain("filename*=UTF-8''%E6%A0%87%E5%BF%97%20logo.png")
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
    expect(response.headers.etag).toBe("\"etag-1\"")
    expect(publicAssets.recordAccessSafely).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      publicAssetId: "public-asset-1",
      method: "GET",
      statusCode: 200,
      bytes: 8n,
    }))
  })

  it("supports HEAD and does not count response bytes", async () => {
    publicAssets.resolvePublicAsset.mockResolvedValue({
      status: "ok",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      publicAssetId: "public-asset-1",
      userId: "user-1",
      storageKey: "drive/item-1",
      name: "logo.png",
      mimeType: "image/png",
      size: 8n,
      etag: "\"etag-1\"",
    })

    const response = await request(app!.getHttpServer()).head("/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ").expect(200)

    expect(response.headers["content-length"]).toBe("8")
    expect(storage.getObjectStream).not.toHaveBeenCalled()
    expect(publicAssets.recordAccessSafely).toHaveBeenCalledWith(expect.objectContaining({
      method: "HEAD",
      statusCode: 200,
      bytes: 0n,
    }))
  })

  it("returns 304 for matching ETags and records zero bytes", async () => {
    publicAssets.resolvePublicAsset.mockResolvedValue({
      status: "not_modified",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      publicAssetId: "public-asset-1",
      userId: "user-1",
      etag: "\"etag-1\"",
    })

    await request(app!.getHttpServer())
      .get("/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")
      .set("If-None-Match", "\"etag-1\"")
      .expect(304)

    expect(storage.getObjectStream).not.toHaveBeenCalled()
    expect(publicAssets.recordAccessSafely).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      statusCode: 304,
      bytes: 0n,
    }))
  })

  it("returns uncached 404 for missing public assets", async () => {
    publicAssets.resolvePublicAsset.mockResolvedValue({
      status: "not_found",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    })

    const response = await request(app!.getHttpServer()).get("/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ").expect(404)

    expect(response.headers["cache-control"]).toBe("no-store")
    expect(storage.getObjectStream).not.toHaveBeenCalled()
    expect(publicAssets.recordAccessSafely).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      method: "GET",
      statusCode: 404,
      bytes: 0n,
    }))
  })
})

async function uploadTextFile(input: {
  readonly app: INestApplication
  readonly userId: string
  readonly parentId?: string | null
  readonly name: string
  readonly text: string
  readonly mimeType: string
}): Promise<{ readonly id: string; readonly versionId: string }> {
  const prepared = await request(input.app.getHttpServer())
    .post("/api/drive/uploads/prepare")
    .set("x-test-user-id", input.userId)
    .send({
      parentId: input.parentId ?? null,
      name: input.name,
      size: String(Buffer.byteLength(input.text)),
      mimeType: input.mimeType,
    })
    .expect(201)
  const token = new URL(prepared.body.upload.url).pathname.split("/").pop()
  await request(input.app.getHttpServer())
    .put(`/api/drive/local-upload/${token}`)
    .set("Content-Type", input.mimeType)
    .send(input.text)
    .expect(200)
  const completed = await request(input.app.getHttpServer())
    .post(`/api/drive/uploads/${prepared.body.sessionId}/complete`)
    .set("x-test-user-id", input.userId)
    .expect(201)
  const versions = await request(input.app.getHttpServer())
    .get(`/api/drive/items/${completed.body.id}/versions`)
    .set("x-test-user-id", input.userId)
    .expect(200)
  return { id: completed.body.id, versionId: versions.body.items[0].id }
}

async function uploadPublicAssetFile(input: {
  readonly app: INestApplication
  readonly userId: string
  readonly name: string
  readonly mimeType: string
  readonly body: Buffer
}): Promise<{ readonly asset: any }> {
  const prepared = await request(input.app.getHttpServer())
    .post("/api/drive/public-assets/uploads/prepare")
    .set("x-test-user-id", input.userId)
    .send({
      name: input.name,
      size: String(input.body.length),
      mimeType: input.mimeType,
    })
    .expect(201)
  const token = new URL(prepared.body.upload.url).pathname.split("/").pop()
  await request(input.app.getHttpServer())
    .put(`/api/drive/local-upload/${token}`)
    .set("Content-Type", input.mimeType)
    .send(input.body)
    .expect(200)
  const completed = await request(input.app.getHttpServer())
    .post(`/api/drive/public-assets/uploads/${prepared.body.sessionId}/complete`)
    .set("x-test-user-id", input.userId)
    .expect(201)
  return { asset: completed.body }
}

async function preparePublicAssetReplace(input: {
  readonly app: INestApplication
  readonly userId: string
  readonly assetId: string
  readonly name: string
  readonly mimeType: string
  readonly body: Buffer
}): Promise<{ readonly sessionId: string }> {
  const prepared = await request(input.app.getHttpServer())
    .post(`/api/drive/public-assets/${input.assetId}/replace/prepare`)
    .set("x-test-user-id", input.userId)
    .send({
      name: input.name,
      size: String(input.body.length),
      mimeType: input.mimeType,
    })
    .expect(201)
  const token = new URL(prepared.body.upload.url).pathname.split("/").pop()
  await request(input.app.getHttpServer())
    .put(`/api/drive/local-upload/${token}`)
    .set("Content-Type", input.mimeType)
    .send(input.body)
    .expect(200)
  return { sessionId: prepared.body.sessionId }
}

function pngBytes(label: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label),
  ])
}

function webpBytes(label: string): Buffer {
  return Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.alloc(4),
    Buffer.from("WEBP", "ascii"),
    Buffer.from(label),
  ])
}

function gifBytes(label: string): Buffer {
  return Buffer.concat([
    Buffer.from("GIF89a", "ascii"),
    Buffer.from(label),
  ])
}

function flushPublicAssetAccessWrites(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function findPublicAssetDebugRecord(prisma: ReturnType<typeof createPrismaMemory>, assetId: string): any {
  const asset = [...prisma.__debug.publicAssets.values()].find((row) => row.assetId === assetId)
  if (!asset) throw new Error(`Public asset not found in test memory: ${assetId}`)
  return asset
}

function restoreProcessEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

function readFirstCookie(response: SupertestResponse): string {
  const header = response.headers["set-cookie"]
  const value = Array.isArray(header) ? header[0] : header
  if (!value) throw new Error("Expected Set-Cookie header.")
  return value.split(";")[0]
}

function createPrismaMemory() {
  let nextId = 1
  const users = new Map<string, { id: string; email: string; passwordHash: string }>()
  const items = new Map<string, any>()
  const usages = new Map<string, any>()
  const sessions = new Map<string, any>()
  const shares = new Map<string, any>()
  const shareEditors = new Map<string, any>()
  const versions = new Map<string, any>()
  const publicAssets = new Map<string, any>()
  const publicAssetRevisions = new Map<string, any>()
  const publicAssetAccessLogs = new Map<string, any>()
  const now = () => new Date("2026-06-07T12:00:00.000Z")
  const id = (prefix: string) => `${prefix}-${nextId++}`
  const withShares = (item: any) => ({
    ...item,
    publicAsset: item?.publicAsset ?? [...publicAssets.values()].find((asset) => asset.itemId === item.id) ?? null,
    user: users.get(item.userId) ? { email: users.get(item.userId)!.email } : null,
    shares: [...shares.values()].filter((share) => share.itemId === item.id && share.enabled).map((share) => ({ enabled: share.enabled })),
  })
  const includePublicAsset = (asset: any, include: any) => ({
    ...asset,
    ...(include?.item ? { item: withShares(items.get(asset.itemId)) } : {}),
    ...(include?.user ? { user: users.get(asset.userId) ? { email: users.get(asset.userId)!.email } : null } : {}),
  })
  const withShareIncludes = (share: any, include: any) => {
    if (!include?.item && !include?.editors) return share
    const item = include?.item ? items.get(share.itemId) : null
    return {
      ...share,
      ...(include?.item ? { item: include.item.select ? selectFields(item, include.item.select) : withShares(item) } : {}),
      ...(include?.editors
        ? {
          editors: [...shareEditors.values()]
            .filter((editor) => editor.driveShareId === share.id)
            .sort((left, right) => left.email.localeCompare(right.email))
            .map((editor) => include.editors.select ? selectFields(editor, include.editors.select) : editor),
        }
        : {}),
    }
  }

  const prisma: any = {
    $transaction: async (input: any) => {
      if (typeof input === "function") {
        const snapshots = [
          [items, cloneMap(items)],
          [usages, cloneMap(usages)],
          [sessions, cloneMap(sessions)],
          [shares, cloneMap(shares)],
          [shareEditors, cloneMap(shareEditors)],
          [versions, cloneMap(versions)],
          [publicAssets, cloneMap(publicAssets)],
          [publicAssetRevisions, cloneMap(publicAssetRevisions)],
          [publicAssetAccessLogs, cloneMap(publicAssetAccessLogs)],
        ] as const
        try {
          return await input(prisma)
        } catch (error) {
          for (const [target, snapshot] of snapshots) restoreMap(target, snapshot)
          throw error
        }
      }
      return Promise.all(input)
    },
    user: {
      create: async ({ data }: any) => {
        users.set(data.id, data)
        return data
      },
      findUnique: async ({ where, select }: any) => {
        const user = users.get(where.id) ?? null
        if (!user) return null
        return select ? selectFields(user, select) : user
      },
    },
    driveUsage: {
      upsert: async ({ where, create }: any) => {
        const existing = usages.get(where.userId)
        if (existing) return existing
        usages.set(where.userId, { ...create, updatedAt: now() })
        return usages.get(where.userId)
      },
      update: async ({ where, data }: any) => {
        const usage = usages.get(where.userId)
        if (!usage) throw new Error("usage not found")
        applyNumericUpdates(usage, data)
        usage.updatedAt = now()
        return usage
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const usage = usages.get(where.userId)
        if (!usage) throw new Error("usage not found")
        return usage
      },
    },
    driveItem: {
      create: async ({ data, include }: any) => {
        const item = {
          id: id("item"),
          ...data,
          storageKey: data.storageKey ?? null,
          storageDeletePending: data.storageDeletePending ?? false,
          lifecycleStatus: data.lifecycleStatus ?? "active",
          trashedAt: data.trashedAt ?? null,
          trashedBy: data.trashedBy ?? null,
          hiddenAt: data.hiddenAt ?? null,
          hiddenBy: data.hiddenBy ?? null,
          restoreParentId: data.restoreParentId ?? null,
          restorePath: data.restorePath ?? null,
          deleteRootId: data.deleteRootId ?? null,
          objectMissing: data.objectMissing ?? false,
          publicAsset: data.publicAsset ?? null,
          deletedAt: null,
          createdAt: now(),
          updatedAt: now(),
        }
        items.set(item.id, item)
        return include ? withShares(item) : item
      },
      update: async ({ where, data, include }: any) => {
        const item = items.get(where.id)
        if (!item) throw new Error("item not found")
        Object.assign(item, data, { updatedAt: now() })
        return include ? withShares(item) : item
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const item of items.values()) {
          if (matchesWhere(item, where)) {
            Object.assign(item, data, { updatedAt: now() })
            count += 1
          }
        }
        return { count }
      },
      findFirst: async ({ where, include, select, orderBy }: any) => {
        const found = orderRows([...items.values()].filter((item) => matchesWhere(item, where)), orderBy)[0]
        if (!found) return null
        if (select) return selectFields(found, select)
        return include ? withShares(found) : found
      },
      findMany: async (args: any = {}) => {
        const { where, select, include, orderBy, skip, take } = args
        const found = paginateRows(
          orderRows([...items.values()].filter((item) => matchesWhere(item, where ?? {})), orderBy),
          { skip, take },
        )
        if (select) return found.map((item) => selectFields(item, select))
        return include ? found.map(withShares) : found
      },
      findUnique: async ({ where, select }: any) => {
        const item = items.get(where.id)
        if (!item) return null
        return select ? selectFields(item, select) : item
      },
      findUniqueOrThrow: async ({ where, include, select }: any) => {
        const item = items.get(where.id)
        if (!item) throw new Error("item not found")
        if (select) return selectFields(item, select)
        return include ? withShares(item) : item
      },
      count: async ({ where }: any = {}) => [...items.values()].filter((item) => matchesWhere(item, where ?? {})).length,
    },
    driveUploadSession: {
      create: async ({ data }: any) => {
        const session = { id: data.id ?? id("session"), ...data, reservedBytes: data.reservedBytes ?? data.expectedSize, createdAt: now(), completedAt: null, failedAt: null }
        sessions.set(session.id, session)
        return session
      },
      findFirst: async ({ where, include }: any) => {
        const session = [...sessions.values()].find((item) => matchesWhere(item, where))
        if (!session) return null
        return include?.item ? { ...session, item: withShares(items.get(session.itemId)) } : session
      },
      update: async ({ where, data }: any) => {
        const session = sessions.get(where.id)
        if (!session) throw new Error("session not found")
        Object.assign(session, data)
        return session
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const session of sessions.values()) {
          if (matchesWhere(session, where)) {
            Object.assign(session, data)
            count += 1
          }
        }
        return { count }
      },
      findMany: async ({ where, select }: any = {}) => {
        const found = [...sessions.values()].filter((session) => matchesWhere(session, where ?? {}))
        return select ? found.map((session) => selectFields(session, select)) : found
      },
    },
    driveFileVersion: {
      create: async ({ data }: any) => {
        const version = {
          id: data.id ?? id("version"),
          isPinned: data.isPinned ?? false,
          deletedAt: data.deletedAt ?? null,
          deletePending: data.deletePending ?? false,
          createdAt: data.createdAt ?? now(),
          createdBy: data.createdBy ?? null,
          restoredFromVersionId: data.restoredFromVersionId ?? null,
          etag: data.etag ?? null,
          ...data,
        }
        versions.set(version.id, version)
        return version
      },
      findFirst: async ({ where, select, orderBy }: any) => {
        const version = orderRows([...versions.values()].filter((item) => matchesWhere(item, where ?? {})), orderBy)[0]
        if (!version) return null
        return select ? selectFields(version, select) : version
      },
      findMany: async (args: any = {}) => {
        const { where, select, orderBy, skip, take } = args
        const found = paginateRows(
          orderRows([...versions.values()].filter((version) => matchesWhere(version, where ?? {})), orderBy),
          { skip, take },
        )
        return select ? found.map((version) => selectFields(version, select)) : found
      },
      findUnique: async ({ where }: any) => versions.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => {
        const version = versions.get(where.id)
        if (!version) throw new Error("version not found")
        return version
      },
      update: async ({ where, data }: any) => {
        const version = versions.get(where.id)
        if (!version) throw new Error("version not found")
        Object.assign(version, data)
        return version
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const version of versions.values()) {
          if (matchesWhere(version, where)) {
            Object.assign(version, data)
            count += 1
          }
        }
        return { count }
      },
      count: async ({ where }: any = {}) => [...versions.values()].filter((version) => matchesWhere(version, where ?? {})).length,
    },
    driveShare: {
      create: async ({ data }: any) => {
        const enabled = data.enabled ?? true
        if (enabled && [...shares.values()].some((share) => share.itemId === data.itemId && share.userId === data.userId && share.enabled)) {
          throw uniqueConstraintError(["itemId", "userId"])
        }
        if ([...shares.values()].some((share) => share.shareId === data.shareId)) throw uniqueConstraintError(["shareId"])
        const { editors, ...shareData } = data
        const share = {
          id: id("share"),
          enabled,
          item: items.get(data.itemId) ?? null,
          passwordEnabled: false,
          passwordHash: null,
          passwordEncrypted: null,
          expiresAt: null,
          accessSettingsAppliedAt: null,
          disabledAt: null,
          createdAt: now(),
          accessMode: "link_read",
          ...shareData,
        }
        shares.set(share.id, share)
        for (const editor of editors?.create ?? []) {
          const entry = { id: id("share-editor"), driveShareId: share.id, email: editor.email, createdAt: now() }
          shareEditors.set(entry.id, entry)
        }
        return withShareIncludes(share, { editors: true })
      },
      findFirst: async ({ where, include }: any) => {
        const share = [...shares.values()].find((item) => matchesWhere(item, where))
        if (!share) return null
        return withShareIncludes(share, include)
      },
      findMany: async ({ where, include, orderBy, select }: any = {}) => {
        const found = orderRows([...shares.values()].filter((share) => matchesWhere(share, where ?? {})), orderBy)
        if (select) return found.map((share) => selectFields(share, select))
        return found.map((share) => withShareIncludes(share, include))
      },
      update: async ({ where, data, include }: any) => {
        const share = shares.get(where.id)
        if (!share) throw new Error("share not found")
        const { editors, ...shareData } = data
        Object.assign(share, shareData)
        for (const editor of editors?.create ?? []) {
          const entry = { id: id("share-editor"), driveShareId: share.id, email: editor.email, createdAt: now() }
          shareEditors.set(entry.id, entry)
        }
        return withShareIncludes(share, include)
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const share of shares.values()) {
          if (matchesWhere(share, where)) {
            Object.assign(share, data)
            count += 1
          }
        }
        return { count }
      },
    },
    driveShareEditor: {
      deleteMany: async ({ where }: any) => {
        let count = 0
        for (const [editorId, editor] of shareEditors) {
          if (matchesWhere(editor, where)) {
            shareEditors.delete(editorId)
            count += 1
          }
        }
        return { count }
      },
    },
    publicAsset: {
      create: async ({ data, include }: any) => {
        if ([...publicAssets.values()].some((asset) => asset.assetId === data.assetId)) throw uniqueConstraintError(["assetId"])
        const asset = {
          id: data.id ?? id("public-asset"),
          lifecycleStatus: "active",
          trashedAt: null,
          trashedBy: null,
          hiddenAt: null,
          hiddenBy: null,
          deletedAt: null,
          deletedBy: null,
          accessCount: 0n,
          responseBytes: 0n,
          lastAccessedAt: null,
          createdAt: now(),
          updatedAt: now(),
          ...data,
        }
        publicAssets.set(asset.id, asset)
        asset.user = users.get(asset.userId) ? { email: users.get(asset.userId)!.email } : null
        const item = items.get(asset.itemId)
        if (item) item.publicAsset = { assetId: asset.assetId }
        return includePublicAsset(asset, include)
      },
      findFirst: async ({ where, include }: any) => {
        const asset = [...publicAssets.values()].find((row) => matchesWhere(row, where))
        return asset ? includePublicAsset(asset, include) : null
      },
      findMany: async (args: any = {}) => {
        const { where, include, select, orderBy, skip, take } = args
        const found = paginateRows(
          orderRows([...publicAssets.values()].filter((asset) => matchesWhere(asset, where ?? {})), orderBy),
          { skip, take },
        )
        if (select) return found.map((asset) => selectFields(asset, select))
        return found.map((asset) => includePublicAsset(asset, include))
      },
      update: async ({ where, data, include }: any) => {
        const asset = publicAssets.get(where.id)
        if (!asset) throw new Error("public asset not found")
        applyNumericUpdates(asset, data)
        asset.updatedAt = now()
        const item = items.get(asset.itemId)
        if (item) item.publicAsset = { assetId: asset.assetId }
        return includePublicAsset(asset, include)
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const asset of publicAssets.values()) {
          if (matchesWhere(asset, where)) {
            applyNumericUpdates(asset, data)
            asset.updatedAt = now()
            const item = items.get(asset.itemId)
            if (item) item.publicAsset = { assetId: asset.assetId }
            count += 1
          }
        }
        return { count }
      },
      count: async ({ where }: any = {}) => [...publicAssets.values()].filter((asset) => matchesWhere(asset, where ?? {})).length,
    },
    publicAssetRevision: {
      create: async ({ data }: any) => {
        const revision = { id: data.id ?? id("public-asset-revision"), createdAt: now(), replacedAt: now(), ...data }
        publicAssetRevisions.set(revision.id, revision)
        return revision
      },
      findFirst: async ({ where }: any) => [...publicAssetRevisions.values()].find((row) => matchesWhere(row, where ?? {})) ?? null,
      findMany: async (args: any = {}) => {
        const { where, select, orderBy, skip, take } = args
        const found = paginateRows(
          orderRows([...publicAssetRevisions.values()].filter((revision) => matchesWhere(revision, where ?? {})), orderBy),
          { skip, take },
        )
        return select ? found.map((revision) => selectFields(revision, select)) : found
      },
      count: async ({ where }: any = {}) => [...publicAssetRevisions.values()].filter((revision) => matchesWhere(revision, where ?? {})).length,
    },
    publicAssetAccessLog: {
      create: async ({ data }: any) => {
        const log = { id: data.id ?? id("public-asset-access"), accessedAt: now(), ...data }
        publicAssetAccessLogs.set(log.id, log)
        return log
      },
      findMany: async (args: any = {}) => {
        const { where, select, orderBy, skip, take } = args
        const found = paginateRows(
          orderRows([...publicAssetAccessLogs.values()].filter((log) => matchesWhere(log, where ?? {})), orderBy),
          { skip, take },
        )
        return select ? found.map((log) => selectFields(log, select)) : found
      },
      count: async ({ where }: any = {}) => [...publicAssetAccessLogs.values()].filter((log) => matchesWhere(log, where ?? {})).length,
    },
  }
  return Object.assign(prisma, {
    __debug: {
      items,
      publicAssets,
      publicAssetRevisions,
      publicAssetAccessLogs,
      sessions,
      usages,
    },
  })
}

function matchesWhere(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === "AND") return value.every((entry: any) => matchesWhere(row, entry))
    if (key === "OR") return value.some((entry: any) => matchesWhere(row, entry))
    if (value && typeof value === "object" && "is" in value) return matchesWhere(row[key], value.is)
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key])
    if (value && typeof value === "object" && "not" in value) return row[key] !== value.not
    if (value && typeof value === "object" && "gt" in value) return row[key] > value.gt
    if (value && typeof value === "object" && "gte" in value) return row[key] >= value.gte
    if (value && typeof value === "object" && "lt" in value) return row[key] < value.lt
    if (value && typeof value === "object" && "lte" in value) return row[key] <= value.lte
    if (value && typeof value === "object" && "contains" in value) return String(row[key]).toLowerCase().includes(String(value.contains).toLowerCase())
    if (value && typeof value === "object" && !(value instanceof Date)) return matchesWhere(row[key], value)
    return row[key] === value
  })
}

function selectFields(row: any, select: any) {
  const result: any = {}
  for (const key of Object.keys(select)) {
    if (select[key]) result[key] = row[key]
  }
  return result
}

function applyNumericUpdates(row: any, data: any): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (value && typeof value === "object" && "increment" in value) {
      row[key] += (value as { readonly increment: bigint }).increment
    } else if (value && typeof value === "object" && "decrement" in value) {
      row[key] -= (value as { readonly decrement: bigint }).decrement
    } else {
      row[key] = value
    }
  }
}

function cloneMap<T>(value: Map<string, T>): Map<string, T> {
  return new Map([...value.entries()].map(([key, row]) => [key, typeof row === "object" && row !== null ? { ...row } as T : row]))
}

function restoreMap<T>(target: Map<string, T>, snapshot: Map<string, T>): void {
  target.clear()
  for (const [key, value] of snapshot.entries()) target.set(key, value)
}

function orderRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy]
  return [...rows].sort((left, right) => {
    for (const entry of entries) {
      const [key, direction] = Object.entries(entry)[0] as [string, "asc" | "desc"]
      const leftValue = comparableValue(left[key])
      const rightValue = comparableValue(right[key])
      if (leftValue === rightValue) continue
      const comparison = leftValue > rightValue ? 1 : -1
      return direction === "desc" ? -comparison : comparison
    }
    return 0
  })
}

function comparableValue(value: unknown): string | number | bigint | boolean {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return value
  return ""
}

function paginateRows(rows: any[], options: { readonly skip?: number; readonly take?: number }): any[] {
  const start = options.skip ?? 0
  const end = options.take === undefined ? undefined : start + options.take
  return rows.slice(start, end)
}

function uniqueConstraintError(target: readonly string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  })
}
