import { describe, expect, it, vi } from "vitest"
import { DriveChangeLogService } from "./drive-change-log"

describe("DriveChangeLogService", () => {
  it("appends a scoped Drive change record without storage secrets", async () => {
    const prisma = {
      driveItem: {
        findMany: vi.fn(async () => [
          { id: "item-1", parentId: "folder-1", type: "file", name: "report.md" },
          { id: "folder-1", parentId: null, type: "folder", name: "Docs" },
        ]),
      },
      driveChange: {
        create: vi.fn(async ({ data }) => ({
          id: "chg_1",
          sequence: 1n,
          userId: data.userId,
          itemId: data.itemId,
          parentId: data.parentId,
          type: data.type,
          versionId: data.versionId,
          etag: data.etag,
          name: data.name,
          pathHint: data.pathHint,
          actor: data.actor,
          occurredAt: new Date("2026-06-28T08:00:00.000Z"),
        })),
      },
    }
    const service = new DriveChangeLogService(prisma as never)

    const change = await service.append({
      userId: "user-1",
      itemId: "item-1",
      parentId: null,
      type: "content_updated",
      versionId: "version-1",
      etag: "etag-1",
      name: "report.md",
      actor: "user-1",
      pathHint: "/report.md",
    })

    expect(change).toMatchObject({
      id: "chg_1",
      sequence: "1",
      itemId: "item-1",
      type: "content_updated",
      versionId: "version-1",
      etag: "etag-1",
      name: "report.md",
      itemKind: "file",
      pathHint: "/report.md",
    })
    expect(prisma.driveChange.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pathHint: "/report.md" }),
    }))
    expect(JSON.stringify(prisma.driveChange.create.mock.calls[0]?.[0].data)).not.toContain("storageKey")
  })

  it("lists changes after a cursor with next cursor metadata", async () => {
    const prisma = {
      driveItem: {
        findMany: vi.fn(async ({ where }) => {
          const ids = new Set(where.id.in)
          return [
            { id: "item-2", parentId: "folder-1", type: "file", name: "next.md" },
            { id: "folder-1", parentId: null, type: "folder", name: "Docs" },
          ].filter((item) => ids.has(item.id))
        }),
      },
      driveChange: {
        findMany: vi.fn(async () => [
          {
            id: "chg_2",
            sequence: 2n,
            userId: "user-1",
            itemId: "item-2",
            parentId: null,
            type: "renamed",
            versionId: null,
            etag: null,
            name: "next.md",
            pathHint: null,
            actor: "user-1",
            occurredAt: new Date("2026-06-28T08:01:00.000Z"),
          },
        ]),
      },
    }
    const service = new DriveChangeLogService(prisma as never)

    await expect(service.list("user-1", { cursor: "1", limit: 50 })).resolves.toEqual({
      items: [{
        id: "chg_2",
        sequence: "2",
        itemId: "item-2",
        parentId: null,
        type: "renamed",
        versionId: null,
        etag: null,
        name: "next.md",
        pathHint: "/Docs/next.md",
        currentPathHint: "/Docs/next.md",
        itemKind: "file",
        actor: "user-1",
        occurredAt: "2026-06-28T08:01:00.000Z",
      }],
      nextCursor: "2",
      hasMore: false,
      resyncRequired: false,
    })
  })

  it("lists changes with scoped root filters", async () => {
    const prisma = {
      driveItem: {
        findMany: vi.fn(async () => []),
      },
      driveChange: {
        findMany: vi.fn(async () => [
          {
            id: "chg_2",
            sequence: 2n,
            userId: "user-1",
            itemId: "drive-root",
            parentId: null,
            type: "renamed",
            versionId: null,
            etag: null,
            name: "Docs",
            pathHint: "/Docs",
            actor: "user-1",
            occurredAt: new Date("2026-06-28T08:01:00.000Z"),
          },
          {
            id: "chg_3",
            sequence: 3n,
            userId: "user-1",
            itemId: "item-child",
            parentId: "drive-root",
            type: "content_updated",
            versionId: null,
            etag: null,
            name: "a.md",
            pathHint: "/Docs/a.md",
            actor: "user-1",
            occurredAt: new Date("2026-06-28T08:02:00.000Z"),
          },
        ]),
      },
    }
    const service = new DriveChangeLogService(prisma as never)

    const page = await service.list("user-1", {
      cursor: "1",
      limit: 50,
      rootItemId: "drive-root",
      rootPathHint: "/Docs",
    })

    expect(page.items.map((item) => item.id)).toEqual(["chg_2", "chg_3"])
    expect(page.nextCursor).toBe("3")
    expect(page.hasMore).toBe(false)
    expect(prisma.driveChange.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { itemId: "drive-root" },
          { parentId: "drive-root" },
          { pathHint: "/Docs" },
          { pathHint: { startsWith: "/Docs/" } },
        ]),
      }),
    }))
  })

  it("includes changes moved into nested folders under a scoped root", async () => {
    const items = [
      { id: "drive-root", parentId: null, type: "folder", name: "Docs" },
      { id: "nested", parentId: "drive-root", type: "folder", name: "Nested" },
      { id: "remote-report", parentId: "nested", type: "file", name: "report.md" },
    ]
    const prisma = {
      driveItem: {
        findMany: vi.fn(async ({ where }) => {
          if (where.parentId?.in) {
            const parentIds = new Set(where.parentId.in)
            return items
              .filter((item) => item.type === "folder" && parentIds.has(item.parentId ?? ""))
              .map((item) => ({ id: item.id }))
          }
          const ids = new Set(where.id.in)
          return items.filter((item) => ids.has(item.id))
        }),
      },
      driveChange: {
        findMany: vi.fn(async () => [
          {
            id: "chg_2",
            sequence: 2n,
            userId: "user-1",
            itemId: "remote-report",
            parentId: "nested",
            type: "moved",
            versionId: null,
            etag: null,
            name: "report.md",
            pathHint: "/Archive/report.md",
            actor: "user-1",
            occurredAt: new Date("2026-06-28T08:02:00.000Z"),
          },
        ]),
      },
    }
    const service = new DriveChangeLogService(prisma as never)

    await expect(service.list("user-1", {
      cursor: "1",
      limit: 50,
      rootItemId: "drive-root",
      rootPathHint: "/Docs",
    })).resolves.toMatchObject({
      items: [{
        id: "chg_2",
        pathHint: "/Archive/report.md",
        currentPathHint: "/Docs/Nested/report.md",
      }],
      nextCursor: "2",
      hasMore: false,
    })
    expect(prisma.driveChange.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { parentId: { in: ["drive-root", "nested"] } },
        ]),
      }),
    }))
  })

  it("returns the current cursor without replaying historical changes", async () => {
    const prisma = {
      driveItem: {
        findMany: vi.fn(),
      },
      driveChange: {
        findFirst: vi.fn(async () => ({ sequence: 42n })),
        findMany: vi.fn(),
      },
    }
    const service = new DriveChangeLogService(prisma as never)

    await expect(service.list("user-1", { cursor: "latest", limit: 1 })).resolves.toEqual({
      items: [],
      nextCursor: "42",
      hasMore: false,
      resyncRequired: false,
    })
    expect(prisma.driveChange.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    })
    expect(prisma.driveChange.findMany).not.toHaveBeenCalled()
    expect(prisma.driveItem.findMany).not.toHaveBeenCalled()
  })
})
