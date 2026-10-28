import { Injectable } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { randomBytes } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { detectPublicAssetImageType } from "../drive/drive-public-asset-policy"
import { PlatformMediaStorage } from "../drive/platform-media-storage"
import { PrismaService } from "../prisma/prisma.service"

export const NOTIFICATION_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const pendingTtlMs = 24 * 60 * 60 * 1000

export class NotificationImageInvalidTypeError extends Error {
  constructor() { super("Notification image type is not supported."); this.name = "NotificationImageInvalidTypeError" }
}
export class NotificationImageUnavailableError extends Error {
  constructor() { super("Notification image is unavailable."); this.name = "NotificationImageUnavailableError" }
}

@Injectable()
export class NotificationImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PlatformMediaStorage,
  ) {}

  async stage(userId: string, bytes: Buffer): Promise<{ id: string; mimeType: string; byteSize: number }> {
    const mimeType = detectPublicAssetImageType(bytes)
    if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) throw new NotificationImageInvalidTypeError()
    const objectKey = `notification-images/${randomBytes(24).toString("base64url")}`
    await this.storage.putObject(objectKey, bytes, mimeType)
    try {
      return await this.prisma.notificationImage.create({
        data: { userId, objectKey, mimeType, byteSize: bytes.length, state: "pending", expiresAt: new Date(Date.now() + pendingTtlMs) },
        select: { id: true, mimeType: true, byteSize: true },
      })
    } catch (error) {
      await this.storage.deleteObject(objectKey).catch(() => undefined)
      throw error
    }
  }

  async claimInTransaction(tx: Prisma.TransactionClient, userId: string, imageId: string): Promise<void> {
    const claimed = await tx.notificationImage.updateMany({
      where: { id: imageId, userId, state: "pending", expiresAt: { gt: new Date() } },
      data: { state: "attached", expiresAt: null },
    })
    if (claimed.count === 0) throw new NotificationImageUnavailableError()
  }

  async open(imageId: string): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; byteSize: number } | null> {
    const image = await this.prisma.notificationImage.findUnique({
      where: { id: imageId },
      select: { objectKey: true, mimeType: true, byteSize: true },
    })
    if (!image) return null
    const object = await this.storage.getObjectStream(image.objectKey)
    return { stream: object.stream, mimeType: image.mimeType, byteSize: image.byteSize }
  }

  async deleteByIds(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    const rows = await this.prisma.notificationImage.findMany({ where: { id: { in: [...ids] } }, select: { id: true, objectKey: true } })
    for (const row of rows) await this.storage.deleteObject(row.objectKey)
    if (rows.length > 0) await this.prisma.notificationImage.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })
  }

  @Cron("0 */10 * * * *")
  async prunePending(): Promise<void> {
    const rows = await this.prisma.notificationImage.findMany({
      where: { state: "pending", expiresAt: { lt: new Date() } },
      select: { id: true, objectKey: true },
    })
    for (const row of rows) await this.storage.deleteObject(row.objectKey)
    if (rows.length > 0) await this.prisma.notificationImage.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })
  }
}
