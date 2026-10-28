import { Logger, NotFoundException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import httpRequest from "supertest"
import { UserAuthService } from "../auth/user-auth.service"
import { DriveService } from "./drive.service"
import { randomUUID } from "node:crypto"
import { Readable, Writable } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DriveBrowsingHistoryService, isDriveHistoryNavigation } from "./drive-browsing-history.service"
import { DrivePublicController, DriveUserController } from "./drive.controller"

const owner = { handle: "writer", nickname: "设计师", email: "private@example.com" }
const item = { id: "doc", userId: "owner", name: "ＡＬＰＨＡ Notes.md", type: "file", mimeType: "text/markdown" }

type Row = Record<string, any>
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (value as Row[]).every((entry) => matches(row, entry))
    if (key === "OR") return (value as Row[]).some((entry) => matches(row, entry))
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("contains" in value) return row[key].includes(value.contains.replace(/\\([%_\\])/gu, "$1"))
      if ("lt" in value) return row[key] < value.lt
    }
    return row[key] instanceof Date ? row[key].getTime() === (value as Date).getTime() : row[key] === value
  })
}
function fixture() {
  const rows: Row[] = []
  const prisma = {
    user: { findUnique: vi.fn(async () => owner) },
    driveBrowsingHistory: {
      createMany: vi.fn(async ({ data }: { data: Row }) => {
        if (!rows.some((row) => row.viewerId === data.viewerId && row.visitId === data.visitId)) {
          rows.push({ id: `row-${String(rows.length).padStart(4, "0")}`, cleared: false, visitedAt: new Date("2026-10-28T00:00:00Z"), ...data })
        }
        return { count: 1 }
      }),
      findMany: vi.fn(async ({ where, take }: { where: Row; take: number }) => rows.filter((row) => matches(row, where))
        .sort((a, b) => b.visitedAt - a.visitedAt || b.id.localeCompare(a.id)).slice(0, take)),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const affected = rows.filter((row) => matches(row, where))
        for (const row of affected) Object.assign(row, data)
        return { count: affected.length }
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        for (let index = rows.length - 1; index >= 0; index--) if (matches(rows[index]!, where)) rows.splice(index, 1)
        return { count: 1 }
      }),
    },
    driveSite: { findUnique: vi.fn() },
    publicAsset: { findUnique: vi.fn() },
  }
  const drive = { resolveShareAnnotationAccess: vi.fn(async () => ({ item })) }
  const service = new DriveBrowsingHistoryService(prisma as never, drive as never)
  const visit = (viewer = "reader", visitId = randomUUID()) => service.recordShare(viewer, visitId, { shareId: "public", cookie: "access" })
  return { rows, prisma, drive, service, visit }
}

