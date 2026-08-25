import { Readable } from "node:stream"
import { BadRequestException, NotFoundException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { DriveLifecycleService } from "./drive-lifecycle.service"
import type { DriveStoragePort } from "./drive-storage"

const storage: DriveStoragePort = {
  createUploadInstruction: vi.fn(async () => ({
    method: "PUT" as const,
    url: "https://cos.example/upload",
    expiresAt: new Date("2026-06-18T12:15:00.000Z"),
    headers: { "Content-Type": "text/plain" },
  })),
  createDownloadUrl: vi.fn(async () => ({
    url: "https://cos.example/download",
    expiresAt: new Date("2026-06-18T12:05:00.000Z"),
  })),
  headObject: vi.fn(async () => ({ key: "drive/item-file", size: 10n, etag: "etag" })),
  putObject: vi.fn(async () => undefined),
  copyObject: vi.fn(async () => undefined),
  getObjectStream: vi.fn(async () => ({ stream: Readable.from(""), size: 0n, contentType: null })),
  deleteObject: vi.fn(async () => undefined),
}

describe("DriveLifecycleService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("moves active files to trash without deleting storage objects or releasing quota", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const file = await seedActiveDriveFile(prisma, { userId: "user-1", name: "a.png", size: 10n })

    await lifecycle.trashItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(await readDriveItem(prisma, file.id)).toMatchObject({ lifecycleStatus: "trashed", storageStatus: "active" })
    expect(storage.deleteObject).not.toHaveBeenCalled()
    expect(await usedBytes(prisma, "user-1")).toBe(10n)
  })

  it("uses bounded long-running transactions across a 1000-file folder lifecycle", async () => {
    const prisma = createLifecyclePrismaMemory()
    const transaction = vi.spyOn(prisma, "$transaction")
    const changes = { append: vi.fn(async () => undefined) }
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage, undefined, changes as never)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", name: "Large folder" })
    await Promise.all(Array.from({ length: 1_000 }, (_, index) => seedActiveDriveFile(prisma, {
      userId: "user-1",
      parentId: folder.id,
      name: `file-${index}.txt`,
      size: 0n,
    })))

    await lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    await lifecycle.restoreItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })
    await lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })
    await lifecycle.hideTrashedItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(changes.append).toHaveBeenCalledTimes(3_003)
    expect(transaction).toHaveBeenCalledTimes(4)
    for (const call of transaction.mock.calls) {
      expect(call).toEqual([
        expect.any(Function),
        { maxWait: 10_000, timeout: 30_000 },
      ])
    }
  })

  it("stores trash metadata without setting deletedAt", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const file = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "a.png", size: 10n })

    await lifecycle.trashItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(await readDriveItem(prisma, file.id)).toMatchObject({
      lifecycleStatus: "trashed",
      deletedAt: null,
      deleteRootId: file.id,
      restoreParentId: folder.id,
      restorePath: "Docs/a.png",
    })
  })

  it("hides trashed files and releases user quota while keeping storage", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const file = await seedTrashedDriveFile(prisma, { userId: "user-1", name: "a.png", size: 10n })

    await lifecycle.hideTrashedItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(await readDriveItem(prisma, file.id)).toMatchObject({ lifecycleStatus: "hidden" })
    expect(storage.deleteObject).not.toHaveBeenCalled()
    expect(await usedBytes(prisma, "user-1")).toBe(0n)
  })

  it("hides and restores public asset revisions as part of quota accounting", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const file = await seedTrashedPublicAssetDriveFileWithRevision(prisma, {
      userId: "user-1",
      name: "logo.png",
      size: 12n,
      revisionSize: 8n,
    })

    await lifecycle.hideTrashedItem({
      userId: "user-1",
      itemId: file.id,
      actorId: "user-1",
      ipAddress: "127.0.0.1",
      allowPublicAsset: true,
    })

    expect(await usedBytes(prisma, "user-1")).toBe(0n)

    await lifecycle.restoreItemAsAdmin({
      userId: "user-1",
      itemId: file.id,
      actorId: "admin@example.com",
      ipAddress: "127.0.0.1",
    })

    expect(await usedBytes(prisma, "user-1")).toBe(20n)
  })

  it("hides trashed files without setting deletedAt", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const file = await seedTrashedDriveFile(prisma, { userId: "user-1", name: "a.png", size: 10n })

    await lifecycle.hideTrashedItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(await readDriveItem(prisma, file.id)).toMatchObject({
      lifecycleStatus: "hidden",
      deletedAt: null,
      hiddenBy: "user-1",
    })
  })

  it("hides trashed pending uploads and releases reserved quota without deleting storage objects", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const { item, session } = await seedTrashedPendingDriveFile(prisma, { userId: "user-1", name: "pending.png", size: 12n })

    await lifecycle.hideTrashedItem({ userId: "user-1", itemId: item.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(await readDriveItem(prisma, item.id)).toMatchObject({ lifecycleStatus: "hidden" })
    expect(await reservedBytes(prisma, "user-1")).toBe(0n)
    expect(storage.deleteObject).not.toHaveBeenCalled()
    expect(await readUploadSession(prisma, session.id)).toMatchObject({
      status: "cancelled",
      failedAt: expect.any(Date),
    })
  })

  it("rejects admin restore for hidden uploads whose session was cancelled", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const { item, session } = await seedTrashedPendingDriveFile(prisma, { userId: "user-1", name: "pending.png", size: 12n })
    await lifecycle.hideTrashedItem({ userId: "user-1", itemId: item.id, actorId: "admin@example.com", ipAddress: "127.0.0.1" })

    await expect(lifecycle.restoreItemAsAdmin({
      userId: "user-1",
      itemId: item.id,
      actorId: "admin@example.com",
      ipAddress: "127.0.0.1",
    })).rejects.toBeInstanceOf(BadRequestException)

    expect(await readDriveItem(prisma, item.id)).toMatchObject({
      lifecycleStatus: "hidden",
      storageStatus: "pending",
      uploadStatus: "cancelled",
      deleteRootId: item.id,
    })
    expect(await readUploadSession(prisma, session.id)).toMatchObject({ status: "cancelled" })
    expect(await usedBytes(prisma, "user-1")).toBe(0n)
    expect(await reservedBytes(prisma, "user-1")).toBe(0n)
  })

  it("restores to root and auto-renames when original parent is unavailable and name conflicts", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    await seedActiveDriveFile(prisma, { userId: "user-1", parentId: null, name: "a.png", size: 1n })
    const trashed = await seedTrashedDriveFile(prisma, { userId: "user-1", parentId: "missing-folder", name: "a.png", size: 1n })

    const restored = await lifecycle.restoreItem({ userId: "user-1", itemId: trashed.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(restored.parentId).toBeNull()
    expect(restored.name).toBe("a 1.png")
  })

  it("lists only trashed root items and excludes legacy missing rows", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const child = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "a.png", size: 1n })
    await lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })
    await prisma.driveItem.create({
      data: {
        userId: "user-1",
        parentId: null,
        type: "file",
        name: "legacy.png",
        size: 1n,
        mimeType: "image/png",
        storageKey: "drive/legacy.png",
        storageStatus: "deleted",
        uploadStatus: "completed",
        lifecycleStatus: "legacy_missing",
        deletedAt: new Date("2026-06-18T12:00:00.000Z"),
      },
    })

    const trash = await lifecycle.listTrash("user-1")

    expect(trash.items.map((item) => item.id)).toEqual([folder.id])
    expect(trash.items.map((item) => item.id)).not.toContain(child.id)
    expect(trash.total).toBe(1)
  })

  it("pushes trash root filtering and pagination into the query layer", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const first = await seedTrashedDriveFile(prisma, { userId: "user-1", name: "first.png", size: 1n })
    const second = await seedTrashedDriveFile(prisma, { userId: "user-1", name: "second.png", size: 1n })
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const child = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "child.png", size: 1n })
    await lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    const trash = await lifecycle.listTrash("user-1", { offset: 1, limit: 1 })

    expect(trash.items).toHaveLength(1)
    expect(trash.items.map((item) => item.id)).not.toContain(child.id)
    expect(trash.total).toBe(3)
    const queryRawCalls = prisma.__queryRawCalls() as Array<{ readonly sql: string; readonly values: readonly unknown[] }>
    expect(queryRawCalls).toHaveLength(2)
    expect(queryRawCalls[0]?.sql).toContain('di."deleteRootId" = di.id')
    expect(queryRawCalls[0]?.values).toEqual(expect.arrayContaining(["user-1", 2, 1]))
    expect(queryRawCalls[1]?.sql).toContain('COUNT(*)')
    expect(queryRawCalls[1]?.sql).toContain('di."deleteRootId" = di.id')
    expect([first.id, second.id, folder.id]).toContain(trash.items[0]?.id)
  })

  it("searches trash with literal percent and underscore characters", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const percentFile = await seedTrashedDriveFile(prisma, { userId: "user-1", name: "budget 100%.png", size: 1n })
    const underscoreFile = await seedTrashedDriveFile(prisma, { userId: "user-1", name: "_draft.png", size: 1n })
    await seedTrashedDriveFile(prisma, { userId: "user-1", name: "budget 1000.png", size: 1n })
    await seedTrashedDriveFile(prisma, { userId: "user-1", name: "xdraft.png", size: 1n })

    await expect(lifecycle.listTrash("user-1", { search: "100%" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: percentFile.id })],
      total: 1,
    })
    await expect(lifecycle.listTrash("user-1", { search: "_draft" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: underscoreFile.id })],
      total: 1,
    })

    const queryRawCalls = prisma.__queryRawCalls() as Array<{ readonly sql: string; readonly values: readonly unknown[] }>
    expect(queryRawCalls.some((call) => call.sql.includes("ESCAPE"))).toBe(true)
    expect(queryRawCalls.some((call) => call.values.includes("%100\\%%"))).toBe(true)
    expect(queryRawCalls.some((call) => call.values.includes("%\\_draft%"))).toBe(true)
  })

  it("restores trashed roots and clears trash metadata", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const file = await seedTrashedDriveFile(prisma, { userId: "user-1", name: "a.png", size: 10n })

    await lifecycle.restoreItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(await readDriveItem(prisma, file.id)).toMatchObject({
      lifecycleStatus: "active",
      trashedAt: null,
      trashedBy: null,
      hiddenAt: null,
      hiddenBy: null,
      restoreParentId: null,
      restorePath: null,
      deleteRootId: null,
      deletedAt: null,
    })
    expect(await usedBytes(prisma, "user-1")).toBe(10n)
  })

  it("rejects hidden item restore from the ordinary lifecycle path", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const file = await seedTrashedDriveFile(prisma, { userId: "user-1", name: "a.png", size: 10n })
    await lifecycle.hideTrashedItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    await expect(lifecycle.restoreItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(NotFoundException)
  })

  it("admin restore brings hidden public assets back without renaming duplicates", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    await seedActiveDriveFile(prisma, { userId: "user-1", parentId: null, name: "logo.png", size: 1n })
    const file = await seedHiddenPublicAssetDriveFile(prisma, {
      userId: "user-1",
      parentId: null,
      name: "logo.png",
      size: 10n,
    })

    const restored = await lifecycle.restoreItemAsAdmin({
      userId: "user-1",
      itemId: file.id,
      actorId: "admin@example.com",
      ipAddress: "127.0.0.1",
    })

    expect(restored).toMatchObject({
      id: file.id,
      name: "logo.png",
      storageStatus: "active",
    })
    expect(await readDriveItem(prisma, file.id)).toMatchObject({
      lifecycleStatus: "active",
      name: "logo.png",
      hiddenAt: null,
      hiddenBy: null,
      deleteRootId: null,
    })
    expect(await usedBytes(prisma, "user-1")).toBe(11n)
  })

  it("rejects restore and hide for non-root children in a trashed subtree", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const child = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "a.png", size: 10n })
    await lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    await expect(lifecycle.restoreItem({ userId: "user-1", itemId: child.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(NotFoundException)
    await expect(lifecycle.hideTrashedItem({ userId: "user-1", itemId: child.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(NotFoundException)
  })

  it("keeps hidden children hidden when trashing and restoring an active parent", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const activeChild = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "a.png", size: 5n })
    const hiddenChild = await seedHiddenDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "hidden.png", size: 7n })

    await lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(await readDriveItem(prisma, hiddenChild.id)).toMatchObject({
      lifecycleStatus: "hidden",
      deleteRootId: hiddenChild.id,
    })
    expect(await usedBytes(prisma, "user-1")).toBe(5n)

    await lifecycle.restoreItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(await readDriveItem(prisma, folder.id)).toMatchObject({ lifecycleStatus: "active" })
    expect(await readDriveItem(prisma, activeChild.id)).toMatchObject({ lifecycleStatus: "active" })
    expect(await readDriveItem(prisma, hiddenChild.id)).toMatchObject({
      lifecycleStatus: "hidden",
      deleteRootId: hiddenChild.id,
    })
    expect(await usedBytes(prisma, "user-1")).toBe(5n)
  })

  it("keeps hidden descendants out of quota release when hiding a trashed root", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const activeChild = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "a.png", size: 5n })
    const hiddenChild = await seedHiddenDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "hidden.png", size: 7n })

    await lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })
    await lifecycle.hideTrashedItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(await readDriveItem(prisma, folder.id)).toMatchObject({ lifecycleStatus: "hidden" })
    expect(await readDriveItem(prisma, activeChild.id)).toMatchObject({ lifecycleStatus: "hidden" })
    expect(await readDriveItem(prisma, hiddenChild.id)).toMatchObject({
      lifecycleStatus: "hidden",
      deleteRootId: hiddenChild.id,
    })
    expect(await usedBytes(prisma, "user-1")).toBe(0n)
  })

  it("rolls back trash when an included descendant is no longer active during update", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const child = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "a.png", size: 10n })
    prisma.__beforeNextDriveItemUpdateMany(async () => {
      await prisma.driveItem.update({ where: { id: child.id }, data: { lifecycleStatus: "hidden", hiddenAt: new Date("2026-06-18T12:00:00.000Z") } })
    })

    await expect(lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(NotFoundException)

    expect(await readDriveItem(prisma, folder.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
    expect(await readDriveItem(prisma, child.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
    expect(await usedBytes(prisma, "user-1")).toBe(10n)
  })

  it("rolls back trash when a matching child appears after subtree collection", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const child = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "a.png", size: 10n })
    prisma.__beforeNextDriveItemUpdateMany(async () => {
      await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "late.png", size: 1n })
    })

    await expect(lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toThrow("文件夹内容已发生变化，请刷新后重试。")

    expect(await readDriveItem(prisma, folder.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
    expect(await readDriveItem(prisma, child.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
    expect(await usedBytes(prisma, "user-1")).toBe(10n)
  })

  it("rejects a malformed subtree that crosses user ownership", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const foreignChild = await seedActiveDriveFile(prisma, { userId: "user-2", parentId: folder.id, name: "foreign.png", size: 1n })

    await expect(lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(BadRequestException)

    expect(await readDriveItem(prisma, folder.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
    expect(await readDriveItem(prisma, foreignChild.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
  })

  it("rejects a restore path that crosses user ownership", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const foreignFolder = await seedActiveDriveFolder(prisma, { userId: "user-2", parentId: null, name: "Foreign" })
    const file = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: foreignFolder.id, name: "a.png", size: 1n })

    await expect(lifecycle.trashItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(BadRequestException)

    expect(await readDriveItem(prisma, file.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
  })

  it("rejects cyclic folder descendants without looping", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const child = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: folder.id, name: "Nested" })
    await prisma.driveItem.update({ where: { id: folder.id }, data: { parentId: child.id } })
    const findMany = prisma.driveItem.findMany
    let findManyCalls = 0
    vi.spyOn(prisma.driveItem, "findMany").mockImplementation(async (args: unknown) => {
      findManyCalls += 1
      if (findManyCalls > 8) throw new Error("subtree traversal did not terminate")
      return findMany(args)
    })

    await expect(lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(BadRequestException)

    expect(findManyCalls).toBeLessThanOrEqual(4)
    expect(await readDriveItem(prisma, folder.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
    expect(await readDriveItem(prisma, child.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
  })

  it("rejects cyclic restore ancestry without looping", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const first = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "First" })
    const second = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: first.id, name: "Second" })
    const file = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: first.id, name: "a.png", size: 1n })
    await prisma.driveItem.update({ where: { id: first.id }, data: { parentId: second.id } })
    const findUnique = prisma.driveItem.findUnique
    let findUniqueCalls = 0
    vi.spyOn(prisma.driveItem, "findUnique").mockImplementation(async (args: unknown) => {
      findUniqueCalls += 1
      if (findUniqueCalls > 8) throw new Error("restore path traversal did not terminate")
      return findUnique(args)
    })

    await expect(lifecycle.trashItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(BadRequestException)

    expect(findUniqueCalls).toBeLessThanOrEqual(3)
    expect(await readDriveItem(prisma, file.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
  })

  it("trashes and restores a 128-level folder tree without recursive stack growth", async () => {
    const prisma = createLifecyclePrismaMemory()
    const changes = { append: vi.fn(async () => undefined) }
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage, undefined, changes as never)
    const root = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Level 0" })
    let parentId = root.id
    for (let index = 1; index < 128; index += 1) {
      const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId, name: `Level ${index}` })
      parentId = folder.id
    }
    const file = await seedActiveDriveFile(prisma, { userId: "user-1", parentId, name: "sentinel.txt", size: 1n })

    await lifecycle.trashItem({ userId: "user-1", itemId: root.id, actorId: "user-1", ipAddress: "127.0.0.1" })
    await lifecycle.restoreItem({ userId: "user-1", itemId: root.id, actorId: "user-1", ipAddress: "127.0.0.1" })

    expect(changes.append).toHaveBeenCalledTimes(258)
    expect(await readDriveItem(prisma, root.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
    expect(await readDriveItem(prisma, file.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
  })

  it("rolls back the whole subtree when change-log persistence fails", async () => {
    const prisma = createLifecyclePrismaMemory()
    const changes = {
      append: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("change log unavailable")),
    }
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage, undefined, changes as never)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const child = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "a.png", size: 1n })

    await expect(lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toThrow("change log unavailable")

    expect(await readDriveItem(prisma, folder.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
    expect(await readDriveItem(prisma, child.id)).toMatchObject({ lifecycleStatus: "active", deleteRootId: null })
  })

  it("rolls back hide and quota release when a trashed descendant changes during update", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const child = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "a.png", size: 10n })
    await lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })
    prisma.__beforeNextDriveItemUpdateMany(async () => {
      await prisma.driveItem.update({ where: { id: child.id }, data: { lifecycleStatus: "hidden", hiddenAt: new Date("2026-06-18T12:00:00.000Z") } })
    })

    await expect(lifecycle.hideTrashedItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(NotFoundException)

    expect(await readDriveItem(prisma, folder.id)).toMatchObject({ lifecycleStatus: "trashed", deleteRootId: folder.id })
    expect(await readDriveItem(prisma, child.id)).toMatchObject({ lifecycleStatus: "trashed", deleteRootId: folder.id })
    expect(await usedBytes(prisma, "user-1")).toBe(10n)
  })

  it("rolls back restore when a trashed descendant leaves the deleted tree during update", async () => {
    const prisma = createLifecyclePrismaMemory()
    const lifecycle = new DriveLifecycleService(prisma as unknown as PrismaService, storage)
    const folder = await seedActiveDriveFolder(prisma, { userId: "user-1", parentId: null, name: "Docs" })
    const child = await seedActiveDriveFile(prisma, { userId: "user-1", parentId: folder.id, name: "a.png", size: 10n })
    await lifecycle.trashItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" })
    prisma.__beforeNextDriveItemUpdateMany(async () => {
      await prisma.driveItem.update({ where: { id: child.id }, data: { lifecycleStatus: "hidden", hiddenAt: new Date("2026-06-18T12:00:00.000Z") } })
    })

    await expect(lifecycle.restoreItem({ userId: "user-1", itemId: folder.id, actorId: "user-1", ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(NotFoundException)

    expect(await readDriveItem(prisma, folder.id)).toMatchObject({ lifecycleStatus: "trashed", deleteRootId: folder.id })
    expect(await readDriveItem(prisma, child.id)).toMatchObject({ lifecycleStatus: "trashed", deleteRootId: folder.id })
    expect(await usedBytes(prisma, "user-1")).toBe(10n)
  })
})

type SeedDriveFileInput = {
  readonly userId: string
  readonly parentId?: string | null
  readonly name: string
  readonly size: bigint
}

async function seedActiveDriveFolder(
  prisma: ReturnType<typeof createLifecyclePrismaMemory>,
  input: { readonly userId: string; readonly parentId?: string | null; readonly name: string },
) {
  await ensureUsage(prisma, input.userId, 0n)
  return prisma.driveItem.create({
    data: {
      userId: input.userId,
      parentId: input.parentId ?? null,
      type: "folder",
      name: input.name,
      size: 0n,
      mimeType: null,
      storageKey: null,
      storageStatus: "active",
      uploadStatus: "completed",
      lifecycleStatus: "active",
      deletedAt: null,
    },
  })
}

async function seedActiveDriveFile(prisma: ReturnType<typeof createLifecyclePrismaMemory>, input: SeedDriveFileInput) {
  await ensureUsage(prisma, input.userId, input.size)
  return prisma.driveItem.create({
    data: {
      userId: input.userId,
      parentId: input.parentId ?? null,
      type: "file",
      name: input.name,
      size: input.size,
      mimeType: "image/png",
      storageKey: `drive/${input.userId}/${input.name}`,
      storageStatus: "active",
      uploadStatus: "completed",
      lifecycleStatus: "active",
      deletedAt: null,
    },
  })
}

async function seedTrashedDriveFile(prisma: ReturnType<typeof createLifecyclePrismaMemory>, input: SeedDriveFileInput) {
  const item = await seedActiveDriveFile(prisma, input)
  return prisma.driveItem.update({
    where: { id: item.id },
    data: {
      lifecycleStatus: "trashed",
      trashedAt: new Date("2026-06-18T12:00:00.000Z"),
      trashedBy: input.userId,
      restoreParentId: input.parentId ?? null,
      restorePath: input.name,
      deleteRootId: item.id,
    },
  })
}

async function seedTrashedPendingDriveFile(prisma: ReturnType<typeof createLifecyclePrismaMemory>, input: SeedDriveFileInput) {
  await ensureUsage(prisma, input.userId, 0n)
  const item = await prisma.driveItem.create({
    data: {
      userId: input.userId,
      parentId: input.parentId ?? null,
      type: "file",
      name: input.name,
      size: input.size,
      mimeType: "image/png",
      storageKey: `drive/${input.userId}/${input.name}`,
      storageStatus: "pending",
      uploadStatus: "pending",
      lifecycleStatus: "trashed",
      trashedAt: new Date("2026-06-18T12:00:00.000Z"),
      trashedBy: input.userId,
      restoreParentId: input.parentId ?? null,
      restorePath: input.name,
      deletedAt: null,
    },
  })
  await prisma.driveItem.update({ where: { id: item.id }, data: { deleteRootId: item.id } })
  const session = await prisma.driveUploadSession.create({
    data: {
      userId: input.userId,
      itemId: item.id,
      storageKey: item.storageKey,
      expectedName: input.name,
      expectedSize: input.size,
      expectedMime: "image/png",
      reservedBytes: input.size,
      status: "pending",
      credentialKind: "presigned_put",
      expiresAt: new Date("2026-06-18T12:15:00.000Z"),
    },
  })
  await prisma.driveUsage.update({ where: { userId: input.userId }, data: { reservedBytes: { increment: input.size } } })
  return { item, session }
}

async function seedHiddenDriveFile(prisma: ReturnType<typeof createLifecyclePrismaMemory>, input: SeedDriveFileInput) {
  const item = await seedActiveDriveFile(prisma, input)
  await prisma.driveUsage.update({ where: { userId: input.userId }, data: { usedBytes: { decrement: input.size } } })
  return prisma.driveItem.update({
    where: { id: item.id },
    data: {
      lifecycleStatus: "hidden",
      hiddenAt: new Date("2026-06-18T12:00:00.000Z"),
      hiddenBy: input.userId,
      restoreParentId: input.parentId ?? null,
      restorePath: input.name,
      deleteRootId: item.id,
    },
  })
}

async function seedHiddenPublicAssetDriveFile(prisma: ReturnType<typeof createLifecyclePrismaMemory>, input: SeedDriveFileInput) {
  const item = await seedHiddenDriveFile(prisma, input)
  return prisma.driveItem.update({
    where: { id: item.id },
    data: {
      publicAsset: { assetId: `asset_${item.id}` },
    },
  })
}

async function seedTrashedPublicAssetDriveFileWithRevision(
  prisma: ReturnType<typeof createLifecyclePrismaMemory>,
  input: SeedDriveFileInput & { readonly revisionSize: bigint },
) {
  const item = await seedTrashedDriveFile(prisma, input)
  const publicAssetId = `asset_${item.id}`
  const updated = await prisma.driveItem.update({
    where: { id: item.id },
    data: { publicAsset: { assetId: publicAssetId } },
  })
  await prisma.publicAssetRevision.create({
    data: {
      assetId: publicAssetId,
      publicAssetId,
      itemId: item.id,
      storageKey: `drive/${input.userId}/${input.name}.old`,
      name: input.name,
      originalName: input.name,
      size: input.revisionSize,
      mimeType: "image/png",
    },
  })
  await prisma.driveUsage.update({ where: { userId: input.userId }, data: { usedBytes: { increment: input.revisionSize } } })
  return updated
}

async function readDriveItem(prisma: ReturnType<typeof createLifecyclePrismaMemory>, itemId: string) {
  return prisma.driveItem.findUniqueOrThrow({ where: { id: itemId } })
}

async function usedBytes(prisma: ReturnType<typeof createLifecyclePrismaMemory>, userId: string) {
  const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId } })
  return usage.usedBytes
}

