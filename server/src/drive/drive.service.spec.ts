import { BadRequestException, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { Readable } from "node:stream"
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
  copyObject: vi.fn(async () => undefined),
  getObjectStream: vi.fn(async () => ({ stream: Readable.from(""), size: 0n, contentType: null })),
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

  it("marks sessions failed and releases quota when upload instruction creation fails", async () => {
    const prisma = createPrismaMemory()
    const failingStorage: DriveStoragePort = {
      ...storageMock,
      createUploadInstruction: vi.fn(async () => {
        throw new Error("storage unavailable")
      }),
    }
    const service = new DriveService(prisma as unknown as PrismaService, failingStorage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

    await expect(service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })).rejects.toThrow("storage unavailable")

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(0n)
    const [item] = await prisma.driveItem.findMany()
    expect(item.storageStatus).toBe("failed")
    const [session] = await prisma.driveUploadSession.findMany()
    expect(session.status).toBe("failed")
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

  it("publishes an html file as a snapshot page", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })

    const publication = await service.publishPage("user-1", file.id, "https://synapse.test")

    expect(publication.type).toBe("page")
    expect(publication.url).toMatch(/^https:\/\/synapse\.test\/pages\/pub_/u)
    const assets = await prisma.drivePublicationAsset.findMany({ where: { publicationId: publication.id } })
    expect(assets).toMatchObject([{ relativePath: "index.html", sourceItemId: file.id, contentType: "text/html" }])
    expect(publication.currentDeploymentId).toBe(assets[0]?.deploymentId)
  })

  it("returns the existing active publication when source uniqueness races", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const existing = await prisma.drivePublication.create({
      data: {
        userId: "user-1",
        sourceItemId: file.id,
        type: "page",
        name: "report.html",
        status: "active",
        publishId: "pub_existing",
      },
    })
    const findFirst = prisma.drivePublication.findFirst
    let activeLookupCount = 0
    prisma.drivePublication.findFirst = async (args: any) => {
      if (args.where?.sourceItemId === file.id && args.where?.type === "page" && args.where?.status === "active") {
        activeLookupCount += 1
        if (activeLookupCount === 1) return null
      }
      return findFirst(args)
    }
    const create = prisma.drivePublication.create
    prisma.drivePublication.create = async (args: any) => {
      if (args.data?.sourceItemId === file.id && args.data?.type === "page") {
        throw uniqueConstraintError(["userId", "sourceItemId", "type"])
      }
      return create(args)
    }

    const publication = await service.publishPage("user-1", file.id, "https://synapse.test")

    expect(publication.id).toBe(existing.id)
    expect(publication.publishId).toBe("pub_existing")
    const publications = await prisma.drivePublication.findMany({ where: { userId: "user-1", sourceItemId: file.id, type: "page" } })
    expect(publications).toHaveLength(1)
  })

  it("retries publication creation when only the publish id collides", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const create = prisma.drivePublication.create
    let createCount = 0
    prisma.drivePublication.create = async (args: any) => {
      createCount += 1
      if (createCount === 1) throw uniqueConstraintError(["publishId"])
      return create(args)
    }

    const publication = await service.publishPage("user-1", file.id, "https://synapse.test")

    expect(publication.id).toMatch(/^publication-/u)
    expect(createCount).toBe(2)
  })

  it("rejects non-html page publication", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "notes.txt",
      mimeType: "text/plain",
    })

    await expect(service.publishPage("user-1", file.id, "https://synapse.test"))
      .rejects.toThrow("只能发布 HTML 文件。")
  })

  it("publishes a folder with index html as a snapshot site", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "site" })
    const index = await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "index.html",
      mimeType: "text/html",
    })
    const assetsFolder = await service.createFolder("user-1", { parentId: folder.id, name: "assets" })
    const css = await createCompletedUpload(service, "user-1", {
      parentId: assetsFolder.id,
      name: "style.css",
      mimeType: "text/css",
    })

    const publication = await service.publishSite("user-1", folder.id, "https://synapse.test")
    const assets = await prisma.drivePublicationAsset.findMany({
      where: { publicationId: publication.id },
      orderBy: { relativePath: "asc" },
    })

    expect(publication.url).toMatch(/^https:\/\/synapse\.test\/sites\/pub_.+\/$/u)
    expect(assets.map((asset: any) => [asset.relativePath, asset.sourceItemId])).toEqual([
      ["assets/style.css", css.id],
      ["index.html", index.id],
    ])
  })

  it("requires root index html for site publication", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "site" })

    await expect(service.publishSite("user-1", folder.id, "https://synapse.test"))
      .rejects.toThrow("站点根目录需要 index.html。")
  })

  it("rejects inactive folder root for site publication", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "site" })
    await prisma.driveItem.update({
      where: { id: folder.id },
      data: { storageStatus: "pending" },
    })

    await expect(service.publishSite("user-1", folder.id, "https://synapse.test"))
      .rejects.toThrow("站点文件夹不可发布。")
  })

  it("requires lowercase root index html for site publication", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "site" })
    await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "INDEX.HTML",
      mimeType: "text/html",
    })

    await expect(service.publishSite("user-1", folder.id, "https://synapse.test"))
      .rejects.toThrow("站点根目录需要 index.html。")
  })

  it("keeps the previous deployment active when redeploy copy fails", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const first = await service.publishPage("user-1", file.id, "https://synapse.test")
    const firstDeploymentId = first.currentDeploymentId
    vi.mocked(storageMock.copyObject).mockRejectedValueOnce(new Error("copy failed"))

    await expect(service.redeployPublication("user-1", first.id, "https://synapse.test")).rejects.toThrow("copy failed")
    const current = await prisma.drivePublication.findUniqueOrThrow({ where: { id: first.id } })
    const deployments = await prisma.drivePublicationDeployment.findMany({ where: { publicationId: first.id } })
    expect(current.currentDeploymentId).toBe(firstDeploymentId)
    expect(deployments.map((deployment: any) => deployment.status).sort()).toEqual(["active", "failed"])
  })

  it("prepares folder upload manifests with nested folders and file sessions", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

    const result = await service.prepareFolderUpload("user-1", {
      parentId: null,
      folderName: "交接材料",
      files: [
        { relativePath: "brief.txt", size: "11", mimeType: "text/plain" },
        { relativePath: "docs/spec.txt", size: "11", mimeType: "text/plain" },
      ],
      publicAppUrl: "https://synapse.test",
    })

    expect(result.root.name).toBe("交接材料")
    expect(result.entries).toHaveLength(2)
    expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual(["brief.txt", "docs/spec.txt"])
    expect(result.entries.every((entry) => entry.upload.method === "PUT")).toBe(true)
    const rootChildren = await service.listItems("user-1", result.root.id)
    expect(rootChildren.map((item) => item.name).sort()).toEqual(["brief.txt", "docs"])
  })

  it("lists public folder share children and keeps file share downloads scoped", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "交接材料" })
    const prepared = await service.prepareUpload("user-1", {
      parentId: folder.id,
      name: "brief.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", prepared.sessionId)
    const share = await service.createShare("user-1", folder.id, "https://synapse.test")

    const publicFolder = await service.listPublicFolderChildren(share.shareId)

    expect(publicFolder.item.name).toBe("交接材料")
    expect(publicFolder.children).toHaveLength(1)
    expect(publicFolder.children[0]?.name).toBe("brief.txt")
    const download = await service.createDownloadUrlForShareChild(share.shareId, prepared.item.id)
    expect(download.url).toBe("https://cos.example/download")
  })

  it("builds public folder archive entries with relative paths", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareFolderUpload("user-1", {
      parentId: null,
      folderName: "交接材料",
      files: [{ relativePath: "docs/spec.txt", size: "11", mimeType: "text/plain" }],
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", prepared.entries[0]!.sessionId)
    const share = await service.createShare("user-1", prepared.root.id, "https://synapse.test")

    const entries = await service.createFolderZipEntriesForShare(share.shareId)

    expect(entries).toEqual([{ path: "docs/spec.txt", url: "https://cos.example/download" }])
  })

  it("expires pending sessions and releases reserved quota", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "stale.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    await prisma.driveUploadSession.update({
      where: { id: prepared.sessionId },
      data: { expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    })

    const result = await service.expirePendingUploadSessions(new Date("2026-06-07T00:00:00.000Z"))
    expect(result.expired).toBe(1)
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(0n)
  })

  it("admin delete disables shares and hides the file", async () => {
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

    await service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")

    await expect(service.getItem("user-1", prepared.item.id)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.resolvePublicShare(share.shareId)).rejects.toBeInstanceOf(NotFoundException)
  })
})