afterEach(() => vi.unstubAllEnvs())
describe("Drive browsing history", () => {
  it("keeps every open but makes a retried visit ID idempotent within its viewer", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { visit, rows, drive } = fixture()
    const id = randomUUID()
    await visit("reader", id)
    await visit("reader", id)
    await visit()
    await visit("another", id)
    expect(rows.map((row) => row.viewerId)).toEqual(["reader", "reader", "another"])
    expect(drive.resolveShareAnnotationAccess).toHaveBeenCalledWith({ shareId: "public", cookie: "access", actorUserId: "reader" })
  })

  it("does not store inaccessible shares", async () => {
    const { drive, visit, rows } = fixture()
    drive.resolveShareAnnotationAccess.mockRejectedValueOnce(new NotFoundException())
    await expect(visit()).rejects.toBeInstanceOf(NotFoundException)
    expect(rows).toEqual([])
  })

  it("searches title, canonical URL, public handle, nickname and email using normalized AND terms, keeping private fields out of DTO", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { visit, service, rows } = fixture()
    await visit()
    for (const query of ["ＡＬＰＨＡ　writer", "notes PUBLIC", "设计师", "PRIVATE@example.com", "synapse.test"]) {
      const page = await service.list("reader", { query })
      expect(page.items).toHaveLength(1)
      expect(page.items[0]).toEqual({ id: rows[0]!.id, title: item.name, author: "writer", kind: "document", url: "https://synapse.test/share/public", visitedAt: expect.any(String) })
    }
    expect((await service.list("reader", { query: "alpha missing" })).items).toEqual([])
    expect((await service.list("reader", { kind: "web" })).items).toEqual([])
    expect((await service.list("another")).items).toEqual([])
    expect(JSON.stringify(await service.list("reader"))).not.toContain("private@example.com")
  })

  it("finds canonical visits from full reader/render/download links while discarding URL secrets from search", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { visit, service, prisma, rows } = fixture()
    await visit(); await visit()
    await service.recordShare("reader", randomUUID(), { shareId: "public", itemId: "doc" })
    for (const base of ["https://synapse.test/share/public", "https://synapse.test/share/public/items/doc"]) {
      for (const suffix of ["", "/", "/reader", "/render/", "/download"]) {
        const page = await service.list("reader", { query: `${base}${suffix}?password=private-password&utm_source=tracking-secret#private-fragment` })
        expect(page.items.length).toBeGreaterThan(0)
        expect(JSON.stringify(prisma.driveBrowsingHistory.findMany.mock.lastCall?.[0])).not.toContain("private-password")
        expect(JSON.stringify(prisma.driveBrowsingHistory.findMany.mock.lastCall?.[0])).not.toContain("tracking-secret")
      }
    }
    const first = await service.list("reader", { query: "https://synapse.test/share/public/reader?password=private-password", limit: 1 })
    await expect(service.list("reader", { query: "https://synapse.test/share/public/download#private-fragment", limit: 1, cursor: first.nextCursor! })).resolves.toMatchObject({ items: [expect.anything()] })
    expect(JSON.stringify(rows)).not.toMatch(/private-password|tracking-secret|private-fragment/u)
    for (const query of ["https://unknown.test/share/public/reader", "https://synapse.test/unknown/public/reader", "https://synapse.test/share/public/unrecognized"]) {
      expect((await service.list("reader", { query })).items).toEqual([])
    }
  })

  it("normalizes complete Site and public-file links without stripping Site reader path segments", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { prisma, service, rows } = fixture()
    prisma.driveSite.findUnique.mockResolvedValue({ name: "Site", user: owner })
    prisma.publicAsset.findUnique.mockResolvedValue({ name: "File.pdf", mimeType: "application/pdf", user: owner })
    await service.recordSite("reader", randomUUID(), "site", "index.html")
    await service.recordSite("reader", randomUUID(), "site", "guide/reader")
    await service.recordPublicAsset("reader", randomUUID(), "asset")
    for (const path of ["/sites/site/index.html", "/sites/site/guide/reader", "/files/asset"]) {
      const page = await service.list("reader", { query: `https://synapse.test${path}?ref=public-ref#section` })
      expect(page.items.map((row) => row.url)).toEqual([`https://synapse.test${path}`])
      expect(JSON.stringify(prisma.driveBrowsingHistory.findMany.mock.lastCall?.[0])).not.toContain("public-ref")
    }
    expect(JSON.stringify(rows)).not.toContain("public-ref")
    for (const query of ["https://synapse.test/unknown/asset?ref=public-ref", "https://synapse.test/files/asset/unknown?ref=public-ref", "https://external.test/sites/site/index.html?ref=public-ref"]) {
      expect((await service.list("reader", { query })).items).toEqual([])
    }
  })

  it("keeps folders distinct from webpages even when their name ends with html", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { drive, visit, service } = fixture()
    drive.resolveShareAnnotationAccess.mockResolvedValueOnce({ item: { ...item, name: "collection.html", type: "folder", mimeType: null } } as never)
    await visit()
    expect((await service.list("reader")).items[0]?.kind).toBe("folder")
  })

  it("uses stable descending time/id boundaries and binds cursors to viewer and filters", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { visit, service } = fixture()
    await visit(); await visit(); await visit()
    const first = await service.list("reader", { limit: 2 })
    expect(first.items.map((row) => row.id)).toEqual(["row-0002", "row-0001"])
    const next = await service.list("reader", { limit: 2, cursor: first.nextCursor! })
    expect(next.items.map((row) => row.id)).toEqual(["row-0000"])
    expect(next.nextCursor).toBeNull()
    await expect(service.list("another", { cursor: first.nextCursor! })).rejects.toThrow()
    await expect(service.list("reader", { query: "alpha", cursor: first.nextCursor! })).rejects.toThrow()
    await service.clear("reader")
    expect((await service.list("reader", { cursor: first.nextCursor! })).items).toEqual([])
  })

  it("scrubs cleared snapshots and prevents late retries from resurrecting a cleared visit", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { visit, service, rows } = fixture()
    const visitId = randomUUID()
    await visit("reader", visitId)
    await service.clear("reader")
    await visit("reader", visitId)
    expect((await service.list("reader")).items).toEqual([])
    expect(rows[0]).toMatchObject({ viewerId: "reader", visitId, cleared: true, title: "", path: "", authorHandle: "", searchIndex: "", kind: "other" })
    expect(rows[0]!.visitedAt.toISOString()).not.toBe("2026-10-28T00:00:00.000Z")
    await visit()
    expect((await service.list("reader")).items).toHaveLength(1)
  })

  it("clears only the authenticated viewer and bounds every page", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { visit, service, prisma } = fixture()
    await visit(); await visit("another")
    await service.clear("reader")
    expect((await service.list("reader")).items).toEqual([])
    expect((await service.list("another")).items).toHaveLength(1)
    await service.list("another", { limit: 1000 })
    expect(prisma.driveBrowsingHistory.findMany.mock.lastCall?.[0].take).toBe(101)
    await service.list("another")
    expect(prisma.driveBrowsingHistory.findMany.mock.lastCall?.[0].take).toBe(51)
  })

  it("returns a retryable storage error without logging private identity", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { prisma, visit } = fixture()
    const log = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    prisma.driveBrowsingHistory.createMany.mockRejectedValueOnce(new Error("private@example.com secret"))
    await expect(visit()).rejects.toMatchObject({ status: 503 })
    expect(log).toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain("private@example.com")
    log.mockRestore()
  })
})

