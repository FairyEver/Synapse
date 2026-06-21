import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { Readable } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { DrivePublicAssetService } from "./drive-public-asset.service"
import type { DriveStoragePort } from "./drive-storage"
import { DRIVE_ITEM_LIFECYCLE_STATUS } from "./drive.constants"

describe("DrivePublicAssetService", () => {
  let prisma: ReturnType<typeof createPrismaMemory>
  let storage: DriveStoragePort
  let objects: Map<string, { readonly body: Buffer; readonly contentType?: string | null }>
  let service: DrivePublicAssetService
  let lifecycle: LifecycleMemory

  beforeEach(async () => {
    prisma = createPrismaMemory()
    objects = new Map()
    storage = createStorageMemory(objects)
    lifecycle = createLifecycleMemory(prisma)
    service = new DrivePublicAssetService(prisma as unknown as PrismaService, storage, undefined, lifecycle as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  })

  it("creates a public asset through prepare and complete", async () => {
    const prepared = await service.prepareUpload("user-1", {
      name: "logo.png",
      size: "8",
      mimeType: "image/png",
      publicAppUrl: "https://synapse.example",
    })
    await storage.putObject({ key: await storageKeyForSession(prisma, prepared.sessionId), body: pngSignatureBuffer(), contentType: "image/png" })

    const completed = await service.completeUpload("user-1", prepared.sessionId, { ipAddress: "127.0.0.1" })

    expect(completed.url).toMatch(/^https:\/\/synapse\.example\/files\/asset_[0-9A-Za-z]{32}$/u)
    expect(completed.name).toBe("logo.png")
  })

  it("cleans public app URL cache through upload session lifecycle cleanup", async () => {
    const prepared = await service.prepareUpload("user-1", {
      name: "logo.png",
      size: "8",
      mimeType: "image/png",
      publicAppUrl: "https://synapse.example",
    })

    expect(publicAppUrlCacheSize(service)).toBe(1)

    lifecycle.cleanupUploadSessionState(prepared.sessionId)

    expect(publicAppUrlCacheSize(service)).toBe(0)
  })

  it("creates a public asset with a display name that has no image extension", async () => {
    const prepared = await service.prepareUpload("user-1", {
      name: "logo",
      size: "8",
      mimeType: "image/png",
      publicAppUrl: "https://synapse.example",
    })
    await storage.putObject({ key: await storageKeyForSession(prisma, prepared.sessionId), body: pngSignatureBuffer(), contentType: "image/png" })

    const completed = await service.completeUpload("user-1", prepared.sessionId, { ipAddress: "127.0.0.1" })

    expect(completed.name).toBe("logo")
    expect(completed.mimeType).toBe("image/png")
  })

  it("rejects public asset upload prepare when MIME is not an image", async () => {
    await expect(service.prepareUpload("user-1", {
      name: "logo",
      size: "8",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.example",
    })).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.prepareUpload("user-1", {
      name: "logo",
      size: "8",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.example",
    })).rejects.toThrow("仅支持图片。")
    expect(await prisma.driveUploadSession.findMany()).toEqual([])
  })

  it("creates separate assets and drive files when the same name is uploaded twice", async () => {
    const firstPrepared = await service.prepareUpload("user-1", {
      name: "logo.png",
      size: "8",
      mimeType: "image/png",
      publicAppUrl: "https://synapse.example",
    })
    await storage.putObject({ key: await storageKeyForSession(prisma, firstPrepared.sessionId), body: pngSignatureBuffer(), contentType: "image/png" })
    const first = await service.completeUpload("user-1", firstPrepared.sessionId, { publicAppUrl: "https://synapse.example" })

    const secondPrepared = await service.prepareUpload("user-1", {
      name: "logo.png",
      size: "8",
      mimeType: "image/png",
      publicAppUrl: "https://synapse.example",
    })
    await storage.putObject({ key: await storageKeyForSession(prisma, secondPrepared.sessionId), body: pngSignatureBuffer(), contentType: "image/png" })
    const second = await service.completeUpload("user-1", secondPrepared.sessionId, { publicAppUrl: "https://synapse.example" })

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(second.assetId).not.toBe(first.assetId)
    expect(second.itemId).not.toBe(first.itemId)
    expect(second.url).not.toBe(first.url)
    expect([...prisma.__debug.publicAssets.values()]).toHaveLength(2)
    expect([...prisma.__debug.items.values()]).toHaveLength(2)
    expect(usage.usedBytes).toBe(16n)
    expect(usage.reservedBytes).toBe(0n)
  })

  it("returns the current asset when public asset upload completion is retried", async () => {
    const prepared = await service.prepareUpload("user-1", {
      name: "logo.png",
      size: "8",
      mimeType: "image/png",
      publicAppUrl: "https://synapse.example",
    })
    const storageKey = await storageKeyForSession(prisma, prepared.sessionId)
    await storage.putObject({ key: storageKey, body: pngSignatureBuffer(), contentType: "image/png" })

    const completed = await service.completeUpload("user-1", prepared.sessionId, { ipAddress: "127.0.0.1", publicAppUrl: "https://synapse.example" })
    const retried = await service.completeUpload("user-1", prepared.sessionId, { ipAddress: "127.0.0.1", publicAppUrl: "https://synapse.example" })

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(retried).toMatchObject({ assetId: completed.assetId, name: "logo.png", url: completed.url })
    expect(usage.usedBytes).toBe(8n)
    expect(usage.reservedBytes).toBe(0n)
    expect(objects.has(storageKey)).toBe(true)
  })

  it("replaces content without changing assetId", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })
    const prepared = await service.prepareReplace("user-1", asset.assetId, {
      name: "logo.webp",
      size: "12",
      mimeType: "image/webp",
    })
    await storage.putObject({ key: await storageKeyForSession(prisma, prepared.sessionId), body: webpSignatureBuffer(), contentType: "image/webp" })

    const replaced = await service.completeReplace("user-1", asset.assetId, prepared.sessionId, { ipAddress: "127.0.0.1" })

    expect(replaced.assetId).toBe(asset.assetId)
    expect(replaced.name).toBe("logo.webp")
  })

  it("rejects public asset replace prepare when MIME does not match the extension", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })

    await expect(service.prepareReplace("user-1", asset.assetId, {
      name: "logo.png",
      size: "8",
      mimeType: "image/jpeg",
    })).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.prepareReplace("user-1", asset.assetId, {
      name: "logo.png",
      size: "8",
      mimeType: "image/jpeg",
    })).rejects.toThrow("文件类型与扩展名不匹配。")
    expect(await prisma.driveUploadSession.findMany()).toEqual([])
  })

  it("returns the current asset when public asset replace completion is retried", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })
    const oldStorageKey = asset.storageKey
    objects.set(oldStorageKey, { body: pngSignatureBuffer(), contentType: "image/png" })
    const prepared = await service.prepareReplace("user-1", asset.assetId, {
      name: "logo.webp",
      size: "12",
      mimeType: "image/webp",
      publicAppUrl: "https://assets.example",
    })
    const newStorageKey = await storageKeyForSession(prisma, prepared.sessionId)
    await storage.putObject({ key: newStorageKey, body: webpSignatureBuffer(), contentType: "image/webp" })

    const replaced = await service.completeReplace("user-1", asset.assetId, prepared.sessionId, { ipAddress: "127.0.0.1", publicAppUrl: "https://assets.example" })
    const retried = await service.completeReplace("user-1", asset.assetId, prepared.sessionId, { ipAddress: "127.0.0.1", publicAppUrl: "https://assets.example" })

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(retried).toMatchObject({ assetId: replaced.assetId, name: "logo.webp", url: replaced.url })
    expect(usage.usedBytes).toBe(20n)
    expect(usage.reservedBytes).toBe(0n)
    expect(objects.has(newStorageKey)).toBe(true)
    expect(objects.has(oldStorageKey)).toBe(true)
    expect([...prisma.__debug.publicAssetRevisions.values()]).toHaveLength(1)
  })

  it("does not treat a concurrently cancelled replace session as a successful retry", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })
    objects.set(asset.storageKey, { body: pngSignatureBuffer(), contentType: "image/png" })
    const prepared = await service.prepareReplace("user-1", asset.assetId, {
      name: "logo.webp",
      size: "12",
      mimeType: "image/webp",
      publicAppUrl: "https://assets.example",
    })
    const newStorageKey = await storageKeyForSession(prisma, prepared.sessionId)
    await storage.putObject({ key: newStorageKey, body: webpSignatureBuffer(), contentType: "image/webp" })
    const updateMany = prisma.driveUploadSession.updateMany
    prisma.driveUploadSession.updateMany = vi.fn(async (input: any) => {
      if (input.where?.id === prepared.sessionId && input.where?.status === "pending") {
        await prisma.driveUploadSession.update({
          where: { id: prepared.sessionId },
          data: { status: "cancelled", failedAt: new Date("2026-06-21T00:00:00.000Z") },
        })
      }
      return updateMany(input)
    })

    await expect(service.completeReplace("user-1", asset.assetId, prepared.sessionId, {
      ipAddress: "127.0.0.1",
      publicAppUrl: "https://assets.example",
    })).rejects.toThrow("上传会话不存在。")

    const session = (await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0]
    const current = await prisma.publicAsset.findFirst({ where: { id: asset.id }, include: { item: true } })
    expect(session.status).toBe("cancelled")
    expect(current?.storageKey).toBe(asset.storageKey)
    expect([...prisma.__debug.publicAssetRevisions.values()]).toHaveLength(0)
  })

  it("returns a trashed DTO without changing the public URL after trashing", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })

    const trashed = await service.trashAsset("user-1", asset.assetId, {
      ipAddress: "127.0.0.1",
      publicAppUrl: "https://assets.example",
    })

    expect(trashed.assetId).toBe(asset.assetId)
    expect(trashed.url).toBe(`https://assets.example/files/${asset.assetId}`)
    expect(trashed.lifecycleStatus).toBe("trashed")
  })

  it("renames with caller publicAppUrl while keeping assetId and URL identity", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })

    const renamed = await service.renameAsset("user-1", asset.assetId, "brand.png", {
      ipAddress: "127.0.0.1",
      publicAppUrl: "https://assets.example",
    })

    expect(renamed.assetId).toBe(asset.assetId)
    expect(renamed.name).toBe("brand.png")
    expect(renamed.url).toBe(`https://assets.example/files/${asset.assetId}`)
  })

  it("rejects renaming to an extension that mismatches the current asset MIME", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })

    await expect(service.renameAsset("user-1", asset.assetId, "brand.webp", {
      ipAddress: "127.0.0.1",
      publicAppUrl: "https://assets.example",
    })).rejects.toThrow("文件类型与扩展名不匹配。")

    expect((await prisma.publicAsset.findFirst({ where: { assetId: asset.assetId } })).name).toBe("logo.png")
    expect((await prisma.driveItem.findUniqueOrThrow({ where: { id: asset.itemId } })).name).toBe("logo.png")
  })

  it("restores with caller publicAppUrl while keeping assetId and URL identity", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })
    await service.trashAsset("user-1", asset.assetId, {
      ipAddress: "127.0.0.1",
      publicAppUrl: "https://assets.example",
    })

    const restored = await service.restoreAsset("user-1", asset.assetId, {
      ipAddress: "127.0.0.1",
      publicAppUrl: "https://assets.example",
    })

    expect(restored.assetId).toBe(asset.assetId)
    expect(restored.url).toBe(`https://assets.example/files/${asset.assetId}`)
    expect(restored.lifecycleStatus).toBe("active")
  })

  it("rejects invalid uploaded bytes and releases session quota while deleting the temp object", async () => {
    const prepared = await service.prepareUpload("user-1", {
      name: "logo.png",
      size: "8",
      mimeType: "image/png",
      publicAppUrl: "https://synapse.example",
    })
    const storageKey = await storageKeyForSession(prisma, prepared.sessionId)
    await storage.putObject({ key: storageKey, body: Buffer.from("notimage"), contentType: "image/png" })
    expect(publicAppUrlCacheSize(service)).toBe(1)

    await expect(service.completeUpload("user-1", prepared.sessionId, { ipAddress: "127.0.0.1" })).rejects.toThrow("上传文件校验失败。")

    expect(publicAppUrlCacheSize(service)).toBe(0)
    expect(objects.has(storageKey)).toBe(false)
    expect((await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0].status).toBe("failed")
    expect((await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })).reservedBytes).toBe(0n)
  })

  it("aggregates GET access stats while HEAD only records detail", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })

    await service.recordAccessSafely({ assetId: asset.assetId, publicAssetId: asset.id, userId: "user-1", method: "GET", statusCode: 200, bytes: 8n })
    await service.recordAccessSafely({ assetId: asset.assetId, publicAssetId: asset.id, userId: "user-1", method: "HEAD", statusCode: 200, bytes: 0n })
    await service.recordAccessSafely({ assetId: asset.assetId, publicAssetId: asset.id, userId: "user-1", method: "GET", statusCode: 304, bytes: 0n })

    const stored = await prisma.publicAsset.findFirst({ where: { id: asset.id } })
    expect(stored.accessCount).toBe(2n)
    expect(stored.responseBytes).toBe(8n)
    expect(prisma.__debug.publicAssetAccessLogs.size).toBe(3)
  })

  it("sanitizes public asset access referers before persistence", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })

    await service.recordAccessSafely({
      assetId: asset.assetId,
      publicAssetId: asset.id,
      userId: "user-1",
      method: "GET",
      statusCode: 200,
      bytes: 8n,
      referer: "https://reader:secret-token@synapse.example/share/shr_secret/items/item_secret?password=secret&token=tok_123",
    })

    const stored = [...prisma.__debug.publicAssetAccessLogs.values()][0]
    expect(stored.referer).toBe("https://synapse.example/share/***/items/***?password=***&token=***")
    expect(stored.referer).not.toContain("secret-token")
  })

  it("sanitizes existing public asset access referers for admin responses", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })
    await prisma.publicAssetAccessLog.create({
      data: {
        assetId: asset.assetId,
        publicAssetId: asset.id,
        userId: "user-1",
        method: "GET",
        statusCode: 200,
        bytes: 8n,
        referer: "https://reader:secret-token@synapse.example/files/asset_secret?Password=secret&token=tok_123",
      },
    })

    const logs = await service.listAdminAccessLogs(asset.assetId, { page: 1, pageSize: 20, sortBy: "accessedAt", sortOrder: "desc" })

    expect(logs.data[0].referer).toBe("https://synapse.example/files/***?Password=***&token=***")
    expect(logs.data[0].referer).not.toContain("secret-token")
  })

  it("lists hidden and trashed public assets for admins with owner metadata", async () => {
    await prisma.user.create({ data: { id: "user-2", email: "owner2@example.com", passwordHash: "hash" } })
    await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "active.png",
      size: 8n,
    })
    await seedPublicAsset({
      prisma,
      userId: "user-2",
      assetId: "asset_9Hy8kQ2mNv7RbP6xAa91Lc0Dm7Tn5Yua",
      name: "hidden.png",
      size: 12n,
      lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.hidden,
    })

    const page = await service.listAdminAssets("https://assets.example", {
      pagination: { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" },
    })

    expect(page.total).toBe(2)
    expect(page.data.map((asset) => asset.lifecycleStatus).sort()).toEqual(["active", "hidden"])
    expect(page.data[0]).toMatchObject({
      owner: expect.objectContaining({ userId: expect.any(String), email: expect.any(String) }),
      url: expect.stringContaining("/files/asset_"),
    })
  })

  it("searches admin public assets case-insensitively", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "Report.PNG",
      size: 8n,
    })

    const byName = await service.listAdminAssets("https://assets.example", {
      pagination: { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" },
      search: "report.png",
    })
    const byAssetId = await service.listAdminAssets("https://assets.example", {
      pagination: { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" },
      search: asset.assetId.toUpperCase(),
    })
    const byItemId = await service.listAdminAssets("https://assets.example", {
      pagination: { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" },
      search: asset.itemId.toUpperCase(),
    })

    expect(byName.data).toEqual([expect.objectContaining({ assetId: asset.assetId, name: "Report.PNG" })])
    expect(byAssetId.data).toEqual([expect.objectContaining({ assetId: asset.assetId })])
    expect(byItemId.data).toEqual([expect.objectContaining({ itemId: asset.itemId })])
  })

  it("paginates public asset access logs and revision downloads for admins", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })
    await service.recordAccessSafely({
      assetId: asset.assetId,
      publicAssetId: asset.id,
      userId: "user-1",
      method: "GET",
      statusCode: 200,
      bytes: 8n,
      ip: "127.0.0.1",
      referer: "https://example.test",
      userAgent: "vitest",
    })
    const revision = await prisma.publicAssetRevision.create({
      data: {
        assetId: asset.assetId,
        publicAssetId: asset.id,
        itemId: asset.itemId,
        storageKey: `${asset.storageKey}/old`,
        name: "logo-old.png",
        originalName: "logo-old.png",
        size: 8n,
        mimeType: "image/png",
      },
    })
    objects.set(revision.storageKey, { body: pngSignatureBuffer(), contentType: "image/png" })

    const logs = await service.listAdminAccessLogs(asset.assetId, { page: 1, pageSize: 20, sortBy: "accessedAt", sortOrder: "desc" })
    const revisions = await service.listAdminRevisions(asset.assetId, { page: 1, pageSize: 20, sortBy: "replacedAt", sortOrder: "desc" })
    const download = await service.openAdminRevisionDownload(asset.assetId, revision.id)

    expect(logs).toMatchObject({
      total: 1,
      data: [expect.objectContaining({
        method: "GET",
        statusCode: 200,
        bytes: "8",
        ip: "127.0.0.1",
        referer: "https://example.test",
        userAgent: "vitest",
      })],
    })
    expect(logs.data[0].createdAt).toBe(logs.data[0].accessedAt)
    expect(revisions).toMatchObject({
      total: 1,
      data: [expect.objectContaining({ id: revision.id, name: "logo-old.png", size: "8" })],
    })
    expect(download).toMatchObject({ fileName: "logo-old.png", size: 8n, contentType: "image/png" })
  })

  it("replaces content with full new object quota and records the previous revision", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })
    objects.set(asset.storageKey, { body: pngSignatureBuffer(), contentType: "image/png" })
    const oldStorageKey = asset.storageKey
    const prepared = await service.prepareReplace("user-1", asset.assetId, {
      name: "logo.webp",
      size: "12",
      mimeType: "image/webp",
      publicAppUrl: "https://assets.example",
    })
    expect((await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })).reservedBytes).toBe(12n)
    const newStorageKey = await storageKeyForSession(prisma, prepared.sessionId)
    await storage.putObject({ key: newStorageKey, body: webpSignatureBuffer(), contentType: "image/webp" })

    const replaced = await service.completeReplace("user-1", asset.assetId, prepared.sessionId, {
      ipAddress: "127.0.0.1",
      publicAppUrl: "https://assets.example",
    })

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(replaced.assetId).toBe(asset.assetId)
    expect(replaced.url).toBe(`https://assets.example/files/${asset.assetId}`)
    expect(usage.usedBytes).toBe(20n)
    expect(usage.reservedBytes).toBe(0n)
    expect(objects.has(oldStorageKey)).toBe(true)
    expect(objects.has(newStorageKey)).toBe(true)
    expect((await prisma.publicAsset.findFirst({ where: { assetId: asset.assetId } })).storageKey).toBe(newStorageKey)
    expect([...prisma.__debug.publicAssetRevisions.values()]).toEqual([
      expect.objectContaining({
        assetId: asset.assetId,
        storageKey: oldStorageKey,
        name: "logo.png",
        size: 8n,
      }),
    ])
  })

  it("does not compensate destructively when a stale pending session snapshot is already completed", async () => {
    const prepared = await service.prepareUpload("user-1", {
      name: "logo.png",
      size: "8",
      mimeType: "image/png",
      publicAppUrl: "https://synapse.example",
    })
    const storageKey = await storageKeyForSession(prisma, prepared.sessionId)
    const staleSession = (await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0]
    await storage.putObject({ key: storageKey, body: pngSignatureBuffer(), contentType: "image/png" })
    await service.completeUpload("user-1", prepared.sessionId, { ipAddress: "127.0.0.1", publicAppUrl: "https://synapse.example" })

    await (service as unknown as {
      failSession: (
        userId: string,
        session: { readonly id: string; readonly itemId: string; readonly reservedBytes: bigint; readonly storageKey: string },
        status: string,
      ) => Promise<void>,
    }).failSession("user-1", staleSession, "failed")

    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(8n)
    expect(usage.reservedBytes).toBe(0n)
    expect(objects.has(storageKey)).toBe(true)
    expect((await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0].status).toBe("completed")
  })

  it("keeps the existing asset active when replace upload instruction creation fails", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })
    objects.set(asset.storageKey, { body: pngSignatureBuffer(), contentType: "image/png" })
    const failingStorage: DriveStoragePort = {
      ...storage,
      createUploadInstruction: vi.fn(async () => {
        throw new Error("storage unavailable")
      }),
    }
    service = new DrivePublicAssetService(prisma as unknown as PrismaService, failingStorage, undefined, createLifecycleMemory(prisma) as never)

    await expect(service.prepareReplace("user-1", asset.assetId, {
      name: "logo.webp",
      size: "12",
      mimeType: "image/webp",
      publicAppUrl: "https://assets.example",
    })).rejects.toThrow("storage unavailable")

    const [session] = await prisma.driveUploadSession.findMany({ where: { purpose: "public_asset_replace" } })
    const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: asset.itemId } })
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(item).toMatchObject({
      lifecycleStatus: "active",
      storageStatus: "active",
      uploadStatus: "completed",
      deletedAt: null,
    })
    expect(usage.reservedBytes).toBe(0n)
    expect(objects.has(asset.storageKey)).toBe(true)
    expect(failingStorage.deleteObject).toHaveBeenCalledWith(session.storageKey)
  })

  it("keeps the existing asset active when a replace completion session expires", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "logo.png",
      size: 8n,
    })
    objects.set(asset.storageKey, { body: pngSignatureBuffer(), contentType: "image/png" })
    const prepared = await service.prepareReplace("user-1", asset.assetId, {
      name: "logo.webp",
      size: "12",
      mimeType: "image/webp",
      publicAppUrl: "https://assets.example",
    })
    const newStorageKey = await storageKeyForSession(prisma, prepared.sessionId)
    await storage.putObject({ key: newStorageKey, body: webpSignatureBuffer(), contentType: "image/webp" })
    await prisma.driveUploadSession.update({
      where: { id: prepared.sessionId },
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    })

    await expect(service.completeReplace("user-1", asset.assetId, prepared.sessionId, {
      ipAddress: "127.0.0.1",
      publicAppUrl: "https://assets.example",
    })).rejects.toThrow("上传会话已过期。")

    const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: asset.itemId } })
    const session = (await prisma.driveUploadSession.findMany({ where: { id: prepared.sessionId } }))[0]
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(item).toMatchObject({
      lifecycleStatus: "active",
      storageStatus: "active",
      uploadStatus: "completed",
      deletedAt: null,
    })
    expect(session.status).toBe("expired")
    expect(usage.reservedBytes).toBe(0n)
    expect(objects.has(asset.storageKey)).toBe(true)
    expect(objects.has(newStorageKey)).toBe(false)
  })

  it("keeps trashed assets visible in the asset list but hides hidden assets", async () => {
    const active = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "active.png",
      size: 8n,
    })
    const trashed = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5Yua",
      name: "trashed.png",
      size: 8n,
      lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.trashed,
    })
    await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5Yub",
      name: "hidden.png",
      size: 8n,
      lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.hidden,
    })

    const listed = await service.listAssets("user-1", "https://assets.example")

    expect(listed.items.map((item) => item.assetId).sort()).toEqual([active.assetId, trashed.assetId].sort())
  })

  it("marks missing public asset objects as unavailable in user and admin DTOs", async () => {
    const asset = await seedPublicAsset({
      prisma,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "missing.png",
      size: 8n,
    })

    await expect(service.resolvePublicAsset(asset.assetId, {}))
      .resolves.toEqual({ status: "not_found", assetId: asset.assetId })

    const listed = await service.listAssets("user-1", "https://assets.example")
    expect(listed.items.find((item) => item.assetId === asset.assetId)?.lifecycleStatus).toBe("legacy_missing")
    await expect(service.getAsset("user-1", asset.assetId, "https://assets.example"))
      .resolves.toMatchObject({ lifecycleStatus: "legacy_missing" })
    const adminPage = await service.listAdminAssets("https://assets.example", {
      pagination: { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" },
    })
    expect(adminPage.data.find((item) => item.assetId === asset.assetId)?.lifecycleStatus).toBe("legacy_missing")
  })
})

function pngSignatureBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

function webpSignatureBuffer(): Buffer {
  return Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0x04, 0x00, 0x00, 0x00]), Buffer.from("WEBP", "ascii")])
}

async function storageKeyForSession(prisma: ReturnType<typeof createPrismaMemory>, sessionId: string): Promise<string> {
  const session = (await prisma.driveUploadSession.findMany({ where: { id: sessionId } }))[0]
  if (!session) throw new Error(`Missing upload session ${sessionId}`)
  return session.storageKey
}

function publicAppUrlCacheSize(service: DrivePublicAssetService): number {
  return (service as unknown as { readonly publicAppUrlsBySessionId: ReadonlyMap<string, string> }).publicAppUrlsBySessionId.size
}

function createStorageMemory(
  objects: Map<string, { readonly body: Buffer; readonly contentType?: string | null }>,
): DriveStoragePort {
  return {
    createUploadInstruction: vi.fn(async (input) => ({
      method: "PUT" as const,
      url: `https://storage.example/${encodeURIComponent(input.key)}`,
      expiresAt: new Date("2026-06-07T12:15:00.000Z"),
      headers: input.contentType ? { "Content-Type": input.contentType } : {} as Record<string, string>,
    })),
    createDownloadUrl: vi.fn(async () => ({
      url: "https://storage.example/download",
      expiresAt: new Date("2026-06-07T12:05:00.000Z"),
    })),
    headObject: vi.fn(async (key) => {
      const object = objects.get(key)
      return object ? { key, size: BigInt(object.body.length), etag: `"${key}-etag"` } : null
    }),
    putObject: vi.fn(async (input) => {
      objects.set(input.key, { body: input.body, contentType: input.contentType ?? null })
    }),
    copyObject: vi.fn(async (input) => {
      const object = objects.get(input.fromKey)
      if (!object) throw new Error("object not found")
      objects.set(input.toKey, { body: object.body, contentType: input.contentType ?? object.contentType ?? null })
    }),
    getObjectStream: vi.fn(async (input) => {
      const object = objects.get(input.key)
      if (!object) throw new Error("object not found")
      return {
        stream: Readable.from(object.body),
        size: BigInt(object.body.length),
        contentType: object.contentType ?? null,
      }
    }),
    deleteObject: vi.fn(async (key) => {
      objects.delete(key)
    }),
  }
}

