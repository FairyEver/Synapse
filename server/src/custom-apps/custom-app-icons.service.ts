import {
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { randomUUID } from "node:crypto"

import { PlatformMediaStorage } from "../drive/platform-media-storage"
import { PrismaService } from "../prisma/prisma.service"

const MAX_ICON_BYTES = 128 * 1024
const PENDING_ICON_MAX_AGE_MS = 60 * 60 * 1000
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

type ResolvedCustomAppIcon = {
  readonly stream: NodeJS.ReadableStream
  readonly mimeType: "image/png"
  readonly size: bigint
  readonly etag: string | null
}

@Injectable()
export class CustomAppIconsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PlatformMediaStorage,
  ) {}

  async stagePng(input: {
    readonly userId: string
    readonly appId: string
    readonly png: Buffer
  }): Promise<{ readonly iconId: string; readonly iconUrl: string }> {
    if (input.png.length > MAX_ICON_BYTES) throw new PayloadTooLargeException("应用图标不能超过 128 KiB。")
    if (!isPng(input.png)) throw new UnsupportedMediaTypeException("应用图标必须是 PNG 图片。")

    const iconId = randomUUID()
    const storageKey = `custom-app-icons/${input.userId}/${iconId}.png`
    await this.prisma.userCustomAppIconAsset.create({
      data: {
        id: iconId,
        userId: input.userId,
        appId: null,
        storageKey,
        mimeType: "image/png",
        byteSize: input.png.length,
        status: "pending",
      },
    })
    try {
      await this.storage.putObject(storageKey, input.png, "image/png")
    } catch (error) {
      await this.discard(iconId)
      throw error
    }
    return {
      iconId,
      iconUrl: `/api/custom-apps/icons/${encodeURIComponent(iconId)}`,
    }
  }

  async activate(iconId: string, appId: string, userId: string): Promise<void> {
    await this.prisma.userCustomAppIconAsset.updateMany({
      where: { id: iconId, userId, status: "pending", deletePending: false },
      data: { appId, status: "active" },
    })
  }

  async discard(iconId: string): Promise<void> {
    const asset = await this.prisma.userCustomAppIconAsset.findFirst({
      where: { id: iconId, deletedAt: null },
      select: { id: true, storageKey: true },
    })
    if (!asset) return

    await this.prisma.userCustomAppIconAsset.updateMany({
      where: { id: asset.id, deletedAt: null },
      data: { status: "delete_pending", deletePending: true },
    })
    try {
      await this.storage.deleteObject(asset.storageKey)
      await this.prisma.userCustomAppIconAsset.updateMany({
        where: { id: asset.id },
        data: { status: "deleted", deletePending: false, deletedAt: new Date() },
      })
    } catch {
      // The cleanup cron retries delete_pending objects.
    }
  }

  async resolve(iconId: string): Promise<ResolvedCustomAppIcon | null> {
    const asset = await this.prisma.userCustomAppIconAsset.findFirst({
      where: {
        id: iconId,
        mimeType: "image/png",
        status: "active",
        deletePending: false,
        deletedAt: null,
      },
      select: { id: true, storageKey: true, mimeType: true },
    })
    if (!asset) return null

    const object = await this.storage.headObject(asset.storageKey)
    if (!object) return null
    const stream = await this.storage.getObjectStream(asset.storageKey)
    return {
      stream: stream.stream,
      mimeType: "image/png",
      size: object.size,
      etag: object.etag ?? null,
    }
  }

  @Cron("*/15 * * * *")
  async cleanupStale(): Promise<void> {
    const staleBefore = new Date(Date.now() - PENDING_ICON_MAX_AGE_MS)
    const candidates = await this.prisma.userCustomAppIconAsset.findMany({
      where: {
        deletedAt: null,
        OR: [
          { deletePending: true },
          { status: "pending", createdAt: { lt: staleBefore } },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: 50,
      select: { id: true },
    })
    for (const candidate of candidates) await this.discard(candidate.id)
  }
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= PNG_SIGNATURE.length
    && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
}