describe("browser history actor and navigation boundary", () => {
  function controllerFixture() {
    const auth = { verifyWebSession: vi.fn(async () => ({ userId: "cookie-user" })), verifyAccessToken: vi.fn() }
    const history = { recordShare: vi.fn(async () => undefined) }
    const controller = new DrivePublicController({} as never, {} as never, undefined, auth as never, undefined, undefined, undefined, undefined, undefined, undefined, history as never)
    const request = { headers: { origin: "https://synapse.test", "sec-fetch-site": "same-origin", authorization: "Bearer desktop", cookie: "synapse_user_session=browser" }, method: "POST" }
    return { auth, history, controller, request }
  }
  it("uses the browser session even when a different bearer is present", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { controller, history, auth, request } = controllerFixture()
    const visitId = randomUUID()
    expect(await controller.recordShareVisit("share", "child", { visitId }, request as never)).toEqual({ ok: true })
    expect(history.recordShare).toHaveBeenCalledWith("cookie-user", visitId, { shareId: "share", itemId: "child", cookie: undefined })
    expect(auth.verifyAccessToken).not.toHaveBeenCalled()
  })
  it("accepts anonymous visits without storing and refuses cross-origin events", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { controller, history, request } = controllerFixture()
    await controller.recordShareVisit("share", undefined, { visitId: randomUUID() }, { ...request, headers: { origin: "https://synapse.test" } } as never)
    expect(history.recordShare).not.toHaveBeenCalled()
    await expect(controller.recordShareVisit("share", undefined, { visitId: randomUUID() }, { ...request, headers: { ...request.headers, origin: "https://attacker.test" } } as never)).rejects.toMatchObject({ status: 403 })
  })
  it("rejects caller metadata and invalid event IDs", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { controller, request } = controllerFixture()
    for (const body of [{ visitId: "bad" }, { visitId: randomUUID(), title: "fake", author: "fake" }]) {
      await expect(controller.recordShareVisit("share", undefined, body, request as never)).rejects.toMatchObject({ status: 400 })
    }
  })
  it("admits GET document navigations only, excluding paged/background, iframe, resource, HEAD and MCP traffic", () => {
    const navigation = { method: "GET", headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }, query: {} }
    expect(isDriveHistoryNavigation(navigation as never)).toBe(true)
    for (const request of [
      { ...navigation, method: "HEAD" }, { ...navigation, query: { childrenOffset: "100" } },
      { ...navigation, headers: {} }, { ...navigation, headers: { ...navigation.headers, "sec-fetch-dest": "iframe" } },
      { ...navigation, headers: { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } },
    ]) expect(isDriveHistoryNavigation(request as never)).toBe(false)
  })
})