async function seedPublicAsset(input: {
  readonly prisma: ReturnType<typeof createPrismaMemory>
  readonly userId?: string
  readonly assetId: string
  readonly name: string
  readonly size: bigint
  readonly lifecycleStatus?: string
}) {
  const userId = input.userId ?? "user-1"
  const item = await input.prisma.driveItem.create({
    data: {
      userId,
      parentId: null,
      type: "file",
      name: input.name,
      size: input.size,
      mimeType: "image/png",
      storageKey: `drive/public-assets/${input.assetId}`,
      storageStatus: "active",
      uploadStatus: "completed",
      lifecycleStatus: input.lifecycleStatus ?? "active",
    },
  })
  const asset = await input.prisma.publicAsset.create({
    data: {
      assetId: input.assetId,
      userId,
      itemId: item.id,
      name: input.name,
      originalName: input.name,
      size: input.size,
      mimeType: "image/png",
      storageKey: item.storageKey,
      etag: "seed-etag",
      lifecycleStatus: input.lifecycleStatus ?? "active",
    },
  })
  await input.prisma.driveUsage.upsert({
    where: { userId },
    create: { userId, usedBytes: input.size, reservedBytes: 0n, quotaBytes: 1073741824n },
    update: {},
  })
  return asset
}

type LifecycleMemory = {
  readonly registerUploadSessionCleanup: (sessionId: string, cleanup: () => void) => void
  readonly forgetUploadSessionCleanup: (sessionId: string) => void
  readonly cleanupUploadSessionState: (sessionId: string) => void
  readonly trashItem: (input: { readonly itemId: string; readonly actorId: string }) => Promise<unknown>
  readonly restoreItem: (input: { readonly itemId: string }) => Promise<unknown>
  readonly hideTrashedItemAsAdmin: (input: { readonly itemId: string; readonly actorId: string }) => Promise<unknown>
}

