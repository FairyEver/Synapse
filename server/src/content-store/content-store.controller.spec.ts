import { BadRequestException } from "@nestjs/common"
import { type INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { Readable, Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { contentStoreTextMaxBytes } from "./content-store.constants"
import { ContentStoreAdminController, ContentStoreUserController } from "./content-store.controller"
import { ContentStoreService } from "./content-store.service"

type MockFn = ReturnType<typeof vi.fn>
type SupertestResponse = {
  readonly body: unknown
  readonly text: string
  readonly headers: Record<string, string | undefined>
}
type SupertestRequest = {
  readonly send: (body: unknown) => SupertestRequest
  readonly expect: (status: number) => Promise<SupertestResponse>
}
const request = require("supertest") as (server: unknown) => {
  readonly get: (path: string) => SupertestRequest
  readonly post: (path: string) => SupertestRequest
}

describe("ContentStoreUserController", () => {
  it("passes authenticated user identity and parsed filters to list routes", async () => {
    const service = {
      listStore: vi.fn().mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 10 }),
      listMine: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")

    await controller.listStore({ page: "2", pageSize: "10", sortBy: "updatedAt", type: "skill", query: "sync" }, request)
    await controller.listMine({ type: "prompt" }, request)

    expect(service.listStore).toHaveBeenCalledWith("user-1", {
      page: 2,
      pageSize: 10,
      sortBy: "updatedAt",
      sortOrder: "desc",
      type: "skill",
      query: "sync",
    })
    expect(service.listMine).toHaveBeenCalledWith("user-1", {
      page: 1,
      pageSize: 20,
      sortBy: "updatedAt",
      sortOrder: "desc",
      type: "prompt",
      query: undefined,
    })
  })

  it("parses draft payloads and forwards draft mutations", async () => {
    const service = {
      createDraft: vi.fn().mockResolvedValue({ id: "draft-1" }),
      getDraft: vi.fn().mockResolvedValue({ id: "draft-1", revision: 3 }),
      saveDraft: vi.fn().mockResolvedValue({ id: "draft-1", revision: 3 }),
      publishDraft: vi.fn().mockResolvedValue({ id: "version-1" }),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")
    const file = { path: "SKILL.md", contentBase64: Buffer.from("# Skill").toString("base64") }

    await controller.createDraft({ type: "skill", title: "  Skill  ", localSourceFingerprint: " local-1 ", files: [file] }, request)
    await controller.getDraft("item-1", request)
    await controller.saveDraft("item-1", { type: "rule", baseRevision: 2, title: "Rule", body: "body" }, request)
    await controller.publishDraft("item-1", { baseRevision: 3 }, request)

    expect(service.createDraft).toHaveBeenCalledWith("user-1", {
      type: "skill",
      title: "Skill",
      description: null,
      localSourceFingerprint: "local-1",
      body: null,
      files: [file],
    })
    expect(service.getDraft).toHaveBeenCalledWith("user-1", "item-1")
    expect(service.saveDraft).toHaveBeenCalledWith("user-1", "item-1", 2, {
      title: "Rule",
      description: null,
      body: "body",
      files: undefined,
    })
    expect(service.publishDraft).toHaveBeenCalledWith("user-1", "item-1", 3)
  })

  it("allows empty non-main Skill files in draft payloads", async () => {
    const service = {
      createDraft: vi.fn().mockResolvedValue({ id: "draft-1" }),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")
    const files = [
      { path: "SKILL.md", contentBase64: Buffer.from("# Skill").toString("base64") },
      { path: "send_daily_worklog_diagnostics.log", contentBase64: "" },
    ]

    await controller.createDraft({ type: "skill", title: "Skill", files }, request)

    expect(service.createDraft).toHaveBeenCalledWith("user-1", expect.objectContaining({ files }))
  })

  it("forwards item actions with authenticated user identity", async () => {
    const service = {
      getDetail: vi.fn().mockResolvedValue({ id: "item-1" }),
      copyToMine: vi.fn().mockResolvedValue({ id: "copy-1" }),
      deletePrivateItem: vi.fn().mockResolvedValue({ ok: true }),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")

    await controller.getDetail("item-1", request)
    await controller.copyToMine("item-1", request)
    await controller.deletePrivateItem("item-1", request)

    expect(service.getDetail).toHaveBeenCalledWith("user-1", "item-1")
    expect(service.copyToMine).toHaveBeenCalledWith("user-1", "item-1")
    expect(service.deletePrivateItem).toHaveBeenCalledWith("user-1", "item-1")
  })

  it("parses visibility payloads", async () => {
    const service = { setVisibility: vi.fn().mockResolvedValue({ id: "item-1" }) }
    const controller = new ContentStoreUserController(service as never)

    await controller.setVisibility("item-1", { visibility: "public" }, userRequest("user-1"))

    expect(service.setVisibility).toHaveBeenCalledWith("user-1", "item-1", "public")
  })

  it("rejects invalid input before calling the service", async () => {
    const service = {
      createDraft: vi.fn(),
      setVisibility: vi.fn(),
      recordInstall: vi.fn(),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")

    expect(() => controller.createDraft({ type: "skill", title: "" }, request)).toThrow(BadRequestException)
    expect(() => controller.createDraft({ type: "skill", title: "Skill", files: [{ path: "SKILL.md", contentBase64: "not-base64" }] }, request)).toThrow(BadRequestException)
    expect(() => controller.setVisibility("item-1", { visibility: "team" }, request)).toThrow(BadRequestException)
    expect(() => controller.recordInstall("session-1", { clientInstanceId: "" }, request)).toThrow(BadRequestException)

    expect(service.createDraft).not.toHaveBeenCalled()
    expect(service.setVisibility).not.toHaveBeenCalled()
    expect(service.recordInstall).not.toHaveBeenCalled()
  })

  it("rejects oversized rule and prompt bodies before calling the service", () => {
    const service = {
      createDraft: vi.fn(),
      saveDraft: vi.fn(),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")
    const oversizedBody = "a".repeat(contentStoreTextMaxBytes + 1)

    expect(() => controller.createDraft({
      type: "rule",
      title: "Rule",
      body: oversizedBody,
    }, request)).toThrow(BadRequestException)
    expect(() => controller.saveDraft("item-1", {
      type: "prompt",
      baseRevision: 1,
      title: "Prompt",
      body: oversizedBody,
    }, request)).toThrow(BadRequestException)

    expect(service.createDraft).not.toHaveBeenCalled()
    expect(service.saveDraft).not.toHaveBeenCalled()
  })

  it("uses a default install deep link and completes install sessions", async () => {
    const service = {
      createInstallSession: vi.fn().mockResolvedValue({ id: "session-1" }),
      resolveInstallSession: vi.fn().mockResolvedValue({ id: "session-1" }),
      recordInstall: vi.fn().mockResolvedValue({ ok: true }),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")

    await controller.createInstallSession("item-1", {}, request)
    await controller.createInstallSession("item-2", { deepLinkBase: "synapse://content-install/" }, request)
    await controller.resolveInstallSession("session-1", request)
    await controller.recordInstall("session-1", { clientInstanceId: "desktop-1" }, request)

    expect(service.createInstallSession).toHaveBeenNthCalledWith(1, "user-1", "item-1", "synapse://content-install")
    expect(service.createInstallSession).toHaveBeenNthCalledWith(2, "user-1", "item-2", "synapse://content-install")
    expect(service.resolveInstallSession).toHaveBeenCalledWith("user-1", "session-1")
    expect(service.recordInstall).toHaveBeenCalledWith("user-1", "session-1", "desktop-1")
  })

  it("rejects non-Synapse install deep links", async () => {
    const service = {
      createInstallSession: vi.fn(),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")

    for (const deepLinkBase of [
      "https://evil.example/install",
      "javascript:alert(1)",
      "data:text/html,install",
      "synapse://custom-install",
      "synapse://content-install?next=https://evil.example",
    ]) {
      expect(() => controller.createInstallSession("item-1", { deepLinkBase }, request)).toThrow(BadRequestException)
    }

    expect(service.createInstallSession).not.toHaveBeenCalled()
  })

  it("destroys the response without rethrowing when package streaming fails after writing", async () => {
    const error = new Error("stream failed")
    const service = {
      openInstallPackage: vi.fn().mockResolvedValue({
        stream: Readable.from((async function* () {
          yield Buffer.from("partial")
          throw error
        })()),
        contentType: "application/zip",
        packageSha256: "a".repeat(64),
        type: "skill",
        title: "Skill",
      }),
    }
    const controller = new ContentStoreUserController(service as never)
    const response = downloadResponse()
    const destroy = vi.spyOn(response, "destroy")

    await expect(controller.downloadInstallPackage("session-1", userRequest("user-1"), response as never)).resolves.toBeUndefined()

    expect(response.headersSent).toBe(true)
    expect(destroy).toHaveBeenCalledWith(error)
  })

  it("rethrows package streaming failures before headers are sent", async () => {
    const error = new Error("stream failed")
    const service = {
      openInstallPackage: vi.fn().mockResolvedValue({
        stream: Readable.from((async function* () {
          throw error
        })()),
        contentType: "application/zip",
        packageSha256: "a".repeat(64),
        type: "skill",
        title: "Skill",
      }),
    }
    const controller = new ContentStoreUserController(service as never)
    const response = downloadResponse()

    await expect(controller.downloadInstallPackage("session-1", userRequest("user-1"), response as never)).rejects.toBe(error)

    expect(response.headersSent).toBe(false)
  })
})

describe("ContentStoreAdminController", () => {
  it("forwards admin list and detail routes", async () => {
    const service = {
      listAdmin: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
      getAdminDetail: vi.fn().mockResolvedValue({ id: "item-1" }),
    }
    const controller = new ContentStoreAdminController(service as never)

    await controller.listAdmin({ sortBy: "installCount", type: "rule", visibility: "public", moderationStatus: "normal", query: "hook" })
    await controller.getAdminDetail("item-1")

    expect(service.listAdmin).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sortBy: "installCount",
      sortOrder: "desc",
      type: "rule",
      visibility: "public",
      moderationStatus: "normal",
      query: "hook",
    })
    expect(service.getAdminDetail).toHaveBeenCalledWith("item-1")
  })

  it("passes admin email and ip into feature and remove actions", async () => {
    const service = {
      setFeaturedAsAdmin: vi.fn().mockResolvedValue({ id: "item-1" }),
      setRemovedAsAdmin: vi.fn().mockResolvedValue({ id: "item-1" }),
    }
    const controller = new ContentStoreAdminController(service as never)
    const request = adminRequest("admin@example.com", "127.0.0.1")

    await controller.setFeatured("item-1", { value: true }, request)
    await controller.setRemoved("item-1", { value: false }, request)

    expect(service.setFeaturedAsAdmin).toHaveBeenCalledWith("admin@example.com", "127.0.0.1", "item-1", true)
    expect(service.setRemovedAsAdmin).toHaveBeenCalledWith("admin@example.com", "127.0.0.1", "item-1", false)
  })

  it("rejects invalid admin moderation payloads", async () => {
    const service = { setFeaturedAsAdmin: vi.fn() }
    const controller = new ContentStoreAdminController(service as never)

    expect(() => controller.setFeatured("item-1", { value: "yes" }, adminRequest("admin@example.com"))).toThrow(BadRequestException)

    expect(service.setFeaturedAsAdmin).not.toHaveBeenCalled()
  })
})

describe("ContentStore HTTP routes", () => {
  it("mounts user list routes and passes authenticated identity", async () => {
    const service = createHttpServiceMock()
    service.listStore.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
    const app = await createUserHttpApp(service)
    try {
      await request(app.getHttpServer())
        .get("/api/content-store/items?type=skill&sortBy=installCount&query=sync")
        .expect(200)

      expect(service.listStore).toHaveBeenCalledWith("user-http", expect.objectContaining({
        type: "skill",
        sortBy: "installCount",
        query: "sync",
      }))
    } finally {
      await app.close()
    }
  })

  it("rejects invalid user request bodies before calling the service", async () => {
    const service = createHttpServiceMock()
    const app = await createUserHttpApp(service)
    try {
      const response = await request(app.getHttpServer())
        .post("/api/content-store/drafts")
        .send({ type: "skill", title: "Skill", files: [{ path: "SKILL.md", contentBase64: "not-base64" }] })
        .expect(400)
      await request(app.getHttpServer())
        .post("/api/content-store/items/item-1/install-sessions")
        .send({ deepLinkBase: "https://evil.example/install" })
        .expect(400)

      expect(response.text).toContain("草稿请求无效")
      expect(service.createDraft).not.toHaveBeenCalled()
      expect(service.createInstallSession).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it("mounts install session routes", async () => {
    const service = createHttpServiceMock()
    service.createInstallSession.mockResolvedValue({ id: "session-1" })
    service.recordInstall.mockResolvedValue({ ok: true })
    const app = await createUserHttpApp(service)
    try {
      await request(app.getHttpServer())
        .post("/api/content-store/items/item-1/install-sessions")
        .send({ deepLinkBase: "synapse://content-install" })
        .expect(201)
      await request(app.getHttpServer())
        .post("/api/content-store/install-sessions/session-1/complete")
        .send({ clientInstanceId: "desktop-1" })
        .expect(201)

      expect(service.createInstallSession).toHaveBeenCalledWith("user-http", "item-1", "synapse://content-install")
      expect(service.recordInstall).toHaveBeenCalledWith("user-http", "session-1", "desktop-1")
    } finally {
      await app.close()
    }
  })

  it("streams install packages with download headers without completing the session", async () => {
    const service = createHttpServiceMock()
    service.openInstallPackage.mockResolvedValue({
      stream: Readable.from([Buffer.from("package")]),
      size: 7n,
      contentType: "text/plain",
      packageSha256: "a".repeat(64),
      type: "skill",
      title: "Skill",
    })
    const app = await createUserHttpApp(service)
    try {
      const response = await request(app.getHttpServer())
        .get("/api/content-store/install-sessions/session-1/package")
        .expect(200)

      expect(response.text).toBe("package")
      expect(response.headers["content-type"]).toBe("application/zip")
      expect(response.headers["content-length"]).toBe("7")
      expect(response.headers["content-disposition"]).toBe("attachment; filename=\"session-1.zip\"")
      expect(service.openInstallPackage).toHaveBeenCalledWith("user-http", "session-1")
      expect(service.recordInstall).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it("mounts the current draft route", async () => {
    const service = createHttpServiceMock()
    service.getDraft.mockResolvedValue({ id: "draft-1", revision: 2 })
    const app = await createUserHttpApp(service)
    try {
      await request(app.getHttpServer())
        .get("/api/content-store/items/item-1/draft")
        .expect(200)

      expect(service.getDraft).toHaveBeenCalledWith("user-http", "item-1")
    } finally {
      await app.close()
    }
  })

  it("mounts admin moderation routes and passes admin identity", async () => {
    const service = createHttpServiceMock()
    service.setRemovedAsAdmin.mockResolvedValue({ id: "item-1" })
    const app = await createAdminHttpApp(service)
    try {
      await request(app.getHttpServer())
        .post("/api/admin/content-store/items/item-1/removed")
        .send({ value: true })
        .expect(201)

      expect(service.setRemovedAsAdmin).toHaveBeenCalledWith("admin@example.com", expect.any(String), "item-1", true)
    } finally {
      await app.close()
    }
  })
})

function userRequest(userId: string) {
  return { user: { id: userId }, ip: "127.0.0.1" } as never
}

function adminRequest(email: string, ip = "system") {
  return { admin: { id: "admin-1", email }, ip } as never
}

function downloadResponse() {
  const response = new Writable({
    write(_chunk, _encoding, callback) {
      response.headersSent = true
      callback()
    },
  }) as Writable & {
    headersSent: boolean
    setHeader: MockFn
  }
  response.headersSent = false
  response.setHeader = vi.fn()
  return response
}

function createHttpServiceMock() {
  return {
    listStore: vi.fn(),
    createDraft: vi.fn(),
    getDraft: vi.fn(),
    createInstallSession: vi.fn(),
    openInstallPackage: vi.fn(),
    recordInstall: vi.fn(),
    setRemovedAsAdmin: vi.fn(),
  }
}

async function createUserHttpApp(service: ReturnType<typeof createHttpServiceMock>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ContentStoreUserController],
    providers: [{ provide: ContentStoreService, useValue: service }],
  })
    .overrideGuard(UserAuthGuard)
    .useValue({ canActivate: vi.fn((context) => {
      context.switchToHttp().getRequest().user = { id: "user-http" }
      return true
    }) })
    .compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

async function createAdminHttpApp(service: ReturnType<typeof createHttpServiceMock>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ContentStoreAdminController],
    providers: [{ provide: ContentStoreService, useValue: service }],
  })
    .overrideGuard(AdminAuthGuard)
    .useValue({ canActivate: vi.fn((context) => {
      context.switchToHttp().getRequest().admin = { id: "admin-1", email: "admin@example.com" }
      return true
    }) })
    .compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}