async function reservedBytes(prisma: ReturnType<typeof createLifecyclePrismaMemory>, userId: string) {
  const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId } })
  return usage.reservedBytes
}

async function readUploadSession(prisma: ReturnType<typeof createLifecyclePrismaMemory>, sessionId: string) {
  const session = await prisma.driveUploadSession.findFirst({ where: { id: sessionId } })
  if (!session) throw new Error("session not found")
  return session
}

async function ensureUsage(prisma: ReturnType<typeof createLifecyclePrismaMemory>, userId: string, increment: bigint) {
  await prisma.driveUsage.upsert({
    where: { userId },
    create: { userId, usedBytes: 0n, reservedBytes: 0n, quotaBytes: 1000n },
    update: {},
  })
  if (increment > 0n) {
    await prisma.driveUsage.update({ where: { userId }, data: { usedBytes: { increment } } })
  }
}

function createLifecyclePrismaMemory() {
  let nextId = 1
  const items = new Map<string, any>()
  const sessions = new Map<string, any>()
  const usages = new Map<string, any>()
  const publicAssetRevisions = new Map<string, any>()
  const now = () => new Date("2026-06-18T12:00:00.000Z")
  const id = () => `item-${nextId++}`
  let beforeNextDriveItemUpdateMany: ((args: any) => Promise<void> | void) | null = null
  const queryRawCalls: Array<{ readonly sql: string; readonly values: readonly unknown[] }> = []
  const prisma: any = {
    __beforeNextDriveItemUpdateMany: (hook: (args: any) => Promise<void> | void) => {
      beforeNextDriveItemUpdateMany = hook
    },
    __queryRawCalls: () => queryRawCalls,
    $queryRaw: async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
      const sql = sqlText(strings, values)
      const flattenedValues = flattenSqlValues(values)
      queryRawCalls.push({ sql, values: flattenedValues })
      const userId = flattenedValues.find((value): value is string => typeof value === "string")
      const search = flattenedValues.find((value): value is string => typeof value === "string" && value.startsWith("%") && value.endsWith("%"))
      const literalSearch = search ? unescapeLikePattern(search.slice(1, -1)).toLowerCase() : undefined
      const rootTrashItems = orderRows(
        [...items.values()].filter((item) =>
          item.userId === userId &&
          item.lifecycleStatus === "trashed" &&
          item.deleteRootId === item.id &&
          (!literalSearch || item.name.toLowerCase().includes(literalSearch) || (item.restorePath ?? "").toLowerCase().includes(literalSearch) || (item.publicAsset?.assetId ?? "").toLowerCase().includes(literalSearch))),
        [{ trashedAt: "desc" }, { updatedAt: "desc" }],
      )
      if (sql.includes("COUNT(*)")) return [{ total: BigInt(rootTrashItems.length) }]
      const [limit = rootTrashItems.length, offset = 0] = flattenedValues.filter((value): value is number => typeof value === "number")
      return rootTrashItems.slice(offset, offset + limit)
    },
    $transaction: async (input: any) => {
      if (typeof input !== "function") return Promise.all(input)
      const itemSnapshot = cloneMap(items)
      const sessionSnapshot = cloneMap(sessions)
      const usageSnapshot = cloneMap(usages)
      const publicAssetRevisionSnapshot = cloneMap(publicAssetRevisions)
      try {
        return await input(prisma)
      } catch (error) {
        restoreMap(items, itemSnapshot)
        restoreMap(sessions, sessionSnapshot)
        restoreMap(usages, usageSnapshot)
        restoreMap(publicAssetRevisions, publicAssetRevisionSnapshot)
        throw error
      }
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
        if (data.usedBytes?.increment) usage.usedBytes += data.usedBytes.increment
        if (data.usedBytes?.decrement) usage.usedBytes -= data.usedBytes.decrement
        if (data.reservedBytes?.increment) usage.reservedBytes += data.reservedBytes.increment
        if (data.reservedBytes?.decrement) usage.reservedBytes -= data.reservedBytes.decrement
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
      create: async ({ data }: any) => {
        const item = {
          id: id(),
          ...data,
          restoreParentId: data.restoreParentId ?? null,
          restorePath: data.restorePath ?? null,
          deleteRootId: data.deleteRootId ?? null,
          trashedAt: data.trashedAt ?? null,
          trashedBy: data.trashedBy ?? null,
          hiddenAt: data.hiddenAt ?? null,
          hiddenBy: data.hiddenBy ?? null,
          objectMissing: data.objectMissing ?? false,
          storageDeletePending: data.storageDeletePending ?? false,
          publicAsset: data.publicAsset ?? null,
          createdAt: now(),
          updatedAt: now(),
        }
        items.set(item.id, item)
        return item
      },
      update: async ({ where, data }: any) => {
        const item = items.get(where.id)
        if (!item) throw new Error("item not found")
        Object.assign(item, data, { updatedAt: now() })
        return item
      },
      updateMany: async ({ where, data }: any) => {
        if (beforeNextDriveItemUpdateMany) {
          const hook = beforeNextDriveItemUpdateMany
          beforeNextDriveItemUpdateMany = null
          await hook({ where, data })
        }
        let count = 0
        for (const item of items.values()) {
          if (matchesWhere(item, where)) {
            Object.assign(item, data, { updatedAt: now() })
            count += 1
          }
        }
        return { count }
      },
      findFirst: async ({ where, orderBy }: any) => orderRows([...items.values()].filter((item) => matchesWhere(item, where ?? {})), orderBy)[0] ?? null,
      findMany: async ({ where, orderBy }: any = {}) => orderRows([...items.values()].filter((item) => matchesWhere(item, where ?? {})), orderBy),
      findUnique: async ({ where }: any) => items.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => {
        const item = items.get(where.id)
        if (!item) throw new Error("item not found")
        return item
      },
    },
    driveShare: {
      updateMany: async () => ({ count: 0 }),
    },
    driveUploadSession: {
      create: async ({ data }: any) => {
        const session = {
          id: data.id ?? id(),
          ...data,
          reservedBytes: data.reservedBytes ?? data.expectedSize,
          completedAt: data.completedAt ?? null,
          failedAt: data.failedAt ?? null,
          createdAt: now(),
          updatedAt: now(),
        }
        sessions.set(session.id, session)
        return session
      },
      findFirst: async ({ where, select }: any = {}) => {
        const session = [...sessions.values()].find((item) => matchesWhere(item, where ?? {})) ?? null
        if (!session) return null
        return select ? selectFields(session, select) : session
      },
      findMany: async ({ where, select }: any = {}) => {
        const found = [...sessions.values()].filter((session) => matchesWhere(session, where ?? {}))
        return select ? found.map((session) => selectFields(session, select)) : found
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const session of sessions.values()) {
          if (matchesWhere(session, where ?? {})) {
            Object.assign(session, data, { updatedAt: now() })
            count += 1
          }
        }
        return { count }
      },
    },
    publicAssetRevision: {
      aggregate: async ({ where }: any = {}) => {
        const rows = [...publicAssetRevisions.values()].filter((revision) => matchesWhere(revision, where ?? {}))
        return {
          _count: { _all: rows.length },
          _sum: { size: rows.reduce((sum, revision) => sum + revision.size, 0n) },
        }
      },
      create: async ({ data }: any) => {
        const revision = {
          id: data.id ?? id(),
          ...data,
          etag: data.etag ?? null,
          replacedBy: data.replacedBy ?? null,
          createdAt: now(),
          replacedAt: now(),
        }
        publicAssetRevisions.set(revision.id, revision)
        return revision
      },
    },
  }
  return prisma
}