function createLifecycleMemory(prisma: ReturnType<typeof createPrismaMemory>): LifecycleMemory {
  const uploadSessionCleanups = new Map<string, () => void>()
  return {
    registerUploadSessionCleanup: vi.fn((sessionId: string, cleanup: () => void) => {
      uploadSessionCleanups.set(sessionId, cleanup)
    }),
    forgetUploadSessionCleanup: vi.fn((sessionId: string) => {
      uploadSessionCleanups.delete(sessionId)
    }),
    cleanupUploadSessionState: vi.fn((sessionId: string) => {
      const cleanup = uploadSessionCleanups.get(sessionId)
      uploadSessionCleanups.delete(sessionId)
      cleanup?.()
    }),
    trashItem: vi.fn(async (input: { readonly itemId: string; readonly actorId: string }) => {
      const item = await prisma.driveItem.update({
        where: { id: input.itemId },
        data: {
          lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.trashed,
          trashedAt: new Date("2026-06-07T12:00:00.000Z"),
          trashedBy: input.actorId,
          deleteRootId: input.itemId,
        },
      })
      await prisma.publicAsset.updateMany({
        where: { itemId: input.itemId },
        data: {
          lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.trashed,
          trashedAt: new Date("2026-06-07T12:00:00.000Z"),
          trashedBy: input.actorId,
        },
      })
      return item
    }),
    restoreItem: vi.fn(async (input: { readonly itemId: string }) => {
      const item = await prisma.driveItem.update({
        where: { id: input.itemId },
        data: {
          lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
          trashedAt: null,
          trashedBy: null,
          deleteRootId: null,
        },
      })
      await prisma.publicAsset.updateMany({
        where: { itemId: input.itemId },
        data: {
          lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
          trashedAt: null,
          trashedBy: null,
        },
      })
      return item
    }),
  } as never
}

