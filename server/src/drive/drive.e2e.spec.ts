import { type INestApplication, UnauthorizedException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { Prisma } from "@prisma/client"
import cookieParser from "cookie-parser"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import { DriveLocalStorageController, DrivePublicController, DriveUserController } from "./drive.controller"
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
  const originalEnv = { ...process.env }

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
    process.env = { ...originalEnv }
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
  const now = () => new Date("2026-06-07T12:00:00.000Z")
  const id = (prefix: string) => `${prefix}-${nextId++}`
  const withShares = (item: any) => ({
    ...item,
    user: users.get(item.userId) ? { email: users.get(item.userId)!.email } : null,
    shares: [...shares.values()].filter((share) => share.itemId === item.id && share.enabled).map((share) => ({ enabled: share.enabled })),
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
        if (data.reservedBytes?.increment) usage.reservedBytes += data.reservedBytes.increment
        if (data.reservedBytes?.decrement) usage.reservedBytes -= data.reservedBytes.decrement
        if (data.usedBytes?.increment) usage.usedBytes += data.usedBytes.increment
        if (data.usedBytes?.decrement) usage.usedBytes -= data.usedBytes.decrement
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
      findUniqueOrThrow: async ({ where }: any) => {
        const item = items.get(where.id)
        if (!item) throw new Error("item not found")
        return item
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
  }
  return prisma
}

function matchesWhere(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === "AND") return value.every((entry: any) => matchesWhere(row, entry))
    if (key === "OR") return value.some((entry: any) => matchesWhere(row, entry))
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key])
    if (value && typeof value === "object" && "not" in value) return row[key] !== value.not
    if (value && typeof value === "object" && "gt" in value) return row[key] > value.gt
    if (value && typeof value === "object" && "gte" in value) return row[key] >= value.gte
    if (value && typeof value === "object" && "lt" in value) return row[key] < value.lt
    if (value && typeof value === "object" && "lte" in value) return row[key] <= value.lte
    if (value && typeof value === "object" && "contains" in value) return String(row[key]).toLowerCase().includes(String(value.contains).toLowerCase())
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
