import { PayloadTooLargeException, UnsupportedMediaTypeException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import type { PlatformMediaStorage } from "../drive/platform-media-storage"
import type { PrismaService } from "../prisma/prisma.service"
import { CustomAppIconsService } from "./custom-app-icons.service"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5ZkAAAAASUVORK5CYII=",
  "base64",
)

describe("CustomAppIconsService", () => {
  it("stores normalized PNG icons as pending assets", async () => {
    const prisma = createPrisma()
    const storage = createStorage()
    const service = new CustomAppIconsService(
      prisma as unknown as PrismaService,
      storage as unknown as PlatformMediaStorage,
    )

    const result = await service.stagePng({
      userId: "user-1",
      appId: "cwa_123e4567-e89b-42d3-a456-426614174000",
      png,
    })

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining("custom-app-icons/user-1/"),
      png,
      "image/png",
    )
    expect(prisma.userCustomAppIconAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "pending",
        byteSize: png.length,
      }),
    }))
    expect(result.iconUrl).toContain("/api/custom-apps/icons/")
  })

  it("rejects non-PNG and oversized payloads", async () => {
    const service = new CustomAppIconsService(
      createPrisma() as unknown as PrismaService,
      createStorage() as unknown as PlatformMediaStorage,
    )

    await expect(service.stagePng({
      userId: "user-1",
      appId: "cwa_123e4567-e89b-42d3-a456-426614174000",
      png: Buffer.from("not png"),
    })).rejects.toBeInstanceOf(UnsupportedMediaTypeException)

    await expect(service.stagePng({
      userId: "user-1",
      appId: "cwa_123e4567-e89b-42d3-a456-426614174000",
      png: Buffer.alloc(128 * 1024 + 1),
    })).rejects.toBeInstanceOf(PayloadTooLargeException)
  })

  it("resolves only active icons", async () => {
    const prisma = createPrisma()
    const storage = createStorage()
    const service = new CustomAppIconsService(
      prisma as unknown as PrismaService,
      storage as unknown as PlatformMediaStorage,
    )
    prisma.userCustomAppIconAsset.findFirst.mockResolvedValueOnce(null)
    await expect(service.resolve("icon-1")).resolves.toBeNull()

    prisma.userCustomAppIconAsset.findFirst.mockResolvedValueOnce({
      id: "icon-1",
      storageKey: "custom-app-icons/user-1/icon-1.png",
      mimeType: "image/png",
    })
    storage.headObject.mockResolvedValue({ size: BigInt(png.length), etag: "etag-1" })
    storage.getObjectStream.mockResolvedValue({ stream: {} })

    await expect(service.resolve("icon-1")).resolves.toMatchObject({
      mimeType: "image/png",
      size: BigInt(png.length),
      etag: "etag-1",
    })
  })
})

function createPrisma() {
  return {
    userCustomAppIconAsset: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    userCustomApp: {
      updateMany: vi.fn(),
    },
  }
}

function createStorage() {
  return {
    putObject: vi.fn(),
    deleteObject: vi.fn(),
    headObject: vi.fn(),
    getObjectStream: vi.fn(),
  }
}