describe("history HTTP input and successful navigation capture", () => {
  it("validates scalar bounded query fields and only forwards the authenticated viewer", () => {
    const history = { list: vi.fn(), clear: vi.fn() }
    const controller = new DriveUserController({} as never, undefined, undefined, undefined, undefined, undefined, undefined, history as never)
    const request = { user: { id: "current" } } as never
    controller.listBrowsingHistory({ query: "notes", limit: "100", kind: "document" }, request)
    expect(history.list).toHaveBeenCalledWith("current", { query: "notes", limit: 100, kind: "document" })
    expect(() => controller.listBrowsingHistory({ query: "x".repeat(500) }, request)).not.toThrow()
    controller.clearBrowsingHistory(request)
    expect(history.clear).toHaveBeenCalledWith("current")
    for (const query of [{ limit: ["5"] }, { limit: "0" }, { limit: "1.5" }, { query: ["x"] }, { kind: "unknown" }, { cursor: "x".repeat(1025) }, { query: "x".repeat(501) }]) {
      expect(() => controller.listBrowsingHistory(query, request)).toThrow()
    }
  })

  function navigationFixture() {
    const history = { recordShare: vi.fn(async () => undefined), recordSite: vi.fn(async () => undefined), recordPublicAsset: vi.fn(async () => undefined) }
    const auth = { verifyWebSession: vi.fn(async () => ({ userId: "browser" })) }
    const drive = { resolveShareRenderAccess: vi.fn(async () => ({ status: "ok", value: { stream: Readable.from(["<p>ready</p>"]), contentType: "text/html" } })) }
    const sites = { resolvePublicSite: vi.fn(async () => ({ status: "ok", site: { accessMode: "public" }, asset: { storageKey: "site-key", relativePath: "index.html", contentType: "text/html" } })) }
    const assets = { resolvePublicAsset: vi.fn(async () => ({ status: "not_modified", publicAssetId: "internal", userId: "owner", etag: "etag" })), recordAccessSafely: vi.fn() }
    const storage = { getObjectStream: vi.fn(async () => ({ stream: Readable.from(["<p>site</p>"]) })) }
    const controller = new DrivePublicController(drive as never, storage as never, assets as never, auth as never, undefined, sites as never, undefined, undefined, undefined, undefined, history as never)
    const request = { method: "GET", path: "/share/public/render", query: {}, headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", cookie: "synapse_user_session=session" } }
    const response = Object.assign(new Writable({ write(_chunk, _encoding, callback) { callback() } }), {
      setHeader: vi.fn(), cookie: vi.fn(), redirect: vi.fn(), status: vi.fn(), type: vi.fn(), send: vi.fn(),
    })
    response.status.mockReturnValue(response); response.type.mockReturnValue(response); response.send.mockReturnValue(response)
    return { history, auth, drive, sites, assets, controller, request, response }
  }

  it("validates restored Site access and uses the resolved path, excluding password failures", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    for (const status of ["ok", "password_required", "not_found"]) {
      const { controller, history, sites, request } = navigationFixture()
      request.method = "POST"
      Object.assign(request.headers, { origin: "https://synapse.test" })
      if (status !== "ok") sites.resolvePublicSite.mockResolvedValueOnce({ status } as never)
      const visitId = randomUUID()
      const result = controller.recordSiteVisit("site", { visitId, relativePath: "" }, request as never)
      if (status === "ok") {
        await expect(result).resolves.toEqual({ ok: true })
        expect(history.recordSite).toHaveBeenCalledWith("browser", visitId, "site", "index.html")
      } else {
        await expect(result).rejects.toMatchObject({ status: 404 })
        expect(history.recordSite).not.toHaveBeenCalled()
      }
    }
  })

  it("captures one independent successful raw render navigation using the cookie viewer", async () => {
    const { controller, history, request, response } = navigationFixture()
    await controller.renderShare("public", request as never, response as never)
    expect(history.recordShare).toHaveBeenCalledExactlyOnceWith("browser", expect.any(String), { shareId: "public", cookie: undefined })
  })

  it("never captures password pages, redirects, missing content or iframe renders", async () => {
    for (const status of ["password_required", "not_found", "iframe", "password_redirect"]) {
      const { controller, history, drive, request, response } = navigationFixture()
      if (status === "password_required" || status === "not_found") drive.resolveShareRenderAccess.mockResolvedValueOnce({ status } as never)
      if (status === "iframe") request.headers["sec-fetch-dest"] = "iframe"
      if (status === "password_redirect") Object.assign(request.query, { password: "secret" })
      if (status === "password_redirect") Object.assign(drive, { resolvePublicShareAccess: vi.fn(async () => ({ status: "ok", cookie: "access" })) })
      await controller.renderShare("public", request as never, response as never)
      expect(history.recordShare).not.toHaveBeenCalled()
    }
  })

  it("does not break an already successful render if history capture fails", async () => {
    const { controller, history, request, response } = navigationFixture()
    history.recordShare.mockRejectedValueOnce(new Error("private details"))
    const log = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    await expect(controller.renderShare("public", request as never, response as never)).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith({ message: "Drive browsing history capture failed", errorName: "Error" })
    log.mockRestore()
  })

  it("captures successful site and cached public asset navigations, with HEAD and anonymous excluded", async () => {
    const first = navigationFixture()
    await first.controller.serveSitePath("site", "index.html", first.request as never, first.response as never)
    expect(first.history.recordSite).toHaveBeenCalledWith("browser", expect.any(String), "site", "index.html")
    for (const mode of ["GET", "HEAD", "anonymous"]) {
      const { controller, history, request, response } = navigationFixture()
      request.method = mode === "HEAD" ? "HEAD" : "GET"
      if (mode === "anonymous") request.headers.cookie = ""
      await controller.sendPublicAsset("asset", request as never, response as never)
      expect(history.recordPublicAsset).toHaveBeenCalledTimes(mode === "GET" ? 1 : 0)
    }
  })

  it("revalidates top-level Site asset visits while keeping subresource caching separate", async () => {
    for (const navigation of [true, false]) {
      const { controller, sites, request, response } = navigationFixture()
      sites.resolvePublicSite.mockResolvedValueOnce({ status: "ok", site: { accessMode: "public" }, asset: { storageKey: "css", relativePath: "app.css", contentType: "text/css" } })
      request.headers["sec-fetch-dest"] = navigation ? "document" : "style"
      await controller.serveSitePath("site", "app.css", request as never, response as never)
      expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", navigation ? "private, no-store" : "public, max-age=300")
      expect(response.setHeader).toHaveBeenCalledWith("Vary", "Sec-Fetch-Dest, Sec-Fetch-Mode")
    }
  })

  it("snapshots server-owned Site/asset metadata and strips all query parameters from persisted paths", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const { prisma, service, rows } = fixture()
    prisma.driveSite.findUnique.mockResolvedValue({ name: "Site", user: owner })
    prisma.publicAsset.findUnique.mockResolvedValue({ name: "File.pdf", mimeType: "application/pdf", user: owner })
    await service.recordSite("reader", randomUUID(), "site", "目录/index.html")
    await service.recordPublicAsset("reader", randomUUID(), "asset")
    expect(rows.map(({ title, path, kind }) => ({ title, path, kind }))).toEqual([
      { title: "Site", path: "/sites/site/%E7%9B%AE%E5%BD%95/index.html", kind: "web" },
      { title: "File.pdf", path: "/files/asset", kind: "document" },
    ])
    expect(rows.every((row) => !row.path.includes("?") && !row.path.includes("#"))).toBe(true)
  })
})


