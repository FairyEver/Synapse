import { BadRequestException, Logger, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { Readable } from "node:stream"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { DRIVE_BROWSER_TEXT_PREVIEW_MAX_BYTES } from "./drive-browser"
import { DriveService } from "./drive.service"
import type { DriveStoragePort } from "./drive-storage"

const originalTestEnv = { ...process.env }

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
  putObject: vi.fn(async () => undefined),
  copyObject: vi.fn(async () => undefined),
  getObjectStream: vi.fn(async () => ({ stream: Readable.from(""), size: 0n, contentType: null })),
  deleteObject: vi.fn(async () => undefined),
}

describe("DriveService", () => {
  beforeAll(() => {
    process.env.USER_ACCESS_JWT_SECRET = "user-access-secret-for-drive-specs"
  })

  afterAll(() => {
    process.env = originalTestEnv
  })

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

  it("rejects stale concurrent upload reservations before reserved quota exceeds the limit", async () => {
    const prisma = createPrismaMemory({ staleUsageReads: true })
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    await prisma.driveUsage.upsert({
      where: { userId: "user-1" },
      create: { userId: "user-1", usedBytes: 0n, reservedBytes: 0n, quotaBytes: 10n },
      update: {},
    })

    await service.prepareUpload("user-1", {
      parentId: null,
      name: "first.bin",
      size: "8",
      mimeType: "application/octet-stream",
      publicAppUrl: "https://synapse.test",
    })

    await expect(service.prepareUpload("user-1", {
      parentId: null,
      name: "second.bin",
      size: "8",
      mimeType: "application/octet-stream",
      publicAppUrl: "https://synapse.test",
    })).rejects.toThrow("云盘空间不足。")

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(8n)
    expect(await prisma.driveUploadSession.findMany()).toHaveLength(1)
  })

  it("rejects Windows-unsafe upload names", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

    for (const name of ["CON.txt", "report.", "report ", "bad:name.txt"]) {
      await expect(service.prepareUpload("user-1", {
        parentId: null,
        name,
        size: "11",
        mimeType: "text/plain",
        publicAppUrl: "https://synapse.test",
      })).rejects.toBeInstanceOf(BadRequestException)
    }

    expect(await prisma.driveItem.findMany()).toEqual([])
  })

  it("rejects uploads over the single file limit", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

    await expect(service.prepareUpload("user-1", {
      parentId: null,
      name: "large.bin",
      size: "104857601",
      mimeType: "application/octet-stream",
      publicAppUrl: "https://synapse.test",
    })).rejects.toThrow("文件超过 100MB 限制。")
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

  it("records a content change when an upload is completed", async () => {
    const prisma = createPrismaMemory()
    const changes = { append: vi.fn(async () => ({ id: "change-1", sequence: "1" })) }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock, undefined, undefined, changes as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    const completed = await service.completeUpload("user-1", prepared.sessionId)
    const changeInputs = changes.append.mock.calls.map(([input]) => input)

    expect(changeInputs).toEqual(expect.arrayContaining([expect.objectContaining({
      userId: "user-1",
      itemId: completed.id,
      parentId: null,
      type: "content_updated",
      versionId: expect.any(String),
      etag: "etag",
      name: "handoff.txt",
      actor: "user-1",
    })]))
  })

  it("cleans up copied version objects when upload completion transaction fails", async () => {
    const prisma = createPrismaMemory()
    const deleteObject = vi.fn(async () => undefined)
    const storage: DriveStoragePort = {
      ...storageMock,
      copyObject: vi.fn(async () => undefined),
      deleteObject,
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("db unavailable"))

    await expect(service.completeUpload("user-1", prepared.sessionId)).rejects.toThrow("db unavailable")

    const copiedKey = vi.mocked(storage.copyObject).mock.calls.at(-1)?.[0].toKey
    expect(copiedKey).toContain(`/versions/`)
    expect(deleteObject).toHaveBeenCalledWith(copiedKey)
  })

  it("builds admin storage summary from database aggregates", async () => {
    const forbiddenFindMany = vi.fn(() => {
      throw new Error("storage summary must not materialize rows")
    })
    const prisma = {
      $transaction: async (input: unknown[]) => Promise.all(input),
      driveItem: {
        findMany: forbiddenFindMany,
        groupBy: vi.fn(async () => [
          { lifecycleStatus: "active", _count: { _all: 2 }, _sum: { size: 11n } },
          { lifecycleStatus: "trashed", _count: { _all: 1 }, _sum: { size: 5n } },
          { lifecycleStatus: "hidden", _count: { _all: 1 }, _sum: { size: 7n } },
        ]),
      },
      publicAsset: {
        findMany: forbiddenFindMany,
        groupBy: vi.fn(async () => [
          { lifecycleStatus: "active", _count: { _all: 3 }, _sum: { size: 13n } },
          { lifecycleStatus: "hidden", _count: { _all: 1 }, _sum: { size: 17n } },
        ]),
      },
      publicAssetRevision: {
        findMany: forbiddenFindMany,
        aggregate: vi.fn(async () => ({ _count: { _all: 4 }, _sum: { size: 19n } })),
      },
    }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)

    await expect(service.getAdminStorageSummary()).resolves.toEqual({
      normalDrive: {
        active: { count: 2, bytes: "11" },
        trashed: { count: 1, bytes: "5" },
        hidden: { count: 1, bytes: "7" },
      },
      publicAssets: {
        active: { count: 3, bytes: "13" },
        trashed: { count: 0, bytes: "0" },
        hidden: { count: 1, bytes: "17" },
      },
      publicAssetRevisions: { count: 4, bytes: "19" },
      total: {
        quotaBytes: "29",
        adminVisibleBytes: "72",
      },
    })
    expect(forbiddenFindMany).not.toHaveBeenCalled()
  })

  it("returns the completed item when upload completion is retried", async () => {
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
    const retried = await service.completeUpload("user-1", prepared.sessionId)

    expect(retried.id).toBe(completed.id)
    expect(retried.storageStatus).toBe("active")
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(11n)
    expect(usage.reservedBytes).toBe(0n)
  })

  it("creates a first file version when a new upload completes", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(async (key) => ({ key, size: 11n, etag: "etag-v1" })),
      copyObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

    const completed = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.txt",
      mimeType: "text/plain",
    })

    const versions = await prisma.driveFileVersion.findMany({ where: { itemId: completed.id } })
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      userId: "user-1",
      versionNumber: 1,
      size: 11n,
      mimeType: "text/plain",
      source: "upload",
      etag: "etag-v1",
      deletedAt: null,
    })
    const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: completed.id } })
    expect(item.storageKey).toBe(versions[0]!.storageKey)
    expect(storage.copyObject).toHaveBeenCalledWith({
      fromKey: expect.stringMatching(/^drive\/item-/u),
      toKey: versions[0]!.storageKey,
      contentType: "text/plain",
    })
  })

  it("keeps old upload versions and charges full version storage on overwrite", async () => {
    const prisma = createPrismaMemory()
    const deleteObject = vi.fn(async () => undefined)
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(async (key) => ({
        key,
        size: key.includes("/overwrites/") ? 5n : 11n,
        etag: key.includes("/overwrites/") ? "etag-v2" : "etag-v1",
      })),
      copyObject: vi.fn(async () => undefined),
      deleteObject,
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const first = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.txt",
      mimeType: "text/plain",
    })

    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "report.txt",
      size: "5",
      mimeType: "text/markdown",
      publicAppUrl: "https://synapse.test",
    })
    const session = (await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0]
    expect(session.reservedBytes).toBe(5n)

    await service.completeUpload("user-1", prepared.sessionId)

    const versions = await prisma.driveFileVersion.findMany({
      where: { itemId: first.id, deletedAt: null },
      orderBy: { versionNumber: "asc" },
    })
    expect(versions.map((version: { versionNumber: number }) => version.versionNumber)).toEqual([1, 2])
    expect(versions.map((version: { size: bigint }) => version.size)).toEqual([11n, 5n])
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(16n)
    expect(usage.reservedBytes).toBe(0n)
    expect(deleteObject).not.toHaveBeenCalledWith(versions[0]!.storageKey)
  })

  it("restores a historical version by creating a new current version", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      copyObject: vi.fn(async () => undefined),
      deleteObject: vi.fn(async () => undefined),
      headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 5n : 11n, etag: "etag" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const first = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const v1 = (await service.listFileVersions("user-1", first.id, { offset: 0, limit: 20 })).items[0]!
    const prepared = await service.prepareUpload("user-1", { parentId: null, name: "report.txt", size: "5", mimeType: "text/markdown", publicAppUrl: "https://synapse.test" })
    await service.completeUpload("user-1", prepared.sessionId)

    const restored = await service.restoreFileVersion("user-1", first.id, v1.id)

    expect(restored).toMatchObject({ id: first.id, size: "11", mimeType: "text/plain" })
    const versions = await service.listFileVersions("user-1", first.id, { offset: 0, limit: 20 })
    expect(versions.items.map((version) => version.versionNumber)).toEqual([3, 2, 1])
    expect(versions.items[0]).toMatchObject({ source: "restore", restoredFromVersionId: v1.id, isCurrent: true })
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(27n)
  })

  it("records a content change when a historical version is restored", async () => {
    const prisma = createPrismaMemory()
    const changes = { append: vi.fn(async () => ({ id: "change-1", sequence: "1" })) }
    const storage: DriveStoragePort = {
      ...storageMock,
      copyObject: vi.fn(async () => undefined),
      deleteObject: vi.fn(async () => undefined),
      headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 5n : 11n, etag: "etag" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage, undefined, undefined, changes as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const first = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const v1 = (await service.listFileVersions("user-1", first.id, { offset: 0, limit: 20 })).items[0]!
    const prepared = await service.prepareUpload("user-1", { parentId: null, name: "report.txt", size: "5", mimeType: "text/markdown", publicAppUrl: "https://synapse.test" })
    await service.completeUpload("user-1", prepared.sessionId)
    changes.append.mockClear()

    const restored = await service.restoreFileVersion("user-1", first.id, v1.id)
    const changeInputs = changes.append.mock.calls.map(([input]) => input)

    expect(changeInputs).toEqual(expect.arrayContaining([expect.objectContaining({
      userId: "user-1",
      itemId: first.id,
      parentId: null,
      type: "content_updated",
      versionId: expect.any(String),
      etag: "etag",
      name: restored.name,
      actor: "user-1",
    })]))
  })

  it("rejects restoring the current file version", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      copyObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const currentItem = await prisma.driveItem.findUniqueOrThrow({ where: { id: item.id } })
    const current = (await prisma.driveFileVersion.findMany({ where: { itemId: item.id } }))
      .find((version: { readonly storageKey: string }) => version.storageKey === currentItem.storageKey)
    if (!current) throw new Error("current version not found")
    vi.mocked(storage.copyObject).mockClear()

    await expect(service.restoreFileVersion("user-1", item.id, current.id)).rejects.toThrow("不能恢复当前版本。")

    expect(storage.copyObject).not.toHaveBeenCalled()
    const versions = await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })
    expect(versions.items).toHaveLength(1)
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(11n)
  })

  it("cleans up copied restore objects when the restore transaction fails", async () => {
    const prisma = createPrismaMemory()
    const deleteObject = vi.fn(async () => undefined)
    const storage: DriveStoragePort = {
      ...storageMock,
      copyObject: vi.fn(async () => undefined),
      deleteObject,
      headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 5n : 11n, etag: "etag" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const first = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const v1 = (await service.listFileVersions("user-1", first.id, { offset: 0, limit: 20 })).items[0]!
    const prepared = await service.prepareUpload("user-1", { parentId: null, name: "report.txt", size: "5", mimeType: "text/markdown", publicAppUrl: "https://synapse.test" })
    await service.completeUpload("user-1", prepared.sessionId)
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("db unavailable"))

    await expect(service.restoreFileVersion("user-1", first.id, v1.id)).rejects.toThrow("db unavailable")

    const copiedKey = vi.mocked(storage.copyObject).mock.calls.at(-1)?.[0].toKey
    expect(copiedKey).toContain(`/versions/`)
    expect(deleteObject).toHaveBeenCalledWith(copiedKey)
  })

  it("rejects deleting the current version and releases quota for a deleted historical version", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
      headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 5n : 11n, etag: "etag" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const prepared = await service.prepareUpload("user-1", { parentId: null, name: "report.txt", size: "5", mimeType: "text/plain", publicAppUrl: "https://synapse.test" })
    await service.completeUpload("user-1", prepared.sessionId)
    const versions = await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })
    const current = versions.items.find((version) => version.isCurrent)!
    const historical = versions.items.find((version) => !version.isCurrent)!

    await expect(service.deleteFileVersion("user-1", item.id, current.id)).rejects.toThrow("不能删除当前版本。")
    await service.deleteFileVersion("user-1", item.id, historical.id)

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(5n)
    expect(await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })).toMatchObject({ total: 1 })
  })

  it("does not release quota twice for concurrent historical version deletes", async () => {
    const prisma = createPrismaMemory()
    const deleteObject = vi.fn(async () => undefined)
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject,
      headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 5n : 11n, etag: "etag" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const prepared = await service.prepareUpload("user-1", { parentId: null, name: "report.txt", size: "5", mimeType: "text/plain", publicAppUrl: "https://synapse.test" })
    await service.completeUpload("user-1", prepared.sessionId)
    const historical = (await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })).items.find((version) => !version.isCurrent)!
    deleteObject.mockClear()

    await expect(Promise.all([
      service.deleteFileVersion("user-1", item.id, historical.id),
      service.deleteFileVersion("user-1", item.id, historical.id),
    ])).resolves.toEqual([{ ok: true }, { ok: true }])

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(5n)
    expect(deleteObject).toHaveBeenCalledTimes(1)
  })

  it("updates version pin state", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const version = (await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })).items[0]!

    const pinned = await service.updateFileVersionPin("user-1", item.id, version.id, true)

    expect(pinned).toMatchObject({ id: version.id, isPinned: true })
  })

  it("cleanup skips current and pinned versions when count exceeds the limit", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
      headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 1n : 11n, etag: "etag" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const v1 = (await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })).items[0]!
    await service.updateFileVersionPin("user-1", item.id, v1.id, true)

    for (let index = 0; index < 101; index += 1) {
      const prepared = await service.prepareUpload("user-1", {
        parentId: null,
        name: "report.txt",
        size: "1",
        mimeType: "text/plain",
        publicAppUrl: "https://synapse.test",
      })
      await service.completeUpload("user-1", prepared.sessionId)
    }

    const versions = await service.listFileVersions("user-1", item.id, { offset: 0, limit: 200 })
    expect(versions.total).toBeLessThanOrEqual(100)
    expect(versions.items.some((version) => version.id === v1.id && version.isPinned)).toBe(true)
    expect(versions.items[0]!.isCurrent).toBe(true)
  })

  it("marks deletePending when historical object deletion fails", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => { throw new Error("cos unavailable") }),
      headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 5n : 11n, etag: "etag" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const prepared = await service.prepareUpload("user-1", { parentId: null, name: "report.txt", size: "5", mimeType: "text/plain", publicAppUrl: "https://synapse.test" })
    await service.completeUpload("user-1", prepared.sessionId)
    const historical = (await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })).items.find((version) => !version.isCurrent)!

    await service.deleteFileVersion("user-1", item.id, historical.id)

    const row = await prisma.driveFileVersion.findUniqueOrThrow({ where: { id: historical.id } })
    expect(row.deletedAt).not.toBeNull()
    expect(row.deletePending).toBe(true)
  })

  it("retries pending historical version deletes", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const version = (await prisma.driveFileVersion.findMany({ where: { itemId: item.id } }))[0]!
    await prisma.driveFileVersion.update({
      where: { id: version.id },
      data: { deletedAt: new Date(), deletePending: true },
    })

    const result = await service.retryPendingFileVersionDeletes()

    expect(result).toEqual({ attempted: 1, deleted: 1, failed: 0 })
    const row = await prisma.driveFileVersion.findUniqueOrThrow({ where: { id: version.id } })
    expect(row.deletePending).toBe(false)
  })

  it("overwrites same-name files while preserving item identity and shares", async () => {
    const prisma = createPrismaMemory()
    const deleteObject = vi.fn(async () => undefined)
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 5n : 11n, etag: "etag" })),
      deleteObject,
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const first = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.txt",
      mimeType: "text/plain",
    })
    const share = await service.createShare("user-1", first.id, "https://synapse.test")
    const original = await prisma.driveItem.findUniqueOrThrow({ where: { id: first.id } })
    const originalStorageKey = original.storageKey

    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "report.txt",
      size: "5",
      mimeType: "text/markdown",
      publicAppUrl: "https://synapse.test",
    })
    const session = (await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0]
    expect(prepared.item.id).toBe(first.id)
    expect(session.storageKey).toContain(`/overwrites/${prepared.sessionId}`)
    expect(session.reservedBytes).toBe(5n)

    const completed = await service.completeUpload("user-1", prepared.sessionId)
    expect(completed).toMatchObject({
      id: first.id,
      name: "report.txt",
      size: "5",
      mimeType: "text/markdown",
      shared: true,
    })
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(16n)
    expect(usage.reservedBytes).toBe(0n)
    expect(await service.listShares("user-1", "https://synapse.test")).toMatchObject({
      items: [expect.objectContaining({ shareId: share.shareId, itemName: "report.txt" })],
    })
    await expect(service.getShare("user-1", share.id, "https://synapse.test"))
      .resolves.toMatchObject({ id: share.id, shareId: share.shareId, itemName: "report.txt" })
    expect(deleteObject).not.toHaveBeenCalledWith(originalStorageKey)
  })

  it("keeps the existing file active when overwrite completion fails validation", async () => {
    const prisma = createPrismaMemory()
    const deleteObject = vi.fn(async () => undefined)
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(async (key) => (key.includes("/overwrites/") ? null : { key, size: 11n, etag: "etag" })),
      deleteObject,
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const first = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.txt",
      mimeType: "text/plain",
    })
    const original = await prisma.driveItem.findUniqueOrThrow({ where: { id: first.id } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "report.txt",
      size: "5",
      mimeType: "text/markdown",
      publicAppUrl: "https://synapse.test",
    })

    await expect(service.completeUpload("user-1", prepared.sessionId)).rejects.toThrow("上传文件校验失败。")
    const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: first.id } })
    expect(item).toMatchObject({
      storageKey: original.storageKey,
      storageStatus: "active",
      uploadStatus: "completed",
      size: 11n,
      mimeType: "text/plain",
    })
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(11n)
    expect(usage.reservedBytes).toBe(0n)
    expect(deleteObject).toHaveBeenCalledWith(expect.stringContaining(`/overwrites/${prepared.sessionId}`))
  })

  it("overwrites the newest legacy same-name file and keeps older duplicates", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 5n : 11n, etag: "etag" })),
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const older = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.txt",
      mimeType: "text/plain",
    })
    const newer = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report-copy.txt",
      mimeType: "text/plain",
    })
    await prisma.driveItem.update({ where: { id: newer.id }, data: { name: "report.txt" } })

    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "report.txt",
      size: "5",
      mimeType: "text/markdown",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", prepared.sessionId)

    expect(await service.getItem("user-1", older.id)).toMatchObject({ id: older.id, name: "report.txt", size: "11" })
    expect(await service.getItem("user-1", newer.id)).toMatchObject({ id: newer.id, name: "report.txt", size: "5", mimeType: "text/markdown" })
    expect(await service.listItems("user-1", null)).toHaveLength(2)
  })

  it("keeps public asset backing files out of normal Drive views and actions", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const backing = await createCompletedUpload(service, "user-1", { parentId: null, name: "logo.png", mimeType: "image/png" })
    const normal = await createCompletedUpload(service, "user-1", { parentId: null, name: "readme.txt", mimeType: "text/plain" })
    await markAsPublicAssetBacking(prisma, backing.id)

    expect((await service.listItems("user-1", null)).map((item) => item.id)).toEqual([normal.id])
    expect((await service.listItemTree("user-1", { parentId: null })).items.map((item) => item.id)).toEqual([normal.id])
    await expect(service.getItem("user-1", backing.id)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.renameItem("user-1", backing.id, "renamed.png")).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.moveItem("user-1", backing.id, null)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.createShare("user-1", backing.id, "https://synapse.test")).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.deleteItem("user-1", backing.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  it("keeps pending public asset backing files out of normal Drive list, stats, and tree views", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const normal = await createCompletedUpload(service, "user-1", { parentId: null, name: "readme.txt", mimeType: "text/plain" })
    const pending = await prisma.driveItem.create({
      data: {
        userId: "user-1",
        parentId: null,
        type: "file",
        name: "logo.png",
        size: 11n,
        mimeType: "image/png",
        storageKey: "drive/pending-public-asset",
        storageStatus: "pending",
        uploadStatus: "pending",
        lifecycleStatus: "active",
        deletedAt: null,
      },
    })
    await prisma.driveUploadSession.create({
      data: {
        userId: "user-1",
        itemId: pending.id,
        storageKey: "drive/pending-public-asset",
        expectedName: "logo.png",
        expectedSize: 11n,
        expectedMime: "image/png",
        reservedBytes: 11n,
        purpose: "public_asset_upload",
        status: "pending",
        credentialKind: "presigned_put",
        expiresAt: new Date("2026-06-07T12:15:00.000Z"),
      },
    })

    expect((await service.listItems("user-1", null)).map((item) => item.id)).toEqual([normal.id])
    await expect(service.getStats("user-1")).resolves.toMatchObject({
      itemCount: 1,
      fileCount: 1,
      folderCount: 0,
    })
    expect((await service.listItemTree("user-1", { parentId: null })).items.map((item) => item.id)).toEqual([normal.id])
    await expect(service.getItem("user-1", pending.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  it("hides legacy shares that point at public asset backing files", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const backing = await createCompletedUpload(service, "user-1", { parentId: null, name: "logo.png", mimeType: "image/png" })
    const share = await service.createShare("user-1", backing.id, "https://synapse.test")
    await markAsPublicAssetBacking(prisma, backing.id)

    await expect(service.listShares("user-1", "https://synapse.test")).resolves.toMatchObject({ items: [] })
    await expect(service.resolvePublicShareAccess({ shareId: share.shareId })).rejects.toBeInstanceOf(NotFoundException)
  })

  it("hides expired enabled shares from the public links list", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const expiredFile = await createCompletedUpload(service, "user-1", { parentId: null, name: "expired.txt", mimeType: "text/plain" })
    const activeFile = await createCompletedUpload(service, "user-1", { parentId: null, name: "active.txt", mimeType: "text/plain" })
    const expiredShare = await service.createShare("user-1", expiredFile.id, "https://synapse.test")
    const activeShare = await service.createShare("user-1", activeFile.id, "https://synapse.test")
    await prisma.driveShare.update({
      where: { id: expiredShare.id },
      data: { expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    })

    await expect(service.listShares("user-1", "https://synapse.test")).resolves.toMatchObject({
      items: [expect.objectContaining({ shareId: activeShare.shareId, itemName: "active.txt" })],
    })
    const items = await service.listItems("user-1", null)
    expect(items.find((item) => item.id === expiredFile.id)).toMatchObject({
      shared: false,
      activeShareId: null,
    })
    expect(items.find((item) => item.id === activeFile.id)).toMatchObject({
      shared: true,
      activeShareId: activeShare.id,
    })
    const tree = await service.listItemTree("user-1", { parentId: null })
    expect(tree.items.find((item) => item.id === expiredFile.id)).toMatchObject({
      shared: false,
      activeShareId: null,
    })
    expect(tree.items.find((item) => item.id === activeFile.id)).toMatchObject({
      shared: true,
      activeShareId: activeShare.id,
    })
  })

  it("filters public links by shared item name", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const reportFile = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
    const budgetFile = await createCompletedUpload(service, "user-1", { parentId: null, name: "budget.txt", mimeType: "text/plain" })
    const reportShare = await service.createShare("user-1", reportFile.id, "https://synapse.test")
    await service.createShare("user-1", budgetFile.id, "https://synapse.test")

    await expect(service.listShares("user-1", "https://synapse.test", { search: "report" })).resolves.toMatchObject({
      items: [expect.objectContaining({ shareId: reportShare.shareId, itemName: "report.txt" })],
      page: { hasMore: false },
    })
  })

  it("rejects ordinary restore for trashed public asset backing files", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const backing = await createCompletedUpload(service, "user-1", { parentId: null, name: "logo.png", mimeType: "image/png" })
    await markAsPublicAssetBacking(prisma, backing.id)
    await prisma.driveItem.update({
      where: { id: backing.id },
      data: {
        lifecycleStatus: "trashed",
        trashedAt: new Date("2026-06-07T12:00:00.000Z"),
        trashedBy: "user-1",
        deleteRootId: backing.id,
      },
    })

    await expect(service.restoreItem("user-1", backing.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  it("does not overwrite public asset backing files during normal same-name uploads", async () => {
    const prisma = createPrismaMemory()
    const objectSizes = new Map<string, bigint>()
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(async (key) => ({ key, size: objectSizes.get(key) ?? 11n, etag: "etag" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const backing = await createCompletedUpload(service, "user-1", { parentId: null, name: "logo.png", mimeType: "image/png" })
    await markAsPublicAssetBacking(prisma, backing.id)

    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "logo.png",
      size: "5",
      mimeType: "image/png",
      publicAppUrl: "https://synapse.test",
    })
    const session = (await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0]
    objectSizes.set(session.storageKey, 5n)
    await service.completeUpload("user-1", prepared.sessionId)

    expect(prepared.item.id).not.toBe(backing.id)
    expect(await service.getItem("user-1", prepared.item.id)).toMatchObject({ name: "logo.png", size: "5" })
    expect((await service.listItems("user-1", null)).map((item) => item.id)).toEqual([prepared.item.id])
    expect(await prisma.driveItem.findUniqueOrThrow({ where: { id: backing.id } })).toMatchObject({ size: 11n })
  })

  it("lets the last completed concurrent overwrite win with correct usage", async () => {
    const prisma = createPrismaMemory()
    const objectSizes = new Map<string, bigint>()
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(async (key) => ({ key, size: objectSizes.get(key) ?? 11n, etag: "etag" })),
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const initial = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.txt",
      mimeType: "text/plain",
    })
    const firstOverwrite = await service.prepareUpload("user-1", {
      parentId: null,
      name: "report.txt",
      size: "5",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    const secondOverwrite = await service.prepareUpload("user-1", {
      parentId: null,
      name: "report.txt",
      size: "7",
      mimeType: "text/markdown",
      publicAppUrl: "https://synapse.test",
    })
    const firstSession = (await prisma.driveUploadSession.findMany({ where: { id: firstOverwrite.sessionId } }))[0]
    const secondSession = (await prisma.driveUploadSession.findMany({ where: { id: secondOverwrite.sessionId } }))[0]
    objectSizes.set(firstSession.storageKey, 5n)
    objectSizes.set(secondSession.storageKey, 7n)

    await service.completeUpload("user-1", secondOverwrite.sessionId)
    await service.completeUpload("user-1", firstOverwrite.sessionId)

    expect(await service.getItem("user-1", initial.id)).toMatchObject({
      id: initial.id,
      size: "5",
      mimeType: "text/plain",
    })
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(23n)
    expect(usage.reservedBytes).toBe(0n)
  })

  it("applies quota once when upload completion requests race", async () => {
    const prisma = createPrismaMemory()
    const pendingHeads: Array<(value: { key: string; size: bigint; etag: string }) => void> = []
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(() => new Promise<{ key: string; size: bigint; etag: string }>((resolve) => pendingHeads.push(resolve))),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    const first = service.completeUpload("user-1", prepared.sessionId)
    const second = service.completeUpload("user-1", prepared.sessionId)
    while (pendingHeads.length < 2) await new Promise((resolve) => setTimeout(resolve, 0))
    pendingHeads.forEach((resolve) => resolve({ key: "drive/item-file", size: 11n, etag: "etag" }))
    const completed = await Promise.all([first, second])

    expect(completed[0].id).toBe(prepared.item.id)
    expect(completed[1].id).toBe(prepared.item.id)
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(11n)
    expect(usage.reservedBytes).toBe(0n)
  })

  it("deletes uploaded objects when storage verification fails", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(async () => ({ key: "drive/item-file", size: 10n, etag: "etag" })),
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    await expect(service.completeUpload("user-1", prepared.sessionId)).rejects.toBeInstanceOf(BadRequestException)

    expect(storage.deleteObject).toHaveBeenCalledWith(`drive/${prepared.item.id}`)
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(0n)
    const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })
    expect(item.storageStatus).toBe("failed")
    expect(item.storageDeletePending).toBe(false)
  })

  it("marks failed uploads pending cleanup when object deletion fails", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(async () => ({ key: "drive/item-file", size: 10n, etag: "etag" })),
      deleteObject: vi.fn(async () => {
        throw new Error("delete failed")
      }),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    await expect(service.completeUpload("user-1", prepared.sessionId)).rejects.toBeInstanceOf(BadRequestException)

    const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })
    expect(item.storageStatus).toBe("delete_pending")
    expect(item.storageDeletePending).toBe(true)
    const session = (await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0]
    expect(session?.status).toBe("failed")
  })

  it("retries pending Drive item storage deletes", async () => {
    const prisma = createPrismaMemory()
    const deleteObject = vi.fn(async () => undefined)
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject,
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "handoff.txt", mimeType: "text/plain" })
    const stored = await prisma.driveItem.findUniqueOrThrow({ where: { id: item.id } })
    await prisma.driveItem.update({
      where: { id: item.id },
      data: {
        deletedAt: new Date(),
        storageStatus: "delete_pending",
        storageDeletePending: true,
      },
    })

    const result = await service.retryPendingDriveItemStorageDeletes()

    expect(result).toEqual({ attempted: 1, deleted: 1, failed: 0 })
    expect(deleteObject).toHaveBeenCalledWith(stored.storageKey)
    const row = await prisma.driveItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(row.storageStatus).toBe("deleted")
    expect(row.storageDeletePending).toBe(false)
  })

  it("deletes uploaded objects when upload sessions are cancelled", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    await service.cancelUpload("user-1", prepared.sessionId)

    expect(storage.deleteObject).toHaveBeenCalledWith(`drive/${prepared.item.id}`)
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(0n)
    const session = (await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0]
    expect(session?.status).toBe("cancelled")
  })

  it("releases reserved quota once when upload cancellation requests race", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    const results = await Promise.allSettled([
      service.cancelUpload("user-1", prepared.sessionId),
      service.cancelUpload("user-1", prepared.sessionId),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(0n)
    expect(storage.deleteObject).toHaveBeenCalledTimes(1)
    const session = (await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0]
    expect(session?.status).toBe("cancelled")
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
    expect(share.url).toMatch(/^https:\/\/synapse\.test\/share\/shr_/u)
    await service.disableShare("user-1", share.id)
    await expect(service.resolvePublicShareAccess({ shareId: share.shareId })).rejects.toBeInstanceOf(NotFoundException)

    const publicShare = await service.createShare("user-1", prepared.item.id, "https://synapse.test")
    await service.disableShare("user-1", publicShare.shareId)
    await expect(service.resolvePublicShareAccess({ shareId: publicShare.shareId })).rejects.toBeInstanceOf(NotFoundException)
  })

  it("redacts public share ids from drive audit details", async () => {
    const prisma = createPrismaMemory()
    const auditLog = { record: vi.fn(async () => undefined) }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock, auditLog as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "handoff.txt",
      mimeType: "text/plain",
    })

    const share = await service.createShare("user-1", file.id, "https://synapse.test")
    await service.disableShare("user-1", share.shareId)

    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain(share.shareId)
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.share.create",
      targetId: share.id,
      detail: expect.objectContaining({
        shareRecordId: share.id,
        shareId: "[redacted-share-id]",
      }),
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.share.disable",
      targetId: share.id,
      detail: expect.objectContaining({
        shareRecordId: share.id,
        requestedShareId: "[redacted-share-id]",
      }),
    }))
  })

  it("creates password-protected share links by default", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "handoff.txt",
      mimeType: "text/plain",
    })

    const share = await service.createShare("user-1", file.id, "https://synapse.test")

    expect(share.passwordEnabled).toBe(true)
    expect(share.password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$/u)
    expect(share.urlWithPassword).toBe(`${share.url}?password=${share.password}`)
    expect(share.expiresAt).not.toBeNull()
    const stored = await prisma.driveShare.findFirst({ where: { id: share.id } })
    expect(stored.passwordHash).toEqual(expect.any(String))
    expect(stored.passwordEncrypted).toEqual(expect.any(String))
    expect(stored.accessSettingsAppliedAt).toBeInstanceOf(Date)
  })

  it("rejects share creation for non-active items", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "pending.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    await expect(service.createShare("user-1", prepared.item.id, "https://synapse.test"))
      .rejects
      .toBeInstanceOf(BadRequestException)
    expect(await prisma.driveShare.findMany()).toEqual([])
  })

  it("reuses active share settings when access settings are omitted", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "handoff.txt",
      mimeType: "text/plain",
    })
    const first = await service.createShare("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "30d" })

    const second = await service.createShare("user-1", file.id, "https://synapse.test")

    expect(second.id).toBe(first.id)
    expect(second.shareId).toBe(first.shareId)
    expect(second.url).toBe(first.url)
    expect(second.password).toBe(first.password)
    expect(second.urlWithPassword).toBe(first.urlWithPassword)
    expect(second.expiresAt).toBe(first.expiresAt)
    const activeShares = await prisma.driveShare.findMany({ where: { itemId: file.id, userId: "user-1", enabled: true } })
    expect(activeShares).toHaveLength(1)
  })

  it("overwrites active share settings without changing the share id", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "handoff.txt",
      mimeType: "text/plain",
    })
    const first = await service.createShare("user-1", file.id, "https://synapse.test")

    const second = await service.createShare("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "30d" })

    expect(second.id).toBe(first.id)
    expect(second.shareId).toBe(first.shareId)
    expect(second.url).toBe(first.url)
    expect(second.password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$/u)
    expect(second.password).not.toBe(first.password)
    expect(second.expiresAt).not.toBe(first.expiresAt)
    const activeShares = await prisma.driveShare.findMany({ where: { itemId: file.id, userId: "user-1", enabled: true } })
    expect(activeShares).toHaveLength(1)
    expect(activeShares[0]?.accessSettingsAppliedAt).toBeInstanceOf(Date)
  })

  it("audits completed uploads and item metadata changes", async () => {
    const prisma = createPrismaMemory()
    const auditLog = { record: vi.fn(async () => undefined) }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock, auditLog as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "report.html",
      size: "11",
      mimeType: "text/html",
      publicAppUrl: "https://synapse.test",
    })

    const auditContext = { ipAddress: "127.0.0.1" }
    const completed = await service.completeUpload("user-1", prepared.sessionId, auditContext)
    const renamed = await service.renameItem("user-1", completed.id, "index.html", auditContext)
    await service.moveItem("user-1", renamed.id, null, auditContext)

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.upload.complete",
      targetType: "drive.item",
      targetId: completed.id,
      adminEmail: "user@example.com",
      ipAddress: "127.0.0.1",
      detail: expect.objectContaining({ userId: "user-1", sessionId: prepared.sessionId, itemId: completed.id }),
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.rename",
      targetType: "drive.item",
      targetId: completed.id,
      detail: expect.objectContaining({ previousName: "report.html", nextName: "index.html" }),
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.move",
      targetType: "drive.item",
      targetId: completed.id,
      detail: expect.objectContaining({ previousParentId: null, nextParentId: null }),
    }))
  })

  it("keeps completed uploads successful when audit recording fails", async () => {
    const prisma = createPrismaMemory()
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const auditLog = { record: vi.fn(async (input: any) => {
      if (input.action === "drive.upload.complete") throw new Error("audit failed with token=secret")
    }) }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock, auditLog as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "report.html",
      size: "11",
      mimeType: "text/html",
      publicAppUrl: "https://synapse.test",
    })

    try {
      await expect(service.completeUpload("user-1", prepared.sessionId)).resolves.toMatchObject({
        id: prepared.item.id,
        storageStatus: "active",
      })

      const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })
      expect(item.storageStatus).toBe("active")
      const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
      expect(usage.usedBytes).toBe(11n)
      expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({
        action: "drive.upload.complete",
        targetType: "drive.item",
        targetId: prepared.item.id,
        errorName: "Error",
      }), "Drive audit log write failed")
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("token=secret")
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("keeps created shares successful when audit recording fails", async () => {
    const prisma = createPrismaMemory()
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const auditLog = { record: vi.fn(async (input: any) => {
      if (input.action === "drive.share.create") throw new Error("audit failed with token=secret")
    }) }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock, auditLog as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })

    try {
      const share = await service.createShare("user-1", file.id, "https://synapse.test")

      expect(share.url).toMatch(/^https:\/\/synapse\.test\/share\/shr_/u)
      await expect(prisma.driveShare.findFirst({ where: { id: share.id } })).resolves.toMatchObject({
        id: share.id,
        enabled: true,
      })
      expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({
        action: "drive.share.create",
        targetType: "drive.share",
        targetId: share.id,
        errorName: "Error",
      }), "Drive audit log write failed")
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("token=secret")
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("rejects Windows-unsafe rename targets", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.txt",
      mimeType: "text/plain",
    })

    for (const name of ["NUL", "report.", "report ", "bad:name.txt"]) {
      await expect(service.renameItem("user-1", file.id, name)).rejects.toBeInstanceOf(BadRequestException)
    }

    const unchanged = await service.getItem("user-1", file.id)
    expect(unchanged.name).toBe("report.txt")
  })

  it("rejects renaming a file to another file name in the same folder", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const first = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.txt",
      mimeType: "text/plain",
    })
    const second = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "notes.txt",
      mimeType: "text/plain",
    })

    await expect(service.renameItem("user-1", second.id, "report.txt")).rejects.toThrow("同名文件已存在。")
    await expect(service.renameItem("user-1", first.id, "report.txt")).resolves.toMatchObject({ id: first.id, name: "report.txt" })
  })

  it("rejects moving a file into a folder that already has a file with the same name", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const source = await service.createFolder("user-1", { parentId: null, name: "来源" })
    const target = await service.createFolder("user-1", { parentId: null, name: "目标" })
    const moving = await createCompletedUpload(service, "user-1", {
      parentId: source.id,
      name: "report.txt",
      mimeType: "text/plain",
    })
    await createCompletedUpload(service, "user-1", {
      parentId: target.id,
      name: "report.txt",
      mimeType: "text/plain",
    })

    await expect(service.moveItem("user-1", moving.id, target.id)).rejects.toThrow("目标位置已有同名文件。")
    await expect(service.moveItem("user-1", moving.id, source.id)).resolves.toMatchObject({ id: moving.id, parentId: source.id })
  })

  it("allows files and folders with the same name in one folder", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "资料" })

    const filePrepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "资料",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    const file = await service.completeUpload("user-1", filePrepared.sessionId)

    const folderPrepared = await service.prepareFolderUpload("user-1", {
      parentId: null,
      folderName: "资料.md",
      files: [{ relativePath: "index.md", size: "11", mimeType: "text/markdown" }],
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", folderPrepared.entries[0]!.sessionId)

    expect(file).toMatchObject({ name: "资料", type: "file" })
    expect(folder).toMatchObject({ name: "资料", type: "folder" })
    expect(folderPrepared.root).toMatchObject({ name: "资料.md", type: "folder" })
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
    expect(result.rootCreated).toBe(true)
    expect(result.entries).toHaveLength(2)
    expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual(["brief.txt", "docs/spec.txt"])
    expect(result.entries.every((entry) => entry.upload.method === "PUT")).toBe(true)
    const rootChildren = await service.listItems("user-1", result.root.id)
    expect(rootChildren.map((item) => item.name).sort()).toEqual(["brief.txt", "docs"])
  })

  it("rejects duplicate normalized folder upload paths before creating artifacts", async () => {
    const prisma = createPrismaMemory()
    const createUploadInstruction = vi.fn(async () => ({
      method: "PUT" as const,
      url: "https://cos.example/upload",
      expiresAt: new Date("2026-06-07T12:15:00.000Z"),
      headers: { "Content-Type": "text/plain" },
    }))
    const service = new DriveService(prisma as unknown as PrismaService, {
      ...storageMock,
      createUploadInstruction,
    })
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

    await expect(service.prepareFolderUpload("user-1", {
      parentId: null,
      folderName: "交接材料",
      files: [
        { relativePath: "docs/e\u0301.txt", size: "11", mimeType: "text/plain" },
        { relativePath: "docs/é.txt", size: "12", mimeType: "text/plain" },
      ],
      publicAppUrl: "https://synapse.test",
    })).rejects.toThrow("文件路径重复。")

    expect(createUploadInstruction).not.toHaveBeenCalled()
    expect(await service.listItems("user-1", null)).toEqual([])
    expect(await prisma.driveUploadSession.findMany()).toEqual([])
    expect(await prisma.driveItem.findMany()).toEqual([])
  })

  it("merges folder uploads into existing folders and overwrites same-name files", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 5n : 11n, etag: "etag" })),
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const root = await service.createFolder("user-1", { parentId: null, name: "项目A" })
    const existing = await createCompletedUpload(service, "user-1", {
      parentId: root.id,
      name: "a.md",
      mimeType: "text/markdown",
    })

    const prepared = await service.prepareFolderUpload("user-1", {
      parentId: null,
      folderName: "项目A",
      files: [
        { relativePath: "a.md", size: "5", mimeType: "text/plain" },
        { relativePath: "docs/b.md", size: "11", mimeType: "text/markdown" },
      ],
      publicAppUrl: "https://synapse.test",
    })
    expect(prepared.root.id).toBe(root.id)
    expect(prepared.rootCreated).toBe(false)
    expect(prepared.entries.find((entry) => entry.relativePath === "a.md")?.item.id).toBe(existing.id)

    for (const entry of prepared.entries) {
      await service.completeUpload("user-1", entry.sessionId)
    }

    expect(await service.getItem("user-1", existing.id)).toMatchObject({ id: existing.id, name: "a.md", size: "5", mimeType: "text/plain" })
    const rootChildren = await service.listItems("user-1", root.id)
    expect(rootChildren.map((item) => item.name).sort()).toEqual(["a.md", "docs"])
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(27n)
    expect(usage.reservedBytes).toBe(0n)
  })

  it("rejects Windows-unsafe folder upload path segments before creating artifacts", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

    await expect(service.prepareFolderUpload("user-1", {
      parentId: null,
      folderName: "交接材料",
      files: [
        { relativePath: "docs/CON.txt", size: "11", mimeType: "text/plain" },
      ],
      publicAppUrl: "https://synapse.test",
    })).rejects.toBeInstanceOf(BadRequestException)

    expect(await service.listItems("user-1", null)).toEqual([])
    expect(await prisma.driveUploadSession.findMany()).toEqual([])
    expect(await prisma.driveItem.findMany()).toEqual([])
  })

  it("rolls back folder upload prepare artifacts when a later file fails", async () => {
    const prisma = createPrismaMemory()
    const createUploadInstruction = vi.fn()
      .mockResolvedValueOnce({
        method: "PUT" as const,
        url: "https://cos.example/upload-1",
        expiresAt: new Date("2026-06-07T12:15:00.000Z"),
        headers: { "Content-Type": "text/plain" },
      })
      .mockRejectedValueOnce(new Error("COS unavailable"))
    const storage: DriveStoragePort = {
      ...storageMock,
      createUploadInstruction,
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

    await expect(service.prepareFolderUpload("user-1", {
      parentId: null,
      folderName: "交接材料",
      files: [
        { relativePath: "brief.txt", size: "11", mimeType: "text/plain" },
        { relativePath: "docs/spec.txt", size: "11", mimeType: "text/plain" },
      ],
      publicAppUrl: "https://synapse.test",
    })).rejects.toThrow("COS unavailable")

    expect(await service.listItems("user-1", null)).toEqual([])
    const sessions = await prisma.driveUploadSession.findMany()
    expect(sessions).toHaveLength(2)
    expect(sessions.every((session: any) => session.status === "failed")).toBe(true)
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(0n)
    const items = await prisma.driveItem.findMany()
    expect(items).toHaveLength(4)
    expect(items.every((item: any) => item.deletedAt instanceof Date)).toBe(true)
  })

  it("streams public share browser downloads without minting storage urls", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "brief.txt",
      mimeType: "text/plain",
    })
    const share = await service.createShare("user-1", file.id, "https://synapse.test")
    vi.mocked(storageMock.createDownloadUrl).mockClear()
    vi.mocked(storageMock.getObjectStream).mockClear()
    vi.mocked(storageMock.getObjectStream).mockResolvedValueOnce({
      stream: Readable.from("brief"),
      size: 5n,
      contentType: "text/plain",
    })

    const download = await service.openShareBrowserItemDownload({
      shareId: share.shareId,
      password: share.password ?? undefined,
    })

    expect(download.kind).toBe("file")
    if (download.kind !== "file") throw new Error("expected file download")
    expect(download.fileName).toBe("brief.txt")
    expect(download.size).toBe(5n)
    expect(download.contentType).toBe("text/plain")
    const currentFile = await prisma.driveItem.findUniqueOrThrow({ where: { id: file.id } })
    expect(storageMock.getObjectStream).toHaveBeenCalledWith({ key: currentFile.storageKey })
    expect(storageMock.createDownloadUrl).not.toHaveBeenCalled()
  })

  it("uses authenticated owner download routes for image previews", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "photo.png",
      mimeType: "image/png",
    })
    vi.mocked(storageMock.createDownloadUrl).mockClear()
    vi.mocked(storageMock.getObjectStream).mockClear()

    const snapshot = await service.getOwnerBrowserSnapshot({
      userId: "user-1",
      itemId: file.id,
      surface: "standalone",
    })

    expect(snapshot.preview?.kind).toBe("image")
    expect(snapshot.preview?.imageUrl).toBe(`/drive/items/${file.id}/download`)
    expect(storageMock.getObjectStream).not.toHaveBeenCalled()
    expect(storageMock.createDownloadUrl).not.toHaveBeenCalled()
  })

  it("uses share download routes for public image previews", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "photo.png",
      mimeType: "image/png",
    })
    const share = await service.createShare("user-1", file.id, "https://synapse.test")
    vi.mocked(storageMock.createDownloadUrl).mockClear()
    vi.mocked(storageMock.getObjectStream).mockClear()

    const snapshot = await service.getShareBrowserSnapshot({
      shareId: share.shareId,
      password: share.password ?? undefined,
    })

    expect(snapshot.preview?.kind).toBe("image")
    expect(snapshot.preview?.imageUrl).toBe(`/share/${share.shareId}/download`)
    expect(storageMock.getObjectStream).not.toHaveBeenCalled()
    expect(storageMock.createDownloadUrl).not.toHaveBeenCalled()
  })

  it("rejects revoked public share browser downloads before reading storage", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "brief.txt",
      mimeType: "text/plain",
    })
    const share = await service.createShare("user-1", file.id, "https://synapse.test")
    await service.disableShare("user-1", share.id)
    vi.mocked(storageMock.createDownloadUrl).mockClear()
    vi.mocked(storageMock.getObjectStream).mockClear()

    await expect(service.openShareBrowserItemDownload({
      shareId: share.shareId,
      password: share.password ?? undefined,
    })).rejects.toBeInstanceOf(NotFoundException)
    expect(storageMock.getObjectStream).not.toHaveBeenCalled()
    expect(storageMock.createDownloadUrl).not.toHaveBeenCalled()
  })

  it("rejects protected share direct access before reading storage", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "secret.txt",
      mimeType: "text/plain",
    })
    const folder = await service.createFolder("user-1", { parentId: null, name: "交接材料" })
    const child = await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "brief.txt",
      mimeType: "text/plain",
    })
    const fileShare = await service.createShare("user-1", file.id, "https://synapse.test")
    const folderShare = await service.createShare("user-1", folder.id, "https://synapse.test")
    vi.mocked(storageMock.createDownloadUrl).mockClear()
    vi.mocked(storageMock.getObjectStream).mockClear()

    await expect(service.openShareBrowserItemDownload({ shareId: fileShare.shareId })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.getShareBrowserSnapshot({ shareId: folderShare.shareId })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.openShareBrowserItemDownload({
      shareId: folderShare.shareId,
      itemId: child.id,
    })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.openShareBrowserItemDownload({ shareId: folderShare.shareId })).rejects.toBeInstanceOf(NotFoundException)
    expect(storageMock.getObjectStream).not.toHaveBeenCalled()
    expect(storageMock.createDownloadUrl).not.toHaveBeenCalled()
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
    vi.mocked(storageMock.createDownloadUrl).mockClear()

    const archive = await service.openShareBrowserItemDownload({
      shareId: share.shareId,
      password: share.password ?? undefined,
    })
    const fileItem = await prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.entries[0]!.item.id } })

    expect(archive).toMatchObject({ kind: "zip", filename: "交接材料.zip" })
    expect(archive.kind === "zip" ? await collectAsync(archive.entries) : []).toEqual([
      { path: "docs/spec.txt", storageKey: fileItem.storageKey },
    ])
    expect(storageMock.createDownloadUrl).not.toHaveBeenCalled()
  })

  it("defers folder archive traversal until zip entries are consumed", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "Archive" })
    await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "report.pdf",
      mimeType: "application/pdf",
    })
    const findMany = vi.spyOn(prisma.driveItem, "findMany")

    const archive = await service.openOwnerBrowserItemDownload({
      userId: "user-1",
      itemId: folder.id,
    })

    expect(archive).toMatchObject({ kind: "zip", filename: "Archive.zip" })
    expect(findMany).not.toHaveBeenCalled()
    expect(archive.kind === "zip" ? await collectAsync(archive.entries) : []).toHaveLength(1)
    expect(findMany).toHaveBeenCalled()
  })

  it("disambiguates legacy same-name files in owner folder archive entries", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "交接材料" })
    const first = await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "report.pdf",
      mimeType: "application/pdf",
    })
    const second = await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "report-copy.pdf",
      mimeType: "application/pdf",
    })
    await prisma.driveItem.update({ where: { id: second.id }, data: { name: "report.pdf" } })

    const archive = await service.openOwnerBrowserItemDownload({
      userId: "user-1",
      itemId: folder.id,
    })
    const firstItem = await prisma.driveItem.findUniqueOrThrow({ where: { id: first.id } })
    const secondItem = await prisma.driveItem.findUniqueOrThrow({ where: { id: second.id } })

    expect(archive).toMatchObject({ kind: "zip", filename: "交接材料.zip" })
    expect(archive.kind === "zip" ? await collectAsync(archive.entries) : []).toEqual([
      { path: "report.pdf", storageKey: firstItem.storageKey },
      { path: "report (2).pdf", storageKey: secondItem.storageKey },
    ])
  })

  it("disambiguates legacy same-name files in shared child folder archive entries", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const root = await service.createFolder("user-1", { parentId: null, name: "共享" })
    const docs = await service.createFolder("user-1", { parentId: root.id, name: "docs" })
    const first = await createCompletedUpload(service, "user-1", {
      parentId: docs.id,
      name: "report.pdf",
      mimeType: "application/pdf",
    })
    const second = await createCompletedUpload(service, "user-1", {
      parentId: docs.id,
      name: "report-copy.pdf",
      mimeType: "application/pdf",
    })
    await prisma.driveItem.update({ where: { id: second.id }, data: { name: "report.pdf" } })
    const share = await service.createShare("user-1", root.id, "https://synapse.test")

    const archive = await service.openShareBrowserItemDownload({
      shareId: share.shareId,
      itemId: docs.id,
      password: share.password ?? undefined,
    })
    const firstItem = await prisma.driveItem.findUniqueOrThrow({ where: { id: first.id } })
    const secondItem = await prisma.driveItem.findUniqueOrThrow({ where: { id: second.id } })

    expect(archive).toMatchObject({ kind: "zip", filename: "docs.zip" })
    expect(archive.kind === "zip" ? await collectAsync(archive.entries) : []).toEqual([
      { path: "report.pdf", storageKey: firstItem.storageKey },
      { path: "report (2).pdf", storageKey: secondItem.storageKey },
    ])
  })

  it("builds owner browser snapshots with child breadcrumbs and html visit urls", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      getObjectStream: vi.fn(async () => ({ stream: Readable.from("<html></html>"), size: 13n, contentType: "text/html" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "site" })
    const page = await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "index.html",
      mimeType: "text/html",
    })

    const snapshot = await service.getOwnerBrowserSnapshot({
      userId: "user-1",
      itemId: page.id,
      surface: "standalone",
    })

    expect(snapshot.context).toBe("owner")
    expect(snapshot.current.browserUrl).toBe(`/drive/items/${page.id}`)
    expect(snapshot.breadcrumbs.map((item) => item.name)).toEqual(["site", "index.html"])
    expect(snapshot.preview).toMatchObject({
      kind: "html-source",
      text: "<html></html>",
      visitUrl: `/drive/items/${page.id}/render`,
    })
  })

  it("limits owner browser folder children and exposes the next offset", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "资料" })
    await createCompletedUpload(service, "user-1", { parentId: folder.id, name: "a.txt", mimeType: "text/plain" })
    await createCompletedUpload(service, "user-1", { parentId: folder.id, name: "b.txt", mimeType: "text/plain" })
    await createCompletedUpload(service, "user-1", { parentId: folder.id, name: "c.txt", mimeType: "text/plain" })

    const snapshot = await service.getOwnerBrowserSnapshot({
      userId: "user-1",
      itemId: folder.id,
      surface: "standalone",
      childrenPage: { limit: 2 },
    })

    expect(snapshot.children).toHaveLength(2)
    expect(snapshot.childrenPage).toEqual({
      offset: 0,
      limit: 2,
      hasMore: true,
      nextOffset: 2,
    })
  })

  it("builds owner browser snapshots with rendered markdown previews", async () => {
    const prisma = createPrismaMemory()
    const longMarkdown = [
      "# Notes",
      "",
      "## Details",
      "",
      "x".repeat(150 * 1024),
    ].join("\n")
    const expectedPreviewText = longMarkdown.slice(0, DRIVE_BROWSER_TEXT_PREVIEW_MAX_BYTES)
    const storage: DriveStoragePort = {
      ...storageMock,
      getObjectStream: vi.fn(async () => ({ stream: Readable.from(longMarkdown), size: BigInt(Buffer.byteLength(longMarkdown)), contentType: "text/markdown" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "notes.md",
      mimeType: "text/markdown",
    })

    const snapshot = await service.getOwnerBrowserSnapshot({
      userId: "user-1",
      itemId: file.id,
      surface: "standalone",
    })

    expect(snapshot.current.previewKind).toBe("markdown")
    expect(snapshot.annotation).toEqual({ canComment: true, reason: null })
    expect(snapshot.preview).toMatchObject({
      kind: "markdown",
      text: expectedPreviewText,
      html: expect.stringContaining('<h1 id="notes">Notes</h1>'),
      outline: [
        {
          id: "notes",
          text: "Notes",
          depth: 1,
          children: [
            {
              id: "details",
              text: "Details",
              depth: 2,
              children: [],
            },
          ],
        },
      ],
      truncated: true,
      visitUrl: null,
    })
  })

  it("rejects markdown direct render requests", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      getObjectStream: vi.fn(async () => ({ stream: Readable.from("# Notes"), size: 7n, contentType: "text/markdown" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "notes.md",
      mimeType: "text/markdown",
    })

    await expect(service.resolveOwnerRenderAccess({
      userId: "user-1",
      itemId: file.id,
    })).rejects.toBeInstanceOf(BadRequestException)
    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("builds console root browser snapshots for user drive roots", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "资料" })

    const snapshot = await service.getOwnerConsoleRootBrowserSnapshot("user-1")

    expect(snapshot.current.browserUrl).toBe("/console/drive")
    expect(snapshot.breadcrumbs).toEqual([{ id: "root", name: "网盘", browserUrl: "/console/drive" }])
    expect(snapshot.children).toEqual([expect.objectContaining({
      id: folder.id,
      browserUrl: `/console/drive/folders/${folder.id}`,
      downloadUrl: `/drive/items/${folder.id}/download`,
    })])
  })

  it("builds console root file children as console item links", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "notes.md",
      mimeType: "text/markdown",
    })

    const snapshot = await service.getOwnerConsoleRootBrowserSnapshot("user-1")

    expect(snapshot.children).toEqual([expect.objectContaining({
      id: file.id,
      browserUrl: `/console/drive/items/${file.id}?surface=console`,
      downloadUrl: `/drive/items/${file.id}/download`,
    })])
  })

  it("builds console file snapshots without sibling children", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "资料" })
    const selected = await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "selected.md",
      mimeType: "text/markdown",
    })
    const sibling = await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "sibling.md",
      mimeType: "text/markdown",
    })

    const snapshot = await service.getOwnerBrowserSnapshot({
      userId: "user-1",
      itemId: selected.id,
      surface: "console",
    })

    expect(snapshot.current.id).toBe(selected.id)
    expect(snapshot.children).toEqual([])
    expect(snapshot.childrenPage?.hasMore).toBe(false)
    vi.mocked(storageMock.getObjectStream).mockClear()
  })

  it("limits console root browser children", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    await service.createFolder("user-1", { parentId: null, name: "资料 A" })
    await service.createFolder("user-1", { parentId: null, name: "资料 B" })
    await service.createFolder("user-1", { parentId: null, name: "资料 C" })

    const snapshot = await service.getOwnerConsoleRootBrowserSnapshot("user-1", { limit: 2 })

    expect(snapshot.children).toHaveLength(2)
    expect(snapshot.childrenPage).toEqual({
      offset: 0,
      limit: 2,
      hasMore: true,
      nextOffset: 2,
    })
  })

  it("builds share browser html source previews with render visit urls", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      getObjectStream: vi.fn(async () => ({ stream: Readable.from("<html></html>"), size: 13n, contentType: "text/html" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "index.html",
      mimeType: "text/html",
    })
    const share = await service.createShare("user-1", file.id, "https://synapse.test")

    const snapshot = await service.getShareBrowserSnapshot({
      shareId: share.shareId,
      password: share.password ?? undefined,
    })

    expect(snapshot.current.browserUrl).toBe(`/share/${share.shareId}`)
    expect(snapshot.annotation).toBeNull()
    expect(snapshot.preview).toMatchObject({
      kind: "html-source",
      text: "<html></html>",
      visitUrl: `/share/${share.shareId}/render`,
    })
  })

  it("builds share browser snapshots with rendered markdown previews", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      getObjectStream: vi.fn(async () => ({ stream: Readable.from("# Notes\n\n## Shared"), size: 17n, contentType: "text/markdown" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    await prisma.user.create({ data: { id: "reader-1", email: "reader@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "notes.md",
      mimeType: "text/markdown",
    })
    const share = await service.createShare("user-1", file.id, "https://synapse.test")

    const snapshot = await service.getShareBrowserSnapshot({
      shareId: share.shareId,
      password: share.password ?? undefined,
    })
    const loggedInSnapshot = await service.getShareBrowserSnapshot({
      shareId: share.shareId,
      password: share.password ?? undefined,
      actorUserId: "reader-1",
    })

    expect(snapshot.annotation).toEqual({ canComment: false, reason: "login_required" })
    expect(loggedInSnapshot.annotation).toEqual({ canComment: true, reason: null })
    expect(snapshot.preview).toMatchObject({
      kind: "markdown",
      text: "# Notes\n\n## Shared",
      html: expect.stringContaining('<h1 id="notes">Notes</h1>'),
      outline: [
        {
          id: "notes",
          text: "Notes",
          depth: 1,
          children: [
            {
              id: "shared",
              text: "Shared",
              depth: 2,
              children: [],
            },
          ],
        },
      ],
      visitUrl: null,
    })
  })

  it("builds share folder child image previews with child download routes", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "shared" })
    const image = await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "photo.png",
      mimeType: "image/png",
    })
    const share = await service.createShare("user-1", folder.id, "https://synapse.test")
    vi.mocked(storageMock.createDownloadUrl).mockClear()

    const snapshot = await service.getShareBrowserSnapshot({
      shareId: share.shareId,
      itemId: image.id,
      password: share.password ?? undefined,
    })

    expect(snapshot.preview?.kind).toBe("image")
    expect(snapshot.preview?.imageUrl).toBe(`/share/${share.shareId}/items/${image.id}/download`)
    expect(storageMock.createDownloadUrl).not.toHaveBeenCalled()
  })

  it("rejects share browser access outside the shared subtree", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "shared" })
    const outside = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "outside.txt",
      mimeType: "text/plain",
    })
    const share = await service.createShare("user-1", folder.id, "https://synapse.test")

    await expect(service.getShareBrowserSnapshot({
      shareId: share.shareId,
      itemId: outside.id,
      password: share.password ?? undefined,
    })).rejects.toBeInstanceOf(NotFoundException)
  })

  it("expires pending sessions and releases reserved quota", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
    }
    const lifecycle = { cleanupUploadSessionState: vi.fn() }
    const service = new DriveService(prisma as unknown as PrismaService, storage, undefined, lifecycle as never)
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
    expect(storage.deleteObject).toHaveBeenCalledWith(`drive/${prepared.item.id}`)
    expect(lifecycle.cleanupUploadSessionState).toHaveBeenCalledWith(prepared.sessionId)
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(0n)
  })

  it("scheduled cleanup expires pending sessions", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
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

    await expect(service.scheduledPendingUploadSessionExpiry()).resolves.toBeUndefined()

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(0n)
  })

  it("scheduled cleanup logs redacted failures without throwing", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    const warn = vi.spyOn((service as unknown as { readonly logger: Logger }).logger, "warn").mockImplementation(() => undefined)
    vi.spyOn(prisma.driveUploadSession, "findMany").mockRejectedValue(Object.assign(new Error([
      "cleanup failed",
      "Authorization: Bearer raw-bearer",
      "postgresql://user:db-password@db.local:5432/synapse",
      "/Users/liyang/project/.env",
    ].join(" ")), { code: "ECONNRESET" }) as never)

    await expect(service.scheduledPendingUploadSessionExpiry()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith({
      errorName: "Error",
      errorMessage: "cleanup failed Authorization: [REDACTED] [URL] [PATH]",
      errorCode: "ECONNRESET",
    }, "Drive pending upload session cleanup failed")
    const serialized = JSON.stringify(warn.mock.calls)
    expect(serialized).not.toContain("raw-bearer")
    expect(serialized).not.toContain("db-password")
    expect(serialized).not.toContain("/Users/liyang/project/.env")
  })

  it("scheduled cleanup retries pending storage deletes", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    const retryItems = vi.spyOn(service, "retryPendingDriveItemStorageDeletes").mockResolvedValue({ attempted: 1, deleted: 1, failed: 0 })
    const retryVersions = vi.spyOn(service, "retryPendingFileVersionDeletes").mockResolvedValue({ attempted: 2, deleted: 1, failed: 1 })

    await expect(service.scheduledPendingStorageDeleteRetry()).resolves.toBeUndefined()

    expect(retryItems).toHaveBeenCalledTimes(1)
    expect(retryVersions).toHaveBeenCalledTimes(1)
  })

  it("admin delete moves active files to trash and disables shares without deleting storage", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
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
    vi.mocked(storage.deleteObject).mockClear()

    await service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")

    await expect(service.getItem("user-1", prepared.item.id)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.resolvePublicShareAccess({ shareId: share.shareId })).rejects.toBeInstanceOf(NotFoundException)
    const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })
    expect(item).toMatchObject({
      lifecycleStatus: "trashed",
      storageStatus: "active",
      storageDeletePending: false,
    })
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(11n)
    const shareRecord = await prisma.driveShare.findFirst({ where: { id: share.id } })
    expect(shareRecord).toMatchObject({ enabled: false })
    expect(shareRecord?.disabledAt).toBeInstanceOf(Date)
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("user delete disables shares and restore does not reactivate old links", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "shared.txt",
      mimeType: "text/plain",
    })
    const share = await service.createShare("user-1", file.id, "https://synapse.test")

    await service.deleteItem("user-1", file.id)

    await expect(service.resolvePublicShareAccess({ shareId: share.shareId })).rejects.toBeInstanceOf(NotFoundException)
    await expect(prisma.driveShare.findFirst({ where: { id: share.id } })).resolves.toMatchObject({
      enabled: false,
      disabledAt: expect.any(Date),
    })

    await service.restoreItem("user-1", file.id)

    await expect(service.resolvePublicShareAccess({ shareId: share.shareId })).rejects.toBeInstanceOf(NotFoundException)
    await expect(prisma.driveShare.findFirst({ where: { id: share.id } })).resolves.toMatchObject({
      enabled: false,
      disabledAt: expect.any(Date),
    })
  })

  it("records item changes for folder create, rename, move, delete, and restore", async () => {
    const prisma = createPrismaMemory()
    const changes = { append: vi.fn(async () => ({ id: "change-1", sequence: "1" })) }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock, undefined, undefined, changes as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const target = await service.createFolder("user-1", { parentId: null, name: "目标" })
    const folder = await service.createFolder("user-1", { parentId: null, name: "资料" })

    const renamed = await service.renameItem("user-1", folder.id, "归档")
    const moved = await service.moveItem("user-1", folder.id, target.id)
    await service.deleteItem("user-1", folder.id)
    const restored = await service.restoreItem("user-1", folder.id)

    expect(renamed.name).toBe("归档")
    expect(moved.parentId).toBe(target.id)
    expect(restored.parentId).toBe(target.id)
    const changeInputs = changes.append.mock.calls.map(([input]) => input)
    expect(changeInputs).toEqual(expect.arrayContaining([expect.objectContaining({
      userId: "user-1",
      itemId: folder.id,
      parentId: null,
      type: "created",
      name: "资料",
      actor: "user-1",
    })]))
    expect(changeInputs).toEqual(expect.arrayContaining([expect.objectContaining({
      userId: "user-1",
      itemId: folder.id,
      parentId: null,
      type: "renamed",
      name: "归档",
      actor: "user-1",
    })]))
    expect(changeInputs).toEqual(expect.arrayContaining([expect.objectContaining({
      userId: "user-1",
      itemId: folder.id,
      parentId: target.id,
      type: "moved",
      name: "归档",
      actor: "user-1",
    })]))
    expect(changeInputs).toEqual(expect.arrayContaining([expect.objectContaining({
      userId: "user-1",
      itemId: folder.id,
      parentId: target.id,
      type: "trashed",
      name: "归档",
      actor: "user-1",
    })]))
    expect(changeInputs).toEqual(expect.arrayContaining([expect.objectContaining({
      userId: "user-1",
      itemId: folder.id,
      parentId: target.id,
      type: "restored",
      name: "归档",
      actor: "user-1",
    })]))
  })

  it("deleting a folder disables shares for the folder subtree", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "共享" })
    const child = await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "child.txt",
      mimeType: "text/plain",
    })
    const folderShare = await service.createShare("user-1", folder.id, "https://synapse.test")
    const childShare = await service.createShare("user-1", child.id, "https://synapse.test")

    await service.deleteItem("user-1", folder.id)

    await expect(prisma.driveShare.findFirst({ where: { id: folderShare.id } })).resolves.toMatchObject({
      enabled: false,
      disabledAt: expect.any(Date),
    })
    await expect(prisma.driveShare.findFirst({ where: { id: childShare.id } })).resolves.toMatchObject({
      enabled: false,
      disabledAt: expect.any(Date),
    })
  })

  it("redacts admin delete audit write failures in logs", async () => {
    const prisma = createPrismaMemory()
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const auditLog = { record: vi.fn(async (input: any) => {
      if (input.action === "admin.drive.delete") {
        throw new Error("audit failed Authorization: Bearer plain-token token=plain-secret Cookie: session=secret /Users/example/.env")
      }
    }) }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock, auditLog as never)
    const deleteAuditRecorder = service as unknown as {
      recordDriveDeleteAuditSafely: (input: {
        readonly adminEmail: string
        readonly action: string
        readonly targetType: string
        readonly targetId: string
        readonly detail: Record<string, unknown>
        readonly ipAddress: string
      }) => Promise<void>
    }

    try {
      await expect(deleteAuditRecorder.recordDriveDeleteAuditSafely({
        adminEmail: "admin@example.com",
        action: "admin.drive.delete",
        targetType: "drive_item",
        targetId: "item-1",
        detail: { count: 1 },
        ipAddress: "127.0.0.1",
      })).resolves.toBeUndefined()

      const warnCall = warnSpy.mock.calls.find(([, message]) => message === "Failed to record drive delete audit log")
      expect(warnCall?.[0]).toEqual(expect.objectContaining({
        action: "admin.drive.delete",
        targetType: "drive_item",
        targetId: "item-1",
        errorName: "Error",
        errorMessage: expect.stringContaining("[REDACTED]"),
      }))
      expect(JSON.stringify(warnCall)).not.toContain("plain-token")
      expect(JSON.stringify(warnCall)).not.toContain("plain-secret")
      expect(JSON.stringify(warnCall)).not.toContain("session=secret")
      expect(JSON.stringify(warnCall)).not.toContain("/Users/example/.env")
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("rejects public share access for non-active lifecycle even when share metadata is enabled", async () => {
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
    await prisma.driveItem.update({
      where: { id: prepared.item.id },
      data: { lifecycleStatus: "trashed" },
    })

    await expect(service.resolvePublicShareAccess({ shareId: share.shareId })).rejects.toBeInstanceOf(NotFoundException)
  })

  it("excludes trashed items from user-visible listings even when deletedAt is null", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const active = await service.prepareUpload("user-1", {
      parentId: null,
      name: "active.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", active.sessionId)
    const trashed = await service.prepareUpload("user-1", {
      parentId: null,
      name: "trashed.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", trashed.sessionId)
    await prisma.driveItem.update({
      where: { id: trashed.item.id },
      data: {
        lifecycleStatus: "trashed",
        trashedAt: new Date("2026-06-07T12:00:00.000Z"),
        trashedBy: "user-1",
        restoreParentId: null,
        restorePath: "trashed.txt",
        deleteRootId: trashed.item.id,
        deletedAt: null,
      },
    })

    const items = await service.listItems("user-1", null)

    expect(items.map((item) => item.id)).toEqual([active.item.id])
  })

  it("admin delete moves pending uploads to trash without releasing reserved quota", async () => {
    const prisma = createPrismaMemory()
    const auditLog = { record: vi.fn(async () => undefined) }
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage, auditLog as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "pending.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    await service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(11n)
    const session = (await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0]
    expect(session?.status).toBe("pending")
    const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })
    expect(item.deletedAt).toBeNull()
    expect(item.lifecycleStatus).toBe("trashed")
    expect(item.uploadStatus).toBe("pending")
    expect(storage.deleteObject).not.toHaveBeenCalled()
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.trash",
      detail: expect.objectContaining({
        count: 1,
      }),
    }))
  })

  it("keeps trashing when lifecycle audit recording fails", async () => {
    const prisma = createPrismaMemory()
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const auditLog = { record: vi.fn(async (input: any) => {
      if (input.action === "drive.trash") throw new Error("audit failed")
    }) }
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage, auditLog as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", prepared.sessionId)
    const currentItem = await prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })
    vi.mocked(storage.deleteObject).mockClear()

    try {
      await expect(service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")).resolves.toEqual({ ok: true })

      expect(storage.deleteObject).not.toHaveBeenCalled()
      await expect(prisma.driveItem.findUniqueOrThrow({ where: { id: currentItem.id } })).resolves.toMatchObject({ lifecycleStatus: "trashed" })
      expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({
        action: "drive.trash",
        targetType: "drive_item",
        targetId: prepared.item.id,
        errorName: "Error",
        errorMessage: "audit failed",
      }), "Failed to record drive lifecycle audit log")
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("keeps storage metadata intact when admin delete moves files to trash", async () => {
    const prisma = createPrismaMemory()
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => {
        throw new Error("delete failed Authorization: Bearer plain-token apiKey=plain-key https://user:pass@example.test/private /Users/example/file.txt")
      }),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", prepared.sessionId)
    const currentItem = await prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })
    vi.mocked(storage.deleteObject).mockClear()

    try {
      await service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")

      await expect(prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })).resolves.toMatchObject({
        lifecycleStatus: "trashed",
        storageStatus: "active",
        storageKey: currentItem.storageKey,
        storageDeletePending: false,
      })
      expect(storage.deleteObject).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalledWith(expect.anything(), "Drive storage object delete failed")
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("admin delete can trash and hide public asset backing files without deleting storage", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "logo.png",
      size: "11",
      mimeType: "image/png",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", prepared.sessionId)
    await markAsPublicAssetBacking(prisma, prepared.item.id)
    vi.mocked(storage.deleteObject).mockClear()

    await service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")
    await expect(prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })).resolves.toMatchObject({
      lifecycleStatus: "trashed",
      storageStatus: "active",
    })
    expect((await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })).usedBytes).toBe(11n)

    await service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")

    await expect(prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })).resolves.toMatchObject({
      lifecycleStatus: "hidden",
      storageStatus: "active",
    })
    expect((await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })).usedBytes).toBe(0n)
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("admin restore brings hidden files back and charges quota again", async () => {
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
    await service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")
    await service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")
    expect((await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })).usedBytes).toBe(0n)

    const restored = await service.restoreItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")

    expect(restored).toMatchObject({
      id: prepared.item.id,
      name: "handoff.txt",
    })
    expect(await prisma.driveItem.findUniqueOrThrow({ where: { id: prepared.item.id } })).toMatchObject({
      lifecycleStatus: "active",
      hiddenAt: null,
      hiddenBy: null,
      deleteRootId: null,
    })
    expect((await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })).usedBytes).toBe(11n)
  })

  it("keeps trashed items visible in admin search", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const active = await service.prepareUpload("user-1", {
      parentId: null,
      name: "report-active.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", active.sessionId)
    const deleted = await service.prepareUpload("user-1", {
      parentId: null,
      name: "report-deleted.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", deleted.sessionId)
    await service.deleteItemAsAdmin(deleted.item.id, "admin@example.com", "127.0.0.1")

    const list = await service.listAdminItems({
      pagination: { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" },
      filters: { search: "report" },
    })

    expect(list.data.map((item) => item.id)).toEqual([active.item.id, deleted.item.id])
  })

  it("returns Drive stats and a paged recursive metadata tree without reading file contents", async () => {
    const prisma = createPrismaMemory()
    const storage = { ...storageMock, getObjectStream: vi.fn(storageMock.getObjectStream) }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const work = await service.createFolder("user-1", { parentId: null, name: "Work" })
    const archive = await service.createFolder("user-1", { parentId: work.id, name: "Archive" })
    await createCompletedUpload(service, "user-1", { parentId: work.id, name: "report.md", mimeType: "text/markdown" })
    await createCompletedUpload(service, "user-1", { parentId: archive.id, name: "old.txt", mimeType: "text/plain" })

    await expect(service.getStats("user-1")).resolves.toEqual({
      itemCount: 4,
      fileCount: 2,
      folderCount: 2,
      usedBytes: "22",
      reservedBytes: "0",
      quotaBytes: "5368709120",
    })

    const tree = await service.listItemTree("user-1", { parentId: null, offset: 1, limit: 2 })

    expect(tree).toMatchObject({
      total: 4,
      fileCount: 2,
      folderCount: 2,
      hasMore: true,
      nextOffset: 3,
    })
    expect(tree.items).toHaveLength(2)
    expect(tree.items.every((item) => item.path.startsWith("Work"))).toBe(true)
    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("uses a bounded recursive query for Drive item tree pages when raw SQL is available", async () => {
    const createdAt = new Date("2026-06-07T12:00:00.000Z")
    const rows = [
      {
        id: "folder-1",
        parentId: null,
        type: "folder",
        name: "Work",
        size: 0n,
        mimeType: null,
        storageStatus: "active",
        createdAt,
        updatedAt: createdAt,
        path: "Work",
        depth: 0,
        activeShareId: null,
        total: 3n,
        fileCount: 1n,
        folderCount: 2n,
      },
      {
        id: "folder-2",
        parentId: "folder-1",
        type: "folder",
        name: "Archive",
        size: 0n,
        mimeType: null,
        storageStatus: "active",
        createdAt,
        updatedAt: createdAt,
        path: "Work/Archive",
        depth: 1,
        activeShareId: null,
        total: 3n,
        fileCount: 1n,
        folderCount: 2n,
      },
    ]
    const prisma = {
      $queryRaw: vi.fn(async () => rows),
      driveItem: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)

    const tree = await service.listItemTree("user-1", { parentId: null, offset: 0, limit: 1 })

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.driveItem.findMany).not.toHaveBeenCalled()
    expect(tree).toMatchObject({
      total: 3,
      fileCount: 1,
      folderCount: 2,
      hasMore: true,
      nextOffset: 1,
    })
    expect(tree.items).toEqual([
      expect.objectContaining({
        id: "folder-1",
        path: "Work",
        depth: 0,
      }),
    ])
  })

  it("keeps recursive item tree stats when the requested page is empty", async () => {
    const rows = [{
      id: null,
      parentId: null,
      type: null,
      name: null,
      size: null,
      mimeType: null,
      storageStatus: null,
      createdAt: null,
      updatedAt: null,
      path: null,
      depth: null,
      activeShareId: null,
      total: 3n,
      fileCount: 1n,
      folderCount: 2n,
    }]
    const prisma = {
      $queryRaw: vi.fn(async () => rows),
      driveItem: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)

    const tree = await service.listItemTree("user-1", { parentId: null, offset: 50, limit: 10 })

    expect(tree).toEqual({
      items: [],
      total: 3,
      fileCount: 1,
      folderCount: 2,
      hasMore: false,
      nextOffset: null,
    })
  })

  it("ensures nested folder paths by reusing existing folders and creating missing folders", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const work = await service.createFolder("user-1", { parentId: null, name: "Work" })

    const result = await service.ensureFolderPath("user-1", { parentId: null, segments: ["Work", "Reports"] })

    expect(result.item.name).toBe("Reports")
    expect(result.item.parentId).toBe(work.id)
    expect(result.reused.map((item) => item.id)).toEqual([work.id])
    expect(result.created.map((item) => item.name)).toEqual(["Reports"])
  })

  it("previews and applies reorganization plans with drift protection", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const inbox = await service.createFolder("user-1", { parentId: null, name: "Inbox" })
    const work = await service.createFolder("user-1", { parentId: null, name: "Work" })
    const file = await createCompletedUpload(service, "user-1", { parentId: inbox.id, name: "report.md", mimeType: "text/markdown" })

    const preview = await service.previewReorganization("user-1", {
      moves: [{ itemId: file.id, targetParentId: work.id }],
    })

    expect(preview.planId).toMatch(/^drive-reorg-/u)
    expect(preview.summary).toEqual({ moveCount: 1, skippedCount: 0, conflictCount: 0 })
    await service.renameItem("user-1", file.id, "renamed.md")
    await expect(service.applyReorganization("user-1", { planId: preview.planId }))
      .rejects.toBeInstanceOf(BadRequestException)
  })

  it("rejects reorganization plans that move same-name folders into one target", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const sourceA = await service.createFolder("user-1", { parentId: null, name: "Source A" })
    const sourceB = await service.createFolder("user-1", { parentId: null, name: "Source B" })
    const target = await service.createFolder("user-1", { parentId: null, name: "Target" })
    const first = await service.createFolder("user-1", { parentId: sourceA.id, name: "Docs" })
    const second = await service.createFolder("user-1", { parentId: sourceB.id, name: "Docs" })

    await expect(service.previewReorganization("user-1", {
      moves: [
        { itemId: first.id, targetParentId: target.id },
        { itemId: second.id, targetParentId: target.id },
      ],
    })).rejects.toThrow("目标位置已有同名文件夹。")

    const planId = "drive-reorg-same-name-folders"
    const plans = (service as unknown as {
      readonly reorganizationPlans: Map<string, {
        readonly userId: string
        readonly planId: string
        readonly expiresAt: Date
        readonly moves: Array<{
          readonly itemId: string
          readonly name: string
          readonly fromParentId: string | null
          readonly targetParentId: string | null
          readonly updatedAt: string
        }>
        readonly skipped: readonly []
      }>
    }).reorganizationPlans
    plans.set(planId, {
      userId: "user-1",
      planId,
      expiresAt: new Date(Date.now() + 60_000),
      moves: [
        { itemId: first.id, name: first.name, fromParentId: sourceA.id, targetParentId: target.id, updatedAt: first.updatedAt },
        { itemId: second.id, name: second.name, fromParentId: sourceB.id, targetParentId: target.id, updatedAt: second.updatedAt },
      ],
      skipped: [],
    })

    await expect(service.applyReorganization("user-1", { planId })).rejects.toThrow("目标位置已有同名文件夹。")
    await expect(service.getItem("user-1", first.id)).resolves.toMatchObject({ parentId: sourceA.id })
    await expect(service.getItem("user-1", second.id)).resolves.toMatchObject({ parentId: sourceB.id })
  })

  it("rejects reorganization plans that move same-name files into one target", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const sourceA = await service.createFolder("user-1", { parentId: null, name: "Source A" })
    const sourceB = await service.createFolder("user-1", { parentId: null, name: "Source B" })
    const target = await service.createFolder("user-1", { parentId: null, name: "Target" })
    const first = await createCompletedUpload(service, "user-1", { parentId: sourceA.id, name: "report.txt", mimeType: "text/plain" })
    const second = await createCompletedUpload(service, "user-1", { parentId: sourceB.id, name: "report.txt", mimeType: "text/plain" })

    await expect(service.previewReorganization("user-1", {
      moves: [
        { itemId: first.id, targetParentId: target.id },
        { itemId: second.id, targetParentId: target.id },
      ],
    })).rejects.toThrow("目标位置已有同名文件。")

    const planId = "drive-reorg-same-name-files"
    const plans = (service as unknown as {
      readonly reorganizationPlans: Map<string, {
        readonly userId: string
        readonly planId: string
        readonly expiresAt: Date
        readonly moves: Array<{
          readonly itemId: string
          readonly name: string
          readonly fromParentId: string | null
          readonly targetParentId: string | null
          readonly updatedAt: string
        }>
        readonly skipped: readonly []
      }>
    }).reorganizationPlans
    plans.set(planId, {
      userId: "user-1",
      planId,
      expiresAt: new Date(Date.now() + 60_000),
      moves: [
        { itemId: first.id, name: first.name, fromParentId: sourceA.id, targetParentId: target.id, updatedAt: first.updatedAt },
        { itemId: second.id, name: second.name, fromParentId: sourceB.id, targetParentId: target.id, updatedAt: second.updatedAt },
      ],
      skipped: [],
    })

    await expect(service.applyReorganization("user-1", { planId })).rejects.toThrow("目标位置已有同名文件。")
    await expect(service.getItem("user-1", first.id)).resolves.toMatchObject({ parentId: sourceA.id })
    await expect(service.getItem("user-1", second.id)).resolves.toMatchObject({ parentId: sourceB.id })
  })

  it("checks reorganization folder relationships with bounded parent lookups", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const source = await service.createFolder("user-1", { parentId: null, name: "Source" })
    const target = await service.createFolder("user-1", { parentId: null, name: "Target" })
    const folders: Array<{ readonly id: string }> = []
    for (let index = 0; index < 8; index += 1) {
      folders.push(await service.createFolder("user-1", { parentId: source.id, name: `Folder ${index}` }))
    }
    const findUnique = vi.spyOn(prisma.driveItem, "findUnique")

    const preview = await service.previewReorganization("user-1", {
      moves: folders.map((folder) => ({ itemId: folder.id, targetParentId: target.id })),
    })

    expect(preview.summary.moveCount).toBe(folders.length)
    expect(findUnique.mock.calls.length).toBeLessThanOrEqual(folders.length * 3)
  })

  it("applies valid reorganization plans atomically and rejects unsafe folder moves", async () => {
    const prisma = createPrismaMemory()
    const auditLog = { record: vi.fn(async (_input: any) => undefined) }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock, auditLog as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const parent = await service.createFolder("user-1", { parentId: null, name: "Parent" })
    const child = await service.createFolder("user-1", { parentId: parent.id, name: "Child" })
    const target = await service.createFolder("user-1", { parentId: null, name: "Target" })
    const file = await createCompletedUpload(service, "user-1", { parentId: parent.id, name: "report.md", mimeType: "text/markdown" })

    await expect(service.previewReorganization("user-1", {
      moves: [
        { itemId: parent.id, targetParentId: target.id },
        { itemId: child.id, targetParentId: target.id },
      ],
    })).rejects.toBeInstanceOf(BadRequestException)

    const preview = await service.previewReorganization("user-1", {
      moves: [{ itemId: file.id, targetParentId: target.id }],
    })
    await expect(service.applyReorganization("user-1", { planId: preview.planId })).resolves.toEqual({
      ok: true,
      movedCount: 1,
      skippedCount: 0,
      moves: [{ itemId: file.id, fromParentId: parent.id, targetParentId: target.id }],
    })
    await expect(service.getItem("user-1", file.id)).resolves.toMatchObject({ parentId: target.id })
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.reorganization.apply",
      targetType: "drive.item",
      targetId: preview.planId,
      detail: expect.objectContaining({
        planId: preview.planId,
        movedCount: 1,
        skippedCount: 0,
        moves: [{ itemId: file.id, fromParentId: parent.id, targetParentId: target.id }],
      }),
    }))
    const reorganizationAudit = vi.mocked(auditLog.record).mock.calls
      .map(([input]) => input)
      .find((input) => input.action === "drive.reorganization.apply")
    expect(JSON.stringify(reorganizationAudit?.detail)).not.toContain("report.md")
  })
})

