import { BadRequestException, Logger, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { Readable } from "node:stream"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
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
    expect(share.url).toMatch(/^https:\/\/synapse\.test\/files\/shr_/u)
    await service.disableShare("user-1", share.id)
    await expect(service.resolvePublicShareAccess({ shareId: share.shareId })).rejects.toBeInstanceOf(NotFoundException)
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

    const completed = await service.completeUpload("user-1", prepared.sessionId)
    const renamed = await service.renameItem("user-1", completed.id, "index.html")
    await service.moveItem("user-1", renamed.id, null)

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.upload.complete",
      targetType: "drive.item",
      targetId: completed.id,
      adminEmail: "user-1",
      ipAddress: "system",
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

  it("audits share and publication changes without secrets", async () => {
    const prisma = createPrismaMemory()
    const auditLog = { record: vi.fn(async () => undefined) }
    const service = new DriveService(prisma as unknown as PrismaService, storageMock, auditLog as never)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    auditLog.record.mockClear()

    const share = await service.createShare("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "30d" })
    const publication = await service.publishPage("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "30d" })
    const redeployed = await service.redeployPublication("user-1", publication.id, "https://synapse.test")
    await service.disablePublication("user-1", publication.id)
    await service.disableShare("user-1", share.id)

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.share.create",
      targetType: "drive.share",
      targetId: share.id,
      detail: expect.objectContaining({ userId: "user-1", itemId: file.id, shareId: share.shareId, passwordEnabled: true }),
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.publication.publish",
      targetType: "drive.publication",
      targetId: publication.id,
      detail: expect.objectContaining({ userId: "user-1", itemId: file.id, type: "page", publishId: publication.publishId }),
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.publication.redeploy",
      targetType: "drive.publication",
      targetId: publication.id,
      detail: expect.objectContaining({ userId: "user-1", publicationId: publication.id, currentDeploymentId: redeployed.currentDeploymentId }),
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.publication.disable",
      targetType: "drive.publication",
      targetId: publication.id,
      detail: expect.objectContaining({ userId: "user-1", publicationId: publication.id }),
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "drive.share.disable",
      targetType: "drive.share",
      targetId: share.id,
      detail: expect.objectContaining({ userId: "user-1", shareRecordId: share.id }),
    }))
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain(share.password ?? "")
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain(publication.url)
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
    expect(publication.passwordEnabled).toBe(true)
    expect(publication.password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$/u)
    expect(publication.urlWithPassword).toBe(`${publication.url}?password=${publication.password}`)
    expect(publication.expiresAt).not.toBeNull()
    const assets = await prisma.drivePublicationAsset.findMany({ where: { publicationId: publication.id } })
    expect(assets).toMatchObject([{ relativePath: "index.html", sourceItemId: file.id, contentType: "text/html" }])
    expect(publication.currentDeploymentId).toBe(assets[0]?.deploymentId)
    const stored = await prisma.drivePublication.findUniqueOrThrow({ where: { id: publication.id } })
    expect(stored.passwordHash).toEqual(expect.any(String))
    expect(stored.passwordEncrypted).toEqual(expect.any(String))
    expect(stored.accessSettingsAppliedAt).toBeInstanceOf(Date)
  })

  it("overwrites active publication settings without changing the publication identity", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const first = await service.publishPage("user-1", file.id, "https://synapse.test")

    const second = await service.publishPage("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "30d" })

    expect(second.id).toBe(first.id)
    expect(second.publishId).toBe(first.publishId)
    expect(second.url).toBe(first.url)
    expect(second.password).not.toBe(first.password)
    expect(second.expiresAt).not.toBe(first.expiresAt)
    const active = await prisma.drivePublication.findMany({
      where: { userId: "user-1", sourceItemId: file.id, type: "page", status: "active" },
    })
    expect(active).toHaveLength(1)
    expect(active[0]?.accessSettingsAppliedAt).toBeInstanceOf(Date)
  })

  it("keeps existing publication access settings when republish deployment fails", async () => {
    const prisma = createPrismaMemory()
    const failingStorage: DriveStoragePort = {
      ...storageMock,
      copyObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, failingStorage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const first = await service.publishPage("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "7d" })
    const storedBefore = await prisma.drivePublication.findUniqueOrThrow({ where: { id: first.id } })
    const accessBefore = {
      passwordHash: storedBefore.passwordHash,
      passwordEncrypted: storedBefore.passwordEncrypted,
      expiresAt: storedBefore.expiresAt,
      accessSettingsAppliedAt: storedBefore.accessSettingsAppliedAt,
    }
    vi.mocked(failingStorage.copyObject).mockRejectedValueOnce(new Error("copy failed"))

    await expect(service.publishPage("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "30d" }))
      .rejects.toThrow("copy failed")

    const storedAfter = await prisma.drivePublication.findUniqueOrThrow({ where: { id: first.id } })
    expect({
      passwordHash: storedAfter.passwordHash,
      passwordEncrypted: storedAfter.passwordEncrypted,
      expiresAt: storedAfter.expiresAt,
      accessSettingsAppliedAt: storedAfter.accessSettingsAppliedAt,
    }).toEqual(accessBefore)
  })

  it("lists publication access settings with readable passwords", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const publication = await service.publishPage("user-1", file.id, "https://synapse.test")

    const publications = await service.listPublications("user-1", "https://synapse.test")

    expect(publications).toHaveLength(1)
    expect(publications[0]).toMatchObject({
      id: publication.id,
      password: publication.password,
      urlWithPassword: publication.urlWithPassword,
      passwordEnabled: true,
      expiresAt: publication.expiresAt,
    })
  })

  it("preserves publication protection during redeploy", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const publication = await service.publishPage("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "7d" })
    const markerBefore = (await prisma.drivePublication.findUniqueOrThrow({ where: { id: publication.id } })).accessSettingsAppliedAt

    const redeployed = await service.redeployPublication("user-1", publication.id, "https://synapse.test")
    const markerAfter = (await prisma.drivePublication.findUniqueOrThrow({ where: { id: publication.id } })).accessSettingsAppliedAt

    expect(redeployed.passwordEnabled).toBe(true)
    expect(redeployed.password).toBe(publication.password)
    expect(redeployed.expiresAt).toBe(publication.expiresAt)
    expect(redeployed.urlWithPassword).toBe(publication.urlWithPassword)
    expect(redeployed.currentDeploymentId).not.toBe(publication.currentDeploymentId)
    expect(markerAfter).toEqual(markerBefore)
  })

  it("does not serve assets from an inactive current deployment", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const publication = await service.publishPage("user-1", file.id, "https://synapse.test")
    await prisma.drivePublicationDeployment.update({
      where: { id: publication.currentDeploymentId },
      data: { status: "failed" },
    })

    await expect(service.resolvePublishedAsset({
      publishId: publication.publishId,
      type: "page",
      relativePath: "index.html",
    })).rejects.toThrow("网页未找到")
    expect(storageMock.getObjectStream).not.toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringContaining(publication.currentDeploymentId ?? ""),
    }))
  })

  it("denies protected published static assets before deployment and asset lookup", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "site" })
    await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "index.html",
      mimeType: "text/html",
    })
    const publication = await service.publishSite("user-1", folder.id, "https://synapse.test")
    const findDeployment = vi.fn(prisma.drivePublicationDeployment.findFirst)
    const findAsset = vi.fn(prisma.drivePublicationAsset.findUnique)
    prisma.drivePublicationDeployment.findFirst = findDeployment
    prisma.drivePublicationAsset.findUnique = findAsset
    vi.mocked(storageMock.getObjectStream).mockClear()

    const access = await service.resolvePublishedAssetAccess({
      publishId: publication.publishId,
      type: "site",
      relativePath: "missing.css",
    })

    expect(access).toEqual({ status: "static_denied" })
    expect(findDeployment).not.toHaveBeenCalled()
    expect(findAsset).not.toHaveBeenCalled()
    expect(storageMock.getObjectStream).not.toHaveBeenCalled()
  })

  it("uses asset content type before storage content type for published assets", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "site" })
    await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "index.html",
      mimeType: "text/html",
    })
    await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "asset.bin",
      mimeType: "application/x-synapse-asset",
    })
    const publication = await service.publishSite("user-1", folder.id, "https://synapse.test")
    vi.mocked(storageMock.getObjectStream).mockResolvedValueOnce({
      stream: Readable.from(["payload"]),
      size: 7n,
      contentType: "text/plain",
    })

    const asset = await service.resolvePublishedAssetAccess({
      publishId: publication.publishId,
      type: "site",
      relativePath: "asset.bin",
      password: publication.password ?? undefined,
    })

    expect(asset.status).toBe("ok")
    if (asset.status === "ok") expect(asset.value.contentType).toBe("application/x-synapse-asset")
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

  it("returns the existing active share when active share uniqueness races", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "handoff.txt",
      mimeType: "text/plain",
    })
    const findFirst = prisma.driveShare.findFirst
    let activeLookupCount = 0
    prisma.driveShare.findFirst = async (args: any) => {
      if (args.where?.itemId === file.id && args.where?.userId === "user-1" && args.where?.enabled === true) {
        activeLookupCount += 1
        if (activeLookupCount === 1) return null
      }
      return findFirst(args)
    }
    const create = prisma.driveShare.create
    let createdConcurrentShare = false
    prisma.driveShare.create = async (args: any) => {
      if (!createdConcurrentShare) {
        createdConcurrentShare = true
        await create(args)
      }
      throw uniqueConstraintError(["itemId", "userId"])
    }

    const share = await service.createShare("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "30d" })

    expect(share.shareId).toMatch(/^shr_/u)
    expect(share.passwordEnabled).toBe(true)
    expect(share.password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$/u)
    expect(await prisma.driveShare.findMany({ where: { itemId: file.id, userId: "user-1", enabled: true } })).toHaveLength(1)
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

  it("disables first publication records when initial deployment copy fails", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      copyObject: vi.fn(async () => { throw new Error("copy failed") }),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })

    await expect(service.publishPage("user-1", file.id, "https://synapse.test")).rejects.toThrow("copy failed")

    const [publication] = await prisma.drivePublication.findMany()
    expect(publication).toMatchObject({
      sourceItemId: file.id,
      status: "disabled",
      currentDeploymentId: null,
    })
    expect(publication.disabledAt).toBeInstanceOf(Date)
    const deployments = await prisma.drivePublicationDeployment.findMany({ where: { publicationId: publication.id } })
    expect(deployments).toHaveLength(1)
    expect(deployments[0]).toMatchObject({ status: "failed", error: "copy failed" })
    const publications = await service.listPublications("user-1", "https://synapse.test")
    expect(publications).toHaveLength(1)
    expect(publications[0]).toMatchObject({ id: publication.id, status: "disabled", currentDeploymentId: null })
  })

  it("deletes copied publication objects when a later site copy fails", async () => {
    const prisma = createPrismaMemory()
    const copiedKeys: string[] = []
    const storage: DriveStoragePort = {
      ...storageMock,
      copyObject: vi.fn(async ({ toKey }) => {
        copiedKeys.push(toKey)
        if (copiedKeys.length === 2) throw new Error("copy failed")
      }),
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "site" })
    await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "index.html",
      mimeType: "text/html",
    })
    await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "app.js",
      mimeType: "application/javascript",
    })

    await expect(service.publishSite("user-1", folder.id, "https://synapse.test")).rejects.toThrow("copy failed")

    expect(copiedKeys).toHaveLength(2)
    expect(storage.deleteObject).toHaveBeenCalledTimes(1)
    expect(storage.deleteObject).toHaveBeenCalledWith(copiedKeys[0])
    expect(await prisma.drivePublicationAsset.findMany()).toHaveLength(0)
  })

  it("deletes copied publication objects when deployment asset persistence fails", async () => {
    const prisma = createPrismaMemory()
    const copiedKeys: string[] = []
    const storage: DriveStoragePort = {
      ...storageMock,
      copyObject: vi.fn(async ({ toKey }) => {
        copiedKeys.push(toKey)
      }),
      deleteObject: vi.fn(async () => undefined),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "site" })
    await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "index.html",
      mimeType: "text/html",
    })
    await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "app.js",
      mimeType: "application/javascript",
    })
    prisma.drivePublicationAsset.createMany = async () => {
      throw new Error("asset persistence failed")
    }

    await expect(service.publishSite("user-1", folder.id, "https://synapse.test")).rejects.toThrow("asset persistence failed")

    expect(copiedKeys).toHaveLength(2)
    expect(storage.deleteObject).toHaveBeenCalledTimes(2)
    expect(vi.mocked(storage.deleteObject).mock.calls.map(([key]) => key)).toEqual(copiedKeys)
    expect(await prisma.drivePublicationAsset.findMany()).toHaveLength(0)
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

  it("detects a published site child resource when deleting one file", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "site" })
    await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "index.html",
      mimeType: "text/html",
    })
    const logo = await createCompletedUpload(service, "user-1", {
      parentId: folder.id,
      name: "logo.png",
      mimeType: "image/png",
    })
    const publication = await service.publishSite("user-1", folder.id, "https://synapse.test")

    const impact = await service.getDeleteImpact("user-1", logo.id, "https://synapse.test")

    expect(impact.publications.map((item) => item.id)).toEqual([publication.id])
  })

  it("disables affected publications when deleting with disablePublications", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const publication = await service.publishPage("user-1", file.id, "https://synapse.test")

    await service.deleteItem("user-1", file.id, "user-1", "127.0.0.1", {
      disablePublications: true,
      publicAppUrl: "https://synapse.test",
    })

    const updatedPublication = await prisma.drivePublication.findUniqueOrThrow({ where: { id: publication.id } })
    const deletedItem = await prisma.driveItem.findUniqueOrThrow({ where: { id: file.id } })
    expect(updatedPublication).toMatchObject({ status: "disabled" })
    expect(updatedPublication.disabledAt).toEqual(deletedItem.deletedAt)
  })

  it("lists enabled shares with source metadata", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const share = await service.createShare("user-1", file.id, "https://synapse.test")

    const shares = await service.listShares("user-1", "https://synapse.test")

    expect(shares).toEqual([{
      id: share.id,
      shareId: share.shareId,
      itemId: file.id,
      itemName: "report.html",
      itemType: "file",
      sourceDeleted: false,
      url: share.url,
      urlWithPassword: share.urlWithPassword,
      passwordEnabled: true,
      password: share.password,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
    }])
  })

  it("backfills legacy active shares and publications on application bootstrap", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const share = await prisma.driveShare.create({
      data: {
        itemId: file.id,
        userId: "user-1",
        type: "file",
        shareId: "shr_legacy",
        enabled: true,
        passwordEnabled: false,
        passwordHash: null,
        passwordEncrypted: null,
        expiresAt: null,
      },
    })
    const publication = await prisma.drivePublication.create({
      data: {
        userId: "user-1",
        sourceItemId: file.id,
        type: "page",
        name: "report.html",
        status: "active",
        publishId: "pub_legacy",
        passwordEnabled: false,
        passwordHash: null,
        passwordEncrypted: null,
        expiresAt: null,
      },
    })

    const backfilledAt = new Date("2026-06-09T12:00:00.000Z")
    const first = await service.backfillLegacyDriveAccessProtection(backfilledAt)
    const second = await service.backfillLegacyDriveAccessProtection(new Date("2026-06-10T00:00:00.000Z"))

    expect(first).toEqual({ shares: 1, publications: 1 })
    expect(second).toEqual({ shares: 0, publications: 0 })
    const updatedShare = await prisma.driveShare.findFirst({ where: { id: share.id } })
    const updatedPublication = await prisma.drivePublication.findUniqueOrThrow({ where: { id: publication.id } })
    expect(updatedShare).toMatchObject({
      passwordEnabled: true,
      passwordHash: expect.any(String),
      passwordEncrypted: expect.any(String),
      accessSettingsAppliedAt: backfilledAt,
    })
    expect(updatedShare.expiresAt).toBeInstanceOf(Date)
    expect(updatedPublication).toMatchObject({
      passwordEnabled: true,
      passwordHash: expect.any(String),
      passwordEncrypted: expect.any(String),
      accessSettingsAppliedAt: backfilledAt,
    })
    expect(updatedPublication.expiresAt).toBeInstanceOf(Date)
  })

  it("does not backfill explicit no-password share and publication settings", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })

    const share = await service.createShare("user-1", file.id, "https://synapse.test", { passwordEnabled: false, expiresIn: "forever" })
    const publication = await service.publishPage("user-1", file.id, "https://synapse.test", { passwordEnabled: false, expiresIn: "forever" })

    const storedShareBefore = await prisma.driveShare.findFirst({ where: { id: share.id } })
    const storedPublicationBefore = await prisma.drivePublication.findUniqueOrThrow({ where: { id: publication.id } })
    expect(storedShareBefore).toMatchObject({
      passwordEnabled: false,
      passwordHash: null,
      passwordEncrypted: null,
      expiresAt: null,
    })
    expect(storedShareBefore.accessSettingsAppliedAt).toBeInstanceOf(Date)
    expect(storedPublicationBefore).toMatchObject({
      passwordEnabled: false,
      passwordHash: null,
      passwordEncrypted: null,
      expiresAt: null,
    })
    expect(storedPublicationBefore.accessSettingsAppliedAt).toBeInstanceOf(Date)

    const result = await service.backfillLegacyDriveAccessProtection(new Date("2026-06-10T00:00:00.000Z"))

    expect(result).toEqual({ shares: 0, publications: 0 })
    expect(await prisma.driveShare.findFirst({ where: { id: share.id } })).toMatchObject({
      passwordEnabled: false,
      passwordHash: null,
      passwordEncrypted: null,
      expiresAt: null,
      accessSettingsAppliedAt: storedShareBefore.accessSettingsAppliedAt,
    })
    expect(await prisma.drivePublication.findUniqueOrThrow({ where: { id: publication.id } })).toMatchObject({
      passwordEnabled: false,
      passwordHash: null,
      passwordEncrypted: null,
      expiresAt: null,
      accessSettingsAppliedAt: storedPublicationBefore.accessSettingsAppliedAt,
    })
  })

  it("skips legacy access backfill rows that changed after selection", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "report.html",
      mimeType: "text/html",
    })
    const share = await prisma.driveShare.create({
      data: {
        itemId: file.id,
        userId: "user-1",
        type: "file",
        shareId: "shr_legacy_race",
        enabled: true,
        passwordEnabled: false,
        passwordHash: null,
        passwordEncrypted: null,
        expiresAt: null,
      },
    })
    const publication = await prisma.drivePublication.create({
      data: {
        userId: "user-1",
        sourceItemId: file.id,
        type: "page",
        name: "report.html",
        status: "active",
        publishId: "pub_legacy_race",
        passwordEnabled: false,
        passwordHash: null,
        passwordEncrypted: null,
        expiresAt: null,
      },
    })
    const newerExpiresAt = new Date("2026-07-01T00:00:00.000Z")
    const findShares = prisma.driveShare.findMany
    prisma.driveShare.findMany = async (args: any) => {
      const rows = await findShares(args)
      if (args.where?.enabled === true && args.where?.passwordEnabled === false && args.where?.passwordHash === null && args.select?.id) {
        await prisma.driveShare.update({
          where: { id: share.id },
          data: { passwordEnabled: true, passwordHash: "fresh-share-hash", passwordEncrypted: "fresh-share-secret", expiresAt: newerExpiresAt },
        })
      }
      return rows
    }
    const findPublications = prisma.drivePublication.findMany
    prisma.drivePublication.findMany = async (args: any) => {
      const rows = await findPublications(args)
      if (args.where?.status === "active" && args.where?.passwordEnabled === false && args.where?.passwordHash === null && args.select?.id) {
        await prisma.drivePublication.update({
          where: { id: publication.id },
          data: { passwordEnabled: true, passwordHash: "fresh-publication-hash", passwordEncrypted: "fresh-publication-secret", expiresAt: newerExpiresAt },
        })
      }
      return rows
    }

    const result = await service.backfillLegacyDriveAccessProtection(new Date("2026-06-10T00:00:00.000Z"))

    expect(result).toEqual({ shares: 0, publications: 0 })
    expect(await prisma.driveShare.findFirst({ where: { id: share.id } })).toMatchObject({
      passwordHash: "fresh-share-hash",
      passwordEncrypted: "fresh-share-secret",
      expiresAt: newerExpiresAt,
    })
    expect(await prisma.drivePublication.findUniqueOrThrow({ where: { id: publication.id } })).toMatchObject({
      passwordHash: "fresh-publication-hash",
      passwordEncrypted: "fresh-publication-secret",
      expiresAt: newerExpiresAt,
    })
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

    const publicFolder = await service.listPublicFolderChildren({
      shareId: share.shareId,
      password: share.password ?? undefined,
    })

    expect(publicFolder.item.name).toBe("交接材料")
    expect(publicFolder.children).toHaveLength(1)
    expect(publicFolder.children[0]?.name).toBe("brief.txt")
    const download = await service.createDownloadUrlForShareChild({
      shareId: share.shareId,
      itemId: prepared.item.id,
      password: share.password ?? undefined,
    })
    expect(download.url).toBe("https://cos.example/download")
  })

  it("rejects protected share direct access before storage download urls", async () => {
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

    await expect(service.createDownloadUrlForShare({ shareId: fileShare.shareId })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.listPublicFolderChildren({ shareId: folderShare.shareId })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.createDownloadUrlForShareChild({
      shareId: folderShare.shareId,
      itemId: child.id,
    })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.createFolderZipEntriesForShare({ shareId: folderShare.shareId })).rejects.toBeInstanceOf(NotFoundException)
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

    const entries = await service.createFolderZipEntriesForShare({
      shareId: share.shareId,
      password: share.password ?? undefined,
    })

    expect(entries).toEqual([{ path: "docs/spec.txt", storageKey: `drive/${prepared.entries[0]!.item.id}` }])
    expect(storageMock.createDownloadUrl).not.toHaveBeenCalled()
  })

  it("disambiguates same-name files in owner folder archive entries", async () => {
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
      name: "report.pdf",
      mimeType: "application/pdf",
    })

    const archive = await service.createFolderZipEntriesForOwnerBrowserItem({
      userId: "user-1",
      rootItemId: folder.id,
    })

    expect(archive.filename).toBe("交接材料.zip")
    expect(archive.entries).toEqual([
      { path: "report.pdf", storageKey: `drive/${first.id}` },
      { path: "report (2).pdf", storageKey: `drive/${second.id}` },
    ])
  })

  it("disambiguates same-name files in shared child folder archive entries", async () => {
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
      name: "report.pdf",
      mimeType: "application/pdf",
    })
    const share = await service.createShare("user-1", root.id, "https://synapse.test")

    const archive = await service.createFolderZipEntriesForShareBrowserItem({
      shareId: share.shareId,
      itemId: docs.id,
      password: share.password ?? undefined,
    })

    expect(archive.filename).toBe("docs.zip")
    expect(archive.entries).toEqual([
      { path: "report.pdf", storageKey: `drive/${first.id}` },
      { path: "report (2).pdf", storageKey: `drive/${second.id}` },
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
      rootItemId: folder.id,
      currentItemId: page.id,
      surface: "standalone",
    })

    expect(snapshot.context).toBe("owner")
    expect(snapshot.current.browserUrl).toBe(`/drive/items/${folder.id}/items/${page.id}`)
    expect(snapshot.breadcrumbs.map((item) => item.name)).toEqual(["site", "index.html"])
    expect(snapshot.preview).toMatchObject({
      kind: "html-source",
      text: "<html></html>",
      visitUrl: `/drive/items/${folder.id}/items/${page.id}/render`,
    })
  })

  it("builds owner browser snapshots with rendered markdown previews", async () => {
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

    const snapshot = await service.getOwnerBrowserSnapshot({
      userId: "user-1",
      rootItemId: file.id,
      surface: "standalone",
    })

    expect(snapshot.current.previewKind).toBe("markdown")
    expect(snapshot.preview).toMatchObject({
      kind: "markdown",
      text: "# Notes",
      html: "<h1>Notes</h1>",
      visitUrl: null,
    })
  })

  it("renders owner markdown files as html documents", async () => {
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

    const asset = await service.resolveOwnerRenderAccess({
      userId: "user-1",
      rootItemId: file.id,
    })

    expect(asset.contentType).toBe("text/html; charset=utf-8")
    expect(asset.csp).toContain("default-src 'none'")
    await expect(readTestStream(asset.stream)).resolves.toContain("<h1>Notes</h1>")
  })

  it("rejects markdown render requests above the in-memory render limit", async () => {
    const prisma = createPrismaMemory()
    const storage: DriveStoragePort = {
      ...storageMock,
      getObjectStream: vi.fn(async () => ({ stream: Readable.from("# Large"), size: 10_485_761n, contentType: "text/markdown" })),
    }
    const service = new DriveService(prisma as unknown as PrismaService, storage)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const file = await createCompletedUpload(service, "user-1", {
      parentId: null,
      name: "large.md",
      mimeType: "text/markdown",
    })
    await prisma.driveItem.update({
      where: { id: file.id },
      data: { size: 10_485_761n },
    })

    await expect(service.resolveOwnerRenderAccess({
      userId: "user-1",
      rootItemId: file.id,
    })).rejects.toBeInstanceOf(BadRequestException)
  })

  it("builds console root browser snapshots for user drive roots", async () => {
    const prisma = createPrismaMemory()
    const service = new DriveService(prisma as unknown as PrismaService, storageMock)
    await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
    const folder = await service.createFolder("user-1", { parentId: null, name: "资料" })

    const snapshot = await service.getOwnerConsoleRootBrowserSnapshot("user-1")

    expect(snapshot.current.browserUrl).toBe("/drive")
    expect(snapshot.breadcrumbs).toEqual([{ id: "root", name: "网盘", browserUrl: "/drive" }])
    expect(snapshot.children).toEqual([expect.objectContaining({
      id: folder.id,
      browserUrl: `/drive/items/${folder.id}`,
      downloadUrl: `/drive/items/${folder.id}/zip`,
    })])
  })

  it("builds share browser html source previews without visit urls", async () => {
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

    expect(snapshot.current.browserUrl).toBe(`/files/${share.shareId}`)
    expect(snapshot.preview).toMatchObject({
      kind: "html-source",
      text: "<html></html>",
      visitUrl: null,
    })
  })

  it("builds share browser snapshots with rendered markdown previews", async () => {
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
    const share = await service.createShare("user-1", file.id, "https://synapse.test")

    const snapshot = await service.getShareBrowserSnapshot({
      shareId: share.shareId,
      password: share.password ?? undefined,
    })

    expect(snapshot.preview).toMatchObject({
      kind: "markdown",
      text: "# Notes",
      html: "<h1>Notes</h1>",
      visitUrl: null,
    })
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

    const result = await service.expirePendingUploadSessions(new Date("2026-06-07T00:00:00.000Z"))
    expect(result.expired).toBe(1)
    expect(storage.deleteObject).toHaveBeenCalledWith(`drive/${prepared.item.id}`)
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
    await expect(service.resolvePublicShareAccess({ shareId: share.shareId })).rejects.toBeInstanceOf(NotFoundException)
  })

  it("keeps admin delete pending storage cleanup visible in the admin list", async () => {
    const prisma = createPrismaMemory()
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const storage: DriveStoragePort = {
      ...storageMock,
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
    await service.completeUpload("user-1", prepared.sessionId)

    try {
      await service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")

      const list = await service.listAdminItems({
        pagination: { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" },
        filters: { search: "handoff" },
      })
      expect(list.data).toEqual([
        expect.objectContaining({
          id: prepared.item.id,
          storageStatus: "delete_pending",
          storageDeletePending: true,
        }),
      ])
      expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({
        itemId: prepared.item.id,
        storageKey: `drive/${prepared.item.id}`,
        errorName: "Error",
        errorMessage: "delete failed",
      }), "Drive storage object delete failed")
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("keeps admin list search scoped to visible drive items", async () => {
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

    expect(list.data.map((item) => item.id)).toEqual([active.item.id])
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
    user: users.get(item.userId) ? { email: users.get(item.userId)!.email } : null,
    shares: [...shares.values()].filter((share) => share.itemId === item.id && share.enabled).map((share) => ({ enabled: share.enabled })),
  })
  const withSourceItem = (publication: any) => ({
    ...publication,
    sourceItem: publication.sourceItemId ? { deletedAt: items.get(publication.sourceItemId)?.deletedAt ?? null } : null,
  })
  const withPublicationIncludes = (publication: any, include: any) => {
    let result = publication
    if (include?.sourceItem) result = withSourceItem(result)
    if (include?.assets) {
      const assetWhere = include.assets.where ?? {}
      result = {
        ...result,
        assets: [...publicationAssets.values()]
          .filter((asset) => asset.publicationId === publication.id && matchesWhere(asset, assetWhere))
          .map((asset) => include.assets.select ? selectFields(asset, include.assets.select) : asset),
      }
    }
    return result
  }
  const withShareIncludes = (share: any, include: any) => {
    if (!include?.item) return share
    const item = items.get(share.itemId)
    return {
      ...share,
      item: include.item.select ? selectFields(item, include.item.select) : withShares(item),
    }
  }

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
        const item = {
          id: id("item"),
          ...data,
          storageKey: data.storageKey ?? null,
          storageDeletePending: data.storageDeletePending ?? false,
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
    driveShare: {
      create: async ({ data }: any) => {
        const enabled = data.enabled ?? true
        if (enabled && [...shares.values()].some((share) => share.itemId === data.itemId && share.userId === data.userId && share.enabled)) {
          throw uniqueConstraintError(["itemId", "userId"])
        }
        if ([...shares.values()].some((share) => share.shareId === data.shareId)) throw uniqueConstraintError(["shareId"])
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
          ...data,
        }
        shares.set(share.id, share)
        return share
      },
      findFirst: async ({ where, include }: any) => {
        const share = [...shares.values()].find((item) => matchesWhere(item, where))
        if (!share) return null
        return withShareIncludes(share, include)
      },
      findMany: async ({ where, include, orderBy, select }: any = {}) => {
        const found = orderRows([...shares.values()].filter((share) => matchesWhere(share, where ?? {})), orderBy)
        if (select) return found.map((share) => selectFields(share, select))
        return found.map((share) => withShareIncludes(share, include))
      },
      update: async ({ where, data }: any) => {
        const share = shares.get(where.id)
        if (!share) throw new Error("share not found")
        Object.assign(share, data)
        return share
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
          passwordEnabled: false,
          passwordHash: null,
          passwordEncrypted: null,
          expiresAt: null,
          accessSettingsAppliedAt: null,
          createdAt: now(),
          updatedAt: now(),
          ...data,
        }
        publications.set(publication.id, publication)
        return publication
      },
      findFirst: async ({ where, include, select }: any) => {
        const publication = [...publications.values()].find((item) => matchesWhere(item, where))
        if (!publication) return null
        if (select) return selectFields(publication, select)
        return withPublicationIncludes(publication, include)
      },
      findMany: async ({ where, include, orderBy, select }: any = {}) => {
        let found = [...publications.values()].filter((publication) => matchesWhere(publication, where ?? {}))
        found = orderRows(found, orderBy)
        if (select) return found.map((publication) => selectFields(publication, select))
        return found.map((publication) => withPublicationIncludes(publication, include))
      },
      findUniqueOrThrow: async ({ where, include }: any) => {
        const publication = publications.get(where.id)
        if (!publication) throw new Error("publication not found")
        return withPublicationIncludes(publication, include)
      },
      update: async ({ where, data, include }: any) => {
        const publication = publications.get(where.id)
        if (!publication) throw new Error("publication not found")
        Object.assign(publication, data, { updatedAt: now() })
        return withPublicationIncludes(publication, include)
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
      findFirst: async ({ where }: any) => [...publicationDeployments.values()].find((deployment) => matchesWhere(deployment, where)) ?? null,
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
      findUnique: async ({ where }: any) => {
        if (where.deploymentId_relativePath) {
          return [...publicationAssets.values()].find((asset) => (
            asset.deploymentId === where.deploymentId_relativePath.deploymentId
            && asset.relativePath === where.deploymentId_relativePath.relativePath
          )) ?? null
        }
        return publicationAssets.get(where.id) ?? null
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
    if (key === "AND") return value.every((entry: any) => matchesWhere(row, entry))
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

async function readTestStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as NodeJS.ReadableStream & AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

function uniqueConstraintError(target: readonly string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  })
}
