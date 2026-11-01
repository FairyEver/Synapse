import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import type { Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { AuditLogService, auditActors } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import { PlatformMediaStorage } from "../drive/platform-media-storage"
import { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { selectRandomSystemAvatar } from "./system-avatar-selection"
import { LIVE_MESSAGE_TYPES, createLiveEnvelope } from "@synapse/shared"

const CUSTOM_AVATAR_MAX_BYTES = 1024 * 1024
const CUSTOM_AVATAR_SIZE = 256
const PENDING_AVATAR_MAX_AGE_MS = 60 * 60 * 1000
const CUSTOM_AVATAR_STATUS = {
  pending: "pending",
  active: "active",
  deletePending: "delete_pending",
  deleted: "deleted",
} as const

type AssetForDeletion = {
  readonly id: string
  readonly storageKey: string
}

export type ResolvedProfileAvatar = {
  readonly storageKey: string
  readonly mimeType: string
  readonly size: bigint
  readonly etag: string | null
}

@Injectable()
export class ProfileAvatarService {
  private readonly logger = new Logger(ProfileAvatarService.name)
  private cleanupRunning = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PlatformMediaStorage,
    private readonly auditLog: AuditLogService,
    @Optional() private readonly liveGateway?: LiveDesktopGateway,
  ) {}

  async randomize(userId: string, ipAddress = "system"): Promise<void> {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        systemAvatarId: true,
        customAvatarAssetId: true,
      },
    })
    const next = await selectRandomSystemAvatar(this.prisma, current.systemAvatarId)
    if (!next) throw new ServiceUnavailableException("系统头像暂不可用。")

    let previous: AssetForDeletion | null = null
    await this.prisma.$transaction(async (tx) => {
      previous = await markCurrentCustomAvatarForDeletion(tx, current.customAvatarAssetId)
      await tx.user.update({
        where: { id: userId },
        data: {
          avatarUrl: next.publicUrl,
          avatarSource: "system",
          systemAvatarId: next.id,
          customAvatarAssetId: null,
        },
      })
    })

    await this.deleteCandidateSafely(previous)
    this.notifyProfileChanged(userId)
    await this.recordAudit(current.email, userId, "random", ipAddress)
  }

  async uploadCustom(
    userId: string,
    input: { readonly bytes: Buffer; readonly contentType: string },
    ipAddress = "system",
  ): Promise<void> {
    if (input.contentType.split(";")[0]?.trim().toLowerCase() !== "image/png") {
      throw new BadRequestException("头像必须是 PNG 图片。")
    }
    validateSquarePng(input.bytes)

    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, customAvatarAssetId: true },
    })
    const assetId = randomUUID()
    const storageKey = `avatars/users/${assetId}.png`
    const publicUrl = `/api/avatars/users/${assetId}`
    await this.prisma.userAvatarAsset.create({
      data: {
        id: assetId,
        userId,
        storageKey,
        publicUrl,
        mimeType: "image/png",
        byteSize: input.bytes.length,
        status: CUSTOM_AVATAR_STATUS.pending,
      },
    })

    try {
      await this.storage.putObject(storageKey, input.bytes, "image/png")
      let previous: AssetForDeletion | null = null
      await this.prisma.$transaction(async (tx) => {
        previous = await markCurrentCustomAvatarForDeletion(tx, current.customAvatarAssetId)
        await tx.userAvatarAsset.update({
          where: { id: assetId },
          data: { status: CUSTOM_AVATAR_STATUS.active },
        })
        await tx.user.update({
          where: { id: userId },
          data: {
            avatarUrl: publicUrl,
            avatarSource: "custom",
            systemAvatarId: null,
            customAvatarAssetId: assetId,
          },
        })
      })
      await this.deleteCandidateSafely(previous)
      this.notifyProfileChanged(userId)
      await this.recordAudit(current.email, userId, "custom", ipAddress)
    } catch (error) {
      await this.markFailedUploadForDeletion(assetId)
      throw error
    }
  }

  async resolveSystemAvatar(id: string): Promise<ResolvedProfileAvatar | null> {
    const avatar = await this.prisma.systemAvatar.findUnique({
      where: { id },
      select: { storageKey: true, mimeType: true },
    })
    if (!avatar) return null
    return this.resolveStoredObject(avatar.storageKey, avatar.mimeType)
  }

  async resolveCustomAvatar(id: string): Promise<ResolvedProfileAvatar | null> {
    const avatar = await this.prisma.userAvatarAsset.findFirst({
      where: {
        id,
        status: CUSTOM_AVATAR_STATUS.active,
        deletePending: false,
        deletedAt: null,
      },
      select: { storageKey: true, mimeType: true },
    })
    if (!avatar) return null
    return this.resolveStoredObject(avatar.storageKey, avatar.mimeType)
  }

  openAvatar(storageKey: string) {
    return this.storage.getObjectStream(storageKey)
  }

  @Cron("*/15 * * * *")
  async cleanupPendingDeletes(): Promise<void> {
    if (this.cleanupRunning) return
    this.cleanupRunning = true
    try {
      const staleBefore = new Date(Date.now() - PENDING_AVATAR_MAX_AGE_MS)
      const candidates = await this.prisma.userAvatarAsset.findMany({
        where: {
          deletedAt: null,
          OR: [
            { deletePending: true },
            { status: CUSTOM_AVATAR_STATUS.pending, createdAt: { lt: staleBefore } },
            {
              status: CUSTOM_AVATAR_STATUS.active,
              updatedAt: { lt: staleBefore },
              currentFor: { is: null },
            },
          ],
        },
        orderBy: { updatedAt: "asc" },
        take: 50,
        select: { id: true, storageKey: true },
      })
      for (const candidate of candidates) {
        await this.markCandidateDeletePending(candidate.id)
        await this.deleteCandidateSafely(candidate)
      }
    } finally {
      this.cleanupRunning = false
    }
  }

  private async resolveStoredObject(storageKey: string, mimeType: string): Promise<ResolvedProfileAvatar | null> {
    const object = await this.storage.headObject(storageKey)
    if (!object) return null
    return {
      storageKey,
      mimeType,
      size: object.size,
      etag: object.etag ?? null,
    }
  }

  private notifyProfileChanged(userId: string): void {
    try {
      const now = new Date().toISOString()
      this.liveGateway?.broadcastToUser(userId, createLiveEnvelope(
        LIVE_MESSAGE_TYPES.accountProfileChanged,
        { userId },
        { id: randomUUID(), sentAt: now },
      ))
    } catch (error) {
      this.logger.warn(
        { userId, errorName: error instanceof Error ? error.name : typeof error },
        "Failed to broadcast account profile change.",
      )
    }
  }

  private async markFailedUploadForDeletion(assetId: string): Promise<void> {
    try {
      const asset = await this.prisma.userAvatarAsset.findUnique({
        where: { id: assetId },
        select: { id: true, storageKey: true },
      })
      if (!asset) return
      await this.markCandidateDeletePending(assetId)
      await this.deleteCandidateSafely(asset)
    } catch (error) {
      this.logger.warn(
        { assetId, errorName: error instanceof Error ? error.name : typeof error },
        "Failed to queue custom avatar cleanup.",
      )
    }
  }

  private async markCandidateDeletePending(id: string): Promise<void> {
    await this.prisma.userAvatarAsset.updateMany({
      where: { id, deletedAt: null },
      data: {
        status: CUSTOM_AVATAR_STATUS.deletePending,
        deletePending: true,
      },
    })
  }

  private async deleteCandidateSafely(asset: AssetForDeletion | null): Promise<void> {
    if (!asset) return
    try {
      await this.storage.deleteObject(asset.storageKey)
      await this.prisma.userAvatarAsset.updateMany({
        where: { id: asset.id, status: CUSTOM_AVATAR_STATUS.deletePending },
        data: {
          status: CUSTOM_AVATAR_STATUS.deleted,
          deletePending: false,
          deletedAt: new Date(),
        },
      })
    } catch (error) {
      this.logger.warn(
        { assetId: asset.id, errorName: error instanceof Error ? error.name : typeof error },
        "Failed to delete replaced custom avatar object.",
      )
    }
  }

  private async recordAudit(
    email: string,
    userId: string,
    avatarSource: "random" | "custom",
    ipAddress: string,
  ): Promise<void> {
    try {
      await this.auditLog.record({
        actor: auditActors.user(userId, email),
        action: "user.profile.avatar_update",
        targetType: "user",
        targetId: userId,
        detail: { source: avatarSource },
        ipAddress,
      })
    } catch (error) {
      this.logger.warn(
        { userId, errorName: error instanceof Error ? error.name : typeof error },
        "Failed to record avatar update audit log.",
      )
    }
  }
}

async function markCurrentCustomAvatarForDeletion(
  tx: Prisma.TransactionClient,
  assetId: string | null,
): Promise<AssetForDeletion | null> {
  if (!assetId) return null
  const asset = await tx.userAvatarAsset.findUnique({
    where: { id: assetId },
    select: { id: true, storageKey: true },
  })
  if (!asset) return null
  await tx.userAvatarAsset.update({
    where: { id: asset.id },
    data: {
      status: CUSTOM_AVATAR_STATUS.deletePending,
      deletePending: true,
    },
  })
  return asset
}

function validateSquarePng(bytes: Buffer): void {
  if (bytes.length === 0) throw new BadRequestException("头像图片为空。")
  if (bytes.length > CUSTOM_AVATAR_MAX_BYTES) throw new PayloadTooLargeException("头像不能超过 1 MB。")
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new BadRequestException("头像必须是有效的 PNG 图片。")
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width !== CUSTOM_AVATAR_SIZE || height !== CUSTOM_AVATAR_SIZE) {
    throw new BadRequestException("头像必须是 256×256 的 PNG 图片。")
  }
}