async function createCompletedUpload(
  service: DriveService,
  userId: string,
  input: { readonly parentId: string | null; readonly name: string; readonly mimeType: string | null; readonly size?: string },
) {
  const prepared = await service.prepareUpload(userId, {
    parentId: input.parentId,
    name: input.name,
    size: input.size ?? "11",
    mimeType: input.mimeType,
    publicAppUrl: "https://synapse.test",
  })
  await service.completeUpload(userId, prepared.sessionId)
  return service.getItem(userId, prepared.item.id)
}

async function markAsPublicAssetBacking(prisma: ReturnType<typeof createPrismaMemory>, itemId: string) {
  return prisma.driveItem.update({
    where: { id: itemId },
    data: {
      publicAsset: {
        assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      },
    },
  })
}

function createPrismaMemory(options: { readonly staleUsageReads?: boolean } = {}) {
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
    shares: [...shares.values()]
      .filter((share) => share.itemId === item.id && share.enabled)
      .map((share) => ({ id: share.id, enabled: share.enabled, expiresAt: share.expiresAt })),
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
  const shareWhereRow = (share: any) => ({ ...share, item: items.get(share.itemId) ?? null })

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
    $executeRaw: async (_strings: TemplateStringsArray | string, requestedBytes: bigint, userId: string, requestedBytesForCheck: bigint) => {
      const usage = usages.get(userId)
      if (!usage) return 0
      if (usage.usedBytes + usage.reservedBytes + requestedBytesForCheck > usage.quotaBytes) return 0
      usage.reservedBytes += requestedBytes
      usage.updatedAt = now()
      return 1
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
        if (existing) return options.staleUsageReads ? { ...existing, reservedBytes: 0n } : existing
        usages.set(where.userId, { ...create, updatedAt: now() })
        const usage = usages.get(where.userId)
        return options.staleUsageReads ? { ...usage, reservedBytes: 0n } : usage
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
          if (where.id?.in?.includes(item.id)) {
            Object.assign(item, data, { updatedAt: now() })
            count += 1
          }
        }
        return { count }
      },
      findFirst: async ({ where, include, select, orderBy }: any) => {
        const found = orderRows([...items.values()].filter((item) => matchesWhere(driveItemWhereRow(item), where)), orderBy)[0]
        if (!found) return null
        if (select) return selectFields(found, select)
        return include ? withShares(found) : found
      },
      findMany: async (args: any = {}) => {
        const { where, select, include, orderBy, skip, take } = args
        const found = paginateRows(
          orderRows([...items.values()].filter((item) => matchesWhere(driveItemWhereRow(item), where ?? {})), orderBy),
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
      count: async ({ where }: any = {}) => [...items.values()].filter((item) => matchesWhere(driveItemWhereRow(item), where ?? {})).length,
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
        const share = [...shares.values()].find((item) => matchesWhere(shareWhereRow(item), where))
        if (!share) return null
        return withShareIncludes(share, include)
      },
      findMany: async ({ where, include, orderBy, select }: any = {}) => {
        const found = orderRows([...shares.values()].filter((share) => matchesWhere(shareWhereRow(share), where ?? {})), orderBy)
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
  function driveItemWhereRow(item: any) {
    return {
      ...item,
      uploadSessions: [...sessions.values()].filter((session) => session.itemId === item.id),
    }
  }

  return prisma
}

function matchesWhere(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === "AND") return value.every((entry: any) => matchesWhere(row, entry))
    if (key === "OR") return value.some((entry: any) => matchesWhere(row, entry))
    if (key === "NOT") return !matchesWhere(row, value)
    if (value && typeof value === "object" && "is" in value) return matchesWhere(row[key], value.is)
    if (value && typeof value === "object" && "some" in value) {
      return Array.isArray(row[key]) && row[key].some((entry) => matchesWhere(entry, value.some))
    }
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

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
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