function createPrismaMemory() {
  let nextId = 1
  const users = new Map<string, { id: string; email: string; passwordHash: string }>()
  const items = new Map<string, any>()
  const usages = new Map<string, any>()
  const sessions = new Map<string, any>()
  const publicAssets = new Map<string, any>()
  const publicAssetRevisions = new Map<string, any>()
  const publicAssetAccessLogs = new Map<string, any>()
  const now = () => new Date("2026-06-07T12:00:00.000Z")
  const id = (prefix: string) => `${prefix}-${nextId++}`

  const prisma: any = {
    $transaction: async (input: any) => {
      if (typeof input === "function") {
        const snapshots = [
          [items, cloneMap(items)],
          [usages, cloneMap(usages)],
          [sessions, cloneMap(sessions)],
          [publicAssets, cloneMap(publicAssets)],
          [publicAssetRevisions, cloneMap(publicAssetRevisions)],
          [publicAssetAccessLogs, cloneMap(publicAssetAccessLogs)],
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
        return user && select ? selectFields(user, select) : user
      },
    },
    driveUsage: {
      upsert: async ({ where, create }: any) => {
        const existing = usages.get(where.userId)
        if (existing) return existing
        const usage = { ...create, updatedAt: now() }
        usages.set(where.userId, usage)
        return usage
      },
      update: async ({ where, data }: any) => {
        const usage = usages.get(where.userId)
        if (!usage) throw new Error("usage not found")
        applyNumericUpdates(usage, data)
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
          id: data.id ?? id("item"),
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
          deletedAt: data.deletedAt ?? null,
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
      findFirst: async ({ where }: any) => [...items.values()].find((item) => matchesWhere(item, where)) ?? null,
      findUnique: async ({ where }: any) => items.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => {
        const item = items.get(where.id)
        if (!item) throw new Error("item not found")
        return item
      },
    },
    driveUploadSession: {
      create: async ({ data }: any) => {
        const session = {
          id: data.id ?? id("session"),
          ...data,
          reservedBytes: data.reservedBytes ?? data.expectedSize,
          createdAt: now(),
          completedAt: null,
          failedAt: null,
        }
        sessions.set(session.id, session)
        return session
      },
      findFirst: async ({ where, include }: any) => {
        const session = [...sessions.values()].find((row) => matchesWhere(row, where))
        if (!session) return null
        return include?.item ? { ...session, item: items.get(session.itemId) } : session
      },
      findMany: async ({ where, select }: any = {}) => {
        const found = [...sessions.values()].filter((session) => matchesWhere(session, where ?? {}))
        return select ? found.map((session) => selectFields(session, select)) : found
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
    },
    publicAsset: {
      create: async ({ data }: any) => {
        if ([...publicAssets.values()].some((asset) => asset.assetId === data.assetId)) throw uniqueConstraintError(["assetId"])
        const asset = {
          id: data.id ?? id("public-asset"),
          lifecycleStatus: "active",
          trashedAt: null,
          trashedBy: null,
          hiddenAt: null,
          hiddenBy: null,
          deletedAt: null,
          deletedBy: null,
          accessCount: 0n,
          responseBytes: 0n,
          lastAccessedAt: null,
          createdAt: now(),
          updatedAt: now(),
          ...data,
        }
        publicAssets.set(asset.id, asset)
        return asset
      },
      findFirst: async ({ where, include }: any) => {
        const asset = [...publicAssets.values()].find((row) => matchesWhere(row, where))
        return asset ? includePublicAsset(asset, include, items) : null
      },
      findMany: async ({ where, include, select, orderBy, skip, take }: any = {}) => {
        const found = paginateRows(
          orderRows([...publicAssets.values()].filter((asset) => matchesWhere(asset, where ?? {})), orderBy),
          { skip, take },
        )
        if (select) return found.map((asset) => selectFields(asset, select))
        return found
          .map((asset) => includePublicAsset(asset, include, items))
      },
      update: async ({ where, data, include }: any) => {
        const asset = publicAssets.get(where.id)
        if (!asset) throw new Error("public asset not found")
        applyNumericUpdates(asset, data)
        asset.updatedAt = now()
        return includePublicAsset(asset, include, items)
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const asset of publicAssets.values()) {
          if (matchesWhere(asset, where)) {
            Object.assign(asset, data, { updatedAt: now() })
            count += 1
          }
        }
        return { count }
      },
      count: async ({ where }: any = {}) => [...publicAssets.values()].filter((asset) => matchesWhere(asset, where ?? {})).length,
    },
    publicAssetRevision: {
      create: async ({ data }: any) => {
        const revision = { id: data.id ?? id("public-asset-revision"), createdAt: now(), replacedAt: now(), ...data }
        publicAssetRevisions.set(revision.id, revision)
        return revision
      },
      findFirst: async ({ where }: any) => [...publicAssetRevisions.values()].find((row) => matchesWhere(row, where ?? {})) ?? null,
      findMany: async ({ where, select, orderBy, skip, take }: any = {}) => {
        const found = paginateRows(
          orderRows([...publicAssetRevisions.values()].filter((revision) => matchesWhere(revision, where ?? {})), orderBy),
          { skip, take },
        )
        return select ? found.map((revision) => selectFields(revision, select)) : found
      },
      count: async ({ where }: any = {}) => [...publicAssetRevisions.values()].filter((revision) => matchesWhere(revision, where ?? {})).length,
    },
    publicAssetAccessLog: {
      create: async ({ data }: any) => {
        const log = { id: data.id ?? id("public-asset-access"), accessedAt: now(), ...data }
        publicAssetAccessLogs.set(log.id, log)
        return log
      },
      findMany: async ({ where, select, orderBy, skip, take }: any = {}) => {
        const found = paginateRows(
          orderRows([...publicAssetAccessLogs.values()].filter((log) => matchesWhere(log, where ?? {})), orderBy),
          { skip, take },
        )
        return select ? found.map((log) => selectFields(log, select)) : found
      },
      count: async ({ where }: any = {}) => [...publicAssetAccessLogs.values()].filter((log) => matchesWhere(log, where ?? {})).length,
    },
    __debug: { publicAssets, publicAssetRevisions, publicAssetAccessLogs, usages, sessions, items },
  }
  return prisma
}

function includePublicAsset(asset: any, include: any, items: Map<string, any>) {
  return {
    ...asset,
    ...(include?.item ? { item: items.get(asset.itemId) } : {}),
    ...(include?.user ? { user: { email: asset.userId === "user-1" ? "user@example.com" : "owner2@example.com" } } : {}),
  }
}

function applyNumericUpdates(row: any, data: any): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (value && typeof value === "object" && "increment" in value) row[key] += (value as { increment: bigint }).increment
    else if (value && typeof value === "object" && "decrement" in value) row[key] -= (value as { decrement: bigint }).decrement
    else row[key] = value
  }
}

