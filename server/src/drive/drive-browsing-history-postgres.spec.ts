import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { requireLoopbackE2eDatabase } from "../../test/e2e-database-guard.mjs"
import type { PrismaService } from "../prisma/prisma.service"
import type { DriveService } from "./drive.service"
import { DriveBrowsingHistoryService } from "./drive-browsing-history.service"

const testDatabase = process.env.DRIVE_HISTORY_E2E_DATABASE_URL

describe.runIf(Boolean(testDatabase))("Drive browsing history on PostgreSQL", () => {
  let db: PrismaClient
  let service: DriveBrowsingHistoryService
  const users: string[] = []

  beforeAll(() => {
    const url = requireLoopbackE2eDatabase(testDatabase, "DRIVE_HISTORY_E2E_DATABASE_URL")
    db = new PrismaClient({ datasources: { db: { url } } })
    const drive = {
      resolveShareAnnotationAccess: async () => ({
        item: { id: "doc", userId: users[0], name: "Document.md", type: "file", mimeType: "text/markdown" },
      }),
    }
    service = new DriveBrowsingHistoryService(db as PrismaService, drive as unknown as DriveService)
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (!db) return
    try {
      await db.user.deleteMany({ where: { id: { in: users } } })
    } finally {
      await db.$disconnect()
    }
  })

  async function newViewer() {
    const id = randomUUID()
    await db.user.create({ data: { id, handle: id, nickname: "设计师", email: `${id}@example.com`, passwordHash: "test" } })
    users.push(id)
    return id
  }

  it("groups by the viewer's local midnight before filtering and paging", async () => {
    const viewerId = await newViewer()
    const otherViewer = await newViewer()
    const row = (title: string, at: string, path = "/share/report") => ({
      viewerId, visitId: randomUUID(), title, path, visitedAt: new Date(at),
      authorHandle: "writer", kind: "document", searchIndex: `${title.toLowerCase()} writer 设计师 private@example.com https://synapse.test${path}`,
    })
    await db.driveBrowsingHistory.createMany({ data: [
      row("Original", "2026-10-29T15:59:00.000Z"),
      row("Before rename", "2026-10-29T16:00:00.000Z"),
      row("Latest", "2026-10-29T17:00:00.000Z"),
      row("Different link", "2026-10-29T17:00:00.000Z", "/share/other"),
      { ...row("Cleared", "2026-10-29T18:00:00.000Z"), cleared: true },
      { ...row("Other viewer", "2026-10-29T19:00:00.000Z"), viewerId: otherViewer },
    ] })

    const first = await service.list(viewerId, { limit: 1 }, "Asia/Shanghai")
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).not.toBeNull()
    const second = await service.list(viewerId, { cursor: first.nextCursor!, limit: 2 }, "Asia/Shanghai")
    const entries = [...first.items, ...second.items]
    expect(entries).toEqual([
      expect.objectContaining({ visitedAt: "2026-10-29T17:00:00.000Z" }),
      expect.objectContaining({ visitedAt: "2026-10-29T17:00:00.000Z" }),
      expect.objectContaining({ title: "Original", visitCount: 1, visitedAt: "2026-10-29T15:59:00.000Z" }),
    ])
    expect(entries.slice(0, 2).map((entry) => [entry.title, entry.visitCount])).toEqual(expect.arrayContaining([
      ["Latest", 2], ["Different link", 1],
    ]))
    expect(second.nextCursor).toBeNull()

    const filtered = await service.list(viewerId, { query: "ＬＡＴＥＳＴ 设计师 private@example.com", kind: "document" }, "Asia/Shanghai")
    expect(filtered.items).toEqual([expect.objectContaining({ title: "Latest", visitCount: 2, visitedAt: "2026-10-29T17:00:00.000Z" })])
    expect(JSON.stringify(filtered)).not.toContain("private@example.com")
    expect((await service.list(viewerId, { query: "before rename" }, "Asia/Shanghai")).items).toEqual([])
    expect((await service.list(viewerId, { query: "latest", kind: "web" }, "Asia/Shanghai")).items).toEqual([])
    for (const suffix of ["", "/", "/reader", "/render/", "/download"]) {
      expect((await service.list(viewerId, { query: `https://synapse.test/share/report${suffix}?password=secret#fragment` })).items)
        .toEqual([expect.objectContaining({ title: "Latest", visitCount: 3, url: "https://synapse.test/share/report" })])
    }
    const filteredPage = await service.list(viewerId, { query: "https://synapse.test/share/report/reader?password=secret", limit: 1 }, "Asia/Shanghai")
    expect(filteredPage.nextCursor).not.toBeNull()
    expect((await service.list(viewerId, { query: "https://synapse.test/share/report/download#fragment", cursor: filteredPage.nextCursor! }, "Asia/Shanghai")).items)
      .toEqual([expect.objectContaining({ title: "Original", visitCount: 1 })])
    expect((await service.list(viewerId, { query: "%" })).items).toEqual([])
    expect((await service.list(viewerId, { query: "https://external.test/share/report/reader" })).items).toEqual([])
    await expect(service.list(viewerId, { cursor: first.nextCursor! }, "UTC")).rejects.toMatchObject({ status: 400 })
    await expect(service.list(viewerId, { cursor: first.nextCursor!, query: "latest" }, "Asia/Shanghai")).rejects.toMatchObject({ status: 400 })
    await expect(service.list(otherViewer, { cursor: first.nextCursor! }, "Asia/Shanghai")).rejects.toMatchObject({ status: 400 })
  })

  it("preserves Site reader segments and handles public-file URLs without their queries", async () => {
    const viewerId = await newViewer()
    const paths = ["/sites/site/index.html", "/sites/site/guide/reader", "/files/asset"]
    await db.driveBrowsingHistory.createMany({
      data: paths.map((path) => ({
        viewerId, visitId: randomUUID(), title: "Title", path,
        authorHandle: "writer", kind: "web", searchIndex: `https://synapse.test${path}`,
      })),
    })
    for (const path of paths) {
      const page = await service.list(viewerId, { query: `https://synapse.test${path}?ref=secret#section` })
      expect(page.items.map((entry) => entry.url)).toEqual([`https://synapse.test${path}`])
    }
    expect((await service.list(viewerId, { query: "https://synapse.test/files/asset/unknown" })).items).toEqual([])
  })

  it("counts concurrent opens once per event and keeps cleared event receipts", async () => {
    const viewer = await newViewer()
    const otherViewer = await newViewer()
    const first = randomUUID()
    const second = randomUUID()
    const visit = (viewerId: string, visitId: string) => service.recordShare(viewerId, visitId, { shareId: "report" })
    await Promise.all([visit(viewer, first), visit(viewer, second), visit(viewer, first), visit(otherViewer, first)])
    await visit(viewer, first)
    expect((await service.list(viewer)).items.reduce((total, row) => total + row.visitCount!, 0)).toBe(2)
    await service.clear(viewer)
    await Promise.all([visit(viewer, first), visit(viewer, second)])
    expect((await service.list(viewer)).items).toEqual([])
    expect((await service.list(otherViewer)).items).toEqual([expect.objectContaining({ visitCount: 1 })])
    const scrubbed = await db.driveBrowsingHistory.findMany({ where: { viewerId: viewer }, take: 5 })
    expect(scrubbed).toHaveLength(2)
    for (const row of scrubbed) expect(row).toMatchObject({ cleared: true, title: "", path: "", authorHandle: "", searchIndex: "" })
    await visit(viewer, randomUUID())
    expect((await service.list(viewer)).items).toEqual([expect.objectContaining({ visitCount: 1 })])
  })
})
