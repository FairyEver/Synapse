import { describe, expect, it, vi } from "vitest"
import { DriveChangeLogService } from "./drive-change-log"

describe("DriveChangeLogService", () => {
  it("appends a scoped Drive change record without storage secrets", async () => {
    const prisma = {
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
    })
    expect(JSON.stringify(prisma.driveChange.create.mock.calls[0]?.[0].data)).not.toContain("storageKey")
  })

  it("lists changes after a cursor with next cursor metadata", async () => {
    const prisma = {
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
        pathHint: null,
        actor: "user-1",
        occurredAt: "2026-06-28T08:01:00.000Z",
      }],
      nextCursor: "2",
      hasMore: false,
      resyncRequired: false,
    })
  })
})