function matchesWhere(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === "AND") return value.every((entry: any) => matchesWhere(row, entry))
    if (key === "OR") return value.some((entry: any) => matchesWhere(row, entry))
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key])
    if (value && typeof value === "object" && "not" in value) return row[key] !== value.not
    if (value && typeof value === "object" && "contains" in value) return containsValue(row[key], value)
    return row[key] === value
  })
}

function containsValue(source: unknown, filter: { readonly contains: string; readonly mode?: string }): boolean {
  const sourceText = String(source ?? "")
  const searchText = String(filter.contains)
  if (filter.mode === "insensitive") return sourceText.toLowerCase().includes(searchText.toLowerCase())
  return sourceText.includes(searchText)
}

function orderRows<T extends Record<string, any>>(rows: T[], orderBy: Record<string, "asc" | "desc"> | undefined): T[] {
  if (!orderBy) return rows
  const [[field, direction]] = Object.entries(orderBy)
  return [...rows].sort((left, right) => {
    const leftValue = left[field]
    const rightValue = right[field]
    if (leftValue === rightValue) return 0
    const result = leftValue > rightValue ? 1 : -1
    return direction === "desc" ? -result : result
  })
}

function paginateRows<T>(rows: T[], input: { readonly skip?: number; readonly take?: number }): T[] {
  const start = input.skip ?? 0
  const end = input.take === undefined ? undefined : start + input.take
  return rows.slice(start, end)
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

function uniqueConstraintError(target: readonly string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  })
}
