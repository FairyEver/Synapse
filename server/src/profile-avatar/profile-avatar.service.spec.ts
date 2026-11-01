import { BadRequestException, PayloadTooLargeException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { ProfileAvatarService } from "./profile-avatar.service"

function createPng(width = 256, height = 256, byteLength = 128): Buffer {
  const bytes = Buffer.alloc(byteLength)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function createService() {
  const tx = {
    user: { update: vi.fn().mockResolvedValue({}) },
    userAvatarAsset: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  }
  const prisma = {
    __tx: tx,
    $transaction: vi.fn((callback) => callback(tx)),
    user: {
      findUniqueOrThrow: vi.fn(),
    },
    userAvatarAsset: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    systemAvatar: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ id: "avatar-next", publicUrl: "/api/avatars/system/avatar-next" }]),
      findUnique: vi.fn(),
    },
  }
  const storage = {
    putObject: vi.fn().mockResolvedValue(undefined),
    headObject: vi.fn(),
    getObjectStream: vi.fn(),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  }
  const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
  const liveGateway = { broadcastToUser: vi.fn().mockReturnValue({ onlineClientCount: 1, sentClientCount: 1, failedClientCount: 0, clientResults: [] }) }
  return {
    prisma,
    storage,
    auditLog,
    liveGateway,
    service: new ProfileAvatarService(prisma as never, storage as never, auditLog as never, liveGateway as never),
  }
}

describe("ProfileAvatarService", () => {
  it("randomizes to a different system avatar and retires the previous custom avatar", async () => {
    const { service, prisma, storage, auditLog, liveGateway } = createService()
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      systemAvatarId: "avatar-current",
      customAvatarAssetId: null,
    })

    await service.randomize("user-1", "203.0.113.8")

    expect(prisma.systemAvatar.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { not: "avatar-current" } },
      take: 1,
    }))
    expect(prisma.__tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        avatarUrl: "/api/avatars/system/avatar-next",
        avatarSource: "system",
        systemAvatarId: "avatar-next",
        customAvatarAssetId: null,
      },
    })
    expect(storage.deleteObject).not.toHaveBeenCalled()
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "user.profile.avatar_update",
      detail: { source: "random" },
      targetId: "user-1",
    }))
    expect(liveGateway.broadcastToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        type: "account.profile.changed",
        payload: { userId: "user-1" },
      }),
    )
  })

  it("uploads a 256 square png and persists it inside the user avatar prefix", async () => {
    const { service, prisma, storage, auditLog } = createService()
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      email: "user@example.com",
      customAvatarAssetId: null,
    })

    await service.uploadCustom(
      "user-1",
      { bytes: createPng(), contentType: "image/png" },
      "203.0.113.9",
    )

    const created = prisma.userAvatarAsset.create.mock.calls[0]?.[0].data
    expect(created).toMatchObject({
      userId: "user-1",
      mimeType: "image/png",
      byteSize: 128,
      status: "pending",
    })
    expect(created.storageKey).toMatch(/^avatars\/users\/[0-9a-f-]+\.png$/u)
    expect(created.publicUrl).toMatch(/^\/api\/avatars\/users\/[0-9a-f-]+$/u)
    expect(storage.putObject).toHaveBeenCalledWith(created.storageKey, expect.any(Buffer), "image/png")
    expect(prisma.__tx.userAvatarAsset.update).toHaveBeenCalledWith({
      where: { id: created.id },
      data: { status: "active" },
    })
    expect(prisma.__tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        avatarUrl: created.publicUrl,
        avatarSource: "custom",
        systemAvatarId: null,
        customAvatarAssetId: created.id,
      },
    })
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      detail: { source: "custom" },
    }))
  })

  it("rejects unsupported, oversized, and non-square avatar payloads before storage", async () => {
    const { service, prisma, storage } = createService()

    await expect(service.uploadCustom("user-1", {
      bytes: createPng(),
      contentType: "image/jpeg",
    })).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.uploadCustom("user-1", {
      bytes: createPng(256, 255),
      contentType: "image/png",
    })).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.uploadCustom("user-1", {
      bytes: createPng(256, 256, 1024 * 1024 + 1),
      contentType: "image/png",
    })).rejects.toBeInstanceOf(PayloadTooLargeException)

    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it("keeps a failed replacement delete pending for the cleanup job", async () => {
    const { service, prisma, storage } = createService()
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      email: "user@example.com",
      customAvatarAssetId: "asset-old",
    })
    prisma.__tx.userAvatarAsset.findUnique.mockResolvedValue({
      id: "asset-old",
      storageKey: "avatars/users/asset-old.png",
    })
    storage.deleteObject.mockRejectedValue(new Error("COS unavailable"))

    await service.uploadCustom("user-1", {
      bytes: createPng(),
      contentType: "image/png",
    })

    expect(prisma.__tx.userAvatarAsset.update).toHaveBeenCalledWith({
      where: { id: "asset-old" },
      data: { status: "delete_pending", deletePending: true },
    })
    expect(prisma.userAvatarAsset.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "deleted" }),
    }))
  })

  it("resolves immutable public avatar metadata through private storage", async () => {
    const { service, prisma, storage } = createService()
    prisma.systemAvatar.findUnique.mockResolvedValue({
      storageKey: "avatars/system/v1/512/avatar.webp",
      mimeType: "image/webp",
    })
    storage.headObject.mockResolvedValue({
      key: "avatars/system/v1/512/avatar.webp",
      size: 4096n,
      etag: "etag-1",
    })

    await expect(service.resolveSystemAvatar("avatar")).resolves.toEqual({
      storageKey: "avatars/system/v1/512/avatar.webp",
      mimeType: "image/webp",
      size: 4096n,
      etag: "etag-1",
    })
  })
})