async function createCompletedUpload(
  service: DriveService,
  userId: string,
  input: { readonly parentId: string | null; readonly name: string; readonly mimeType: string | null },
) {
  const prepared = await service.prepareUpload(userId, {
    parentId: input.parentId,
    name: input.name,
    size: "11",
    mimeType: input.mimeType,
    publicAppUrl: "https://synapse.test",
  })
  await service.completeUpload(userId, prepared.sessionId)
  return service.getItem(userId, prepared.item.id)
}

function createPrismaMemory() {
  let nextId = 1
  const users = new Map<string, { id: string; email: string; passwordHash: string }>()
  const items = new Map<string, any>()
  const usages = new Map<string, any>()
  const sessions = new Map<string, any>()
  const shares = new Map<string, any>()
  const publications = new Map<string, any>()
  const publicationDeployments = new Map<string, any>()
  const publicationAssets = new Map<string, any>()
  const now = () => new Date("2026-06-07T12:00:00.000Z")
  const id = (prefix: string) => `${prefix}-${nextId++}`
  const withShares = (item: any) => ({
    ...item,
    shares: [...shares.values()].filter((share) => share.itemId === item.id && share.enabled).map((share) => ({ enabled: share.enabled })),
  })
  const withSourceItem = (publication: any) => ({
    ...publication,
    sourceItem: publication.sourceItemId ? { deletedAt: items.get(publication.sourceItemId)?.deletedAt ?? null } : null,
  })

  const prisma: any = {
    $transaction: async (input: any) => {
      if (typeof input === "function") {
        const snapshots = [
          [items, cloneMap(items)],
          [usages, cloneMap(usages)],
          [sessions, cloneMap(sessions)],
          [shares, cloneMap(shares)],
          [publications, cloneMap(publications)],
          [publicationDeployments, cloneMap(publicationDeployments)],
          [publicationAssets, cloneMap(publicationAssets)],
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
    drivePublication: {
      create: async ({ data }: any) => {
        const publication = {
          id: id("publication"),
          currentDeploymentId: null,
          disabledAt: null,
          createdAt: now(),
          updatedAt: now(),
          ...data,
        }
        publications.set(publication.id, publication)
        return publication
      },
      findFirst: async ({ where, include }: any) => {
        const publication = [...publications.values()].find((item) => matchesWhere(item, where))
        if (!publication) return null
        return include?.sourceItem ? withSourceItem(publication) : publication
      },
      findMany: async ({ where, include, orderBy }: any = {}) => {
        let found = [...publications.values()].filter((publication) => matchesWhere(publication, where ?? {}))
        found = orderRows(found, orderBy)
        return include?.sourceItem ? found.map(withSourceItem) : found
      },
      findUniqueOrThrow: async ({ where, include }: any) => {
        const publication = publications.get(where.id)
        if (!publication) throw new Error("publication not found")
        return include?.sourceItem ? withSourceItem(publication) : publication
      },
      update: async ({ where, data, include }: any) => {
        const publication = publications.get(where.id)
        if (!publication) throw new Error("publication not found")
        Object.assign(publication, data, { updatedAt: now() })
        return include?.sourceItem ? withSourceItem(publication) : publication
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const publication of publications.values()) {
          if (matchesWhere(publication, where)) {
            Object.assign(publication, data, { updatedAt: now() })
            count += 1
          }
        }
        return { count }
      },
    },
    drivePublicationDeployment: {
      create: async ({ data }: any) => {
        const deployment = {
          id: id("deployment"),
          activatedAt: null,
          error: null,
          createdAt: now(),
          ...data,
        }
        publicationDeployments.set(deployment.id, deployment)
        return deployment
      },
      findMany: async ({ where, orderBy }: any = {}) => orderRows(
        [...publicationDeployments.values()].filter((deployment) => matchesWhere(deployment, where ?? {})),
        orderBy,
      ),
      update: async ({ where, data }: any) => {
        const deployment = publicationDeployments.get(where.id)
        if (!deployment) throw new Error("deployment not found")
        Object.assign(deployment, data)
        return deployment
      },
    },
    drivePublicationAsset: {
      createMany: async ({ data }: any) => {
        for (const row of data) {
          const asset = { id: id("asset"), sha256: null, ...row }
          publicationAssets.set(asset.id, asset)
        }
        return { count: data.length }
      },
      findMany: async ({ where, orderBy }: any = {}) => orderRows(
        [...publicationAssets.values()].filter((asset) => matchesWhere(asset, where ?? {})),
        orderBy,
      ),
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
      if (left[key] === right[key]) continue
      const comparison = left[key] > right[key] ? 1 : -1
      return direction === "desc" ? -comparison : comparison
    }
    return 0
  })
}

function uniqueConstraintError(target: readonly string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  })
}
