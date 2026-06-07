import { BadRequestException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { DriveService } from "./drive.service"
import type { DriveStoragePort } from "./drive-storage"

const storageMock: DriveStoragePort = {
  createUploadInstruction: vi.fn(async () => ({
    method: "PUT" as const,
    url: "https://cos.example/upload",
    expiresAt: new Date("2026-06-07T12:15:00.000Z"),
    headers: { "Content-Type": "text/plain" },
  })),
  createDownloadUrl: vi.fn(async () => ({
    url: "https://cos.example/download",
    expiresAt: new Date("2026-06-07T12:05:00.000Z"),
  })),
  headObject: vi.fn(async () => ({ key: "drive/item-file", size: 11n, etag: "etag" })),
  deleteObject: vi.fn(async () => undefined),
}

describe("DriveService", () => {
  it("prepares upload sessions with reserved quota and server-generated storage keys", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

    const result = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    expect(result.item.name).toBe("handoff.txt")
    expect(result.upload.method).toBe("PUT")
    const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: result.item.id } })
    expect(item.storageKey).toBe(`drive/${result.item.id}`)
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(11n)
    expect(usage.usedBytes).toBe(0n)
  })

  it("rejects uploads over the single file limit", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

    await expect(service.prepareUpload("user-1", {
      parentId: null,
      name: "large.bin",
      size: "1073741825",
      mimeType: "application/octet-stream",
      publicAppUrl: "https://synapse.test",
    })).rejects.toBeInstanceOf(BadRequestException)
  })

  it("completes uploads only after storage verification", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    const completed = await service.completeUpload("user-1", prepared.sessionId)
    expect(completed.storageStatus).toBe("active")
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(11n)
    expect(usage.reservedBytes).toBe(0n)
  })

  it("creates revocable share links", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", prepared.sessionId)

    const share = await service.createShare("user-1", prepared.item.id, "https://synapse.test")
    expect(share.url).toMatch(/^https:\/\/synapse\.test\/files\/shr_/u)
    await service.disableShare("user-1", share.id)
    await expect(service.resolvePublicShare(share.shareId)).rejects.toBeInstanceOf(NotFoundException)
  })
})

function createPrismaMemory() {
  let nextId = 1
  const users = new Map<string, { id: string; email: string; passwordHash: string }>()
  const items = new Map<string, any>()
  const usages = new Map<string, any>()
  const sessions = new Map<string, any>()
  const shares = new Map<string, any>()
  const now = () => new Date("2026-06-07T12:00:00.000Z")
  const id = (prefix: string) => `${prefix}-${nextId++}`
  const withShares = (item: any) => ({
    ...item,
    shares: [...shares.values()].filter((share) => share.itemId === item.id && share.enabled).map((share) => ({ enabled: share.enabled })),
  })

  const prisma: any = {
    $transaction: async (input: any) => {
      if (typeof input === "function") return input(prisma)
      return Promise.all(input)
    },
    user: {
      create: async ({ data }: any) => {
        users.set(data.id, data)
        return data
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
        const item = { id: id("item"), ...data, storageKey: data.storageKey ?? null, deletedAt: null, createdAt: now(), updatedAt: now() }
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
          if (where.id?.in?.includes(item.id)) {
            Object.assign(item, data, { updatedAt: now() })
            count += 1
          }
        }
        return { count }
      },
      findFirst: async ({ where, include, select }: any) => {
        const found = [...items.values()].find((item) => matchesWhere(item, where))
        if (!found) return null
        if (select) return selectFields(found, select)
        return include ? withShares(found) : found
      },
      findMany: async ({ where, select, include }: any = {}) => {
        const found = [...items.values()].filter((item) => matchesWhere(item, where ?? {}))
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
        const session = { id: id("session"), ...data, createdAt: now(), completedAt: null, failedAt: null }
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
      findMany: async ({ where, select }: any = {}) => {
        const found = [...sessions.values()].filter((session) => matchesWhere(session, where ?? {}))
        return select ? found.map((session) => selectFields(session, select)) : found
      },
    },
    driveShare: {
      create: async ({ data }: any) => {
        const share = { id: id("share"), enabled: true, passwordEnabled: false, passwordHash: null, expiresAt: null, disabledAt: null, createdAt: now(), ...data }
        shares.set(share.id, share)
        return share
      },
      findFirst: async ({ where, include }: any) => {
        const share = [...shares.values()].find((item) => matchesWhere(item, where))
        if (!share) return null
        return include?.item ? { ...share, item: withShares(items.get(share.itemId)) } : share
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
  }
  return prisma
}

function matchesWhere(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === "OR") return value.some((entry: any) => matchesWhere(row, entry))
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key])
    if (value && typeof value === "object" && "not" in value) return row[key] !== value.not
    if (value && typeof value === "object" && "gt" in value) return row[key] > value.gt
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