it("exposes authenticated history routes and binds browser visit POST routes to the cookie actor over HTTP", async () => {
  vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
  const history = { list: vi.fn(async () => ({ items: [], nextCursor: null })), clear: vi.fn(async () => ({ ok: true })), recordShare: vi.fn(async () => undefined) }
  const auth = { verifyAccessToken: vi.fn(async () => ({ userId: "desktop" })), verifyWebSession: vi.fn(async () => ({ userId: "browser" })) }
  const module = await Test.createTestingModule({
    controllers: [DriveUserController, DrivePublicController],
    providers: [
      { provide: DriveService, useValue: {} }, { provide: "DriveStoragePort", useValue: {} },
      { provide: DriveBrowsingHistoryService, useValue: history }, { provide: UserAuthService, useValue: auth },
    ],
  }).compile()
  const app = module.createNestApplication()
  await app.init()
  try {
    await httpRequest(app.getHttpServer()).get("/api/drive/browsing-history").expect(401)
    const listed = await httpRequest(app.getHttpServer()).get("/api/drive/browsing-history?kind=document&limit=2").set("Authorization", "Bearer desktop").expect(200)
    expect(listed.body).toEqual({ items: [], nextCursor: null })
    expect(listed.headers["cache-control"]).toBe("no-store")
    expect(history.list).toHaveBeenCalledWith("desktop", { kind: "document", limit: 2 })
    await httpRequest(app.getHttpServer()).delete("/api/drive/browsing-history").set("Authorization", "Bearer desktop").expect(200)
    expect(history.clear).toHaveBeenCalledWith("desktop")
    for (const path of ["/api/drive/browser/shares/public/visits", "/api/drive/browser/shares/public/items/child/visits"]) {
      const visitId = randomUUID()
      await httpRequest(app.getHttpServer()).post(path).set("Origin", "https://synapse.test").set("Cookie", "synapse_user_session=cookie").set("Authorization", "Bearer desktop").send({ visitId }).expect(201)
      expect(history.recordShare).toHaveBeenLastCalledWith("browser", visitId, { shareId: "public", itemId: path.includes("/items/") ? "child" : undefined, cookie: undefined })
    }
  } finally {
    await app.close()
  }
})