function matchesWhere(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const condition = value as { readonly in?: readonly unknown[]; readonly not?: unknown }
      if (condition.in) return condition.in.includes(row[key])
      if ("not" in condition) return row[key] !== condition.not
    }
    return row[key] === value
  })
}

function orderRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy]
  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      const [field, direction] = Object.entries(clause)[0]!
      const result = left[field] > right[field] ? 1 : left[field] < right[field] ? -1 : 0
      if (result !== 0) return direction === "desc" ? -result : result
    }
    return 0
  })
}

function unescapeLikePattern(value: string): string {
  return value.replace(/\\([\\%_])/g, "$1")
}

function sqlText(strings: TemplateStringsArray | string, values: readonly unknown[]): string {
  if (!Array.isArray(strings)) return String(strings)
  return strings.reduce((text, part, index) => {
    const value = values[index]
    return `${text}${part}${isPrismaSql(value) ? value.strings.join("?") : "?"}`
  }, "")
}

function flattenSqlValues(values: readonly unknown[]): readonly unknown[] {
  return values.flatMap((value) => isPrismaSql(value) ? value.values : [value])
}

function isPrismaSql(value: unknown): value is { readonly strings: readonly string[]; readonly values: readonly unknown[] } {
  return typeof value === "object"
    && value !== null
    && Array.isArray((value as { readonly strings?: unknown }).strings)
    && Array.isArray((value as { readonly values?: unknown }).values)
}

function selectFields(row: any, select: Record<string, boolean>) {
  return Object.fromEntries(Object.entries(select).filter(([, enabled]) => enabled).map(([key]) => [key, row[key]]))
}

function cloneMap(source: Map<string, any>) {
  return new Map([...source.entries()].map(([key, value]) => [key, { ...value }]))
}

function restoreMap(target: Map<string, any>, source: Map<string, any>) {
  target.clear()
  for (const [key, value] of source.entries()) target.set(key, value)
}
