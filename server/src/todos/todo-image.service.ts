import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { createHash } from "node:crypto"
import type { Prisma, TodoImage } from "@prisma/client"
import { TODO_MAX_IMAGES, TODO_MAX_IMAGE_BYTES } from "@synapse/shared/todo-contracts"
import { detectPublicAssetImageType } from "../drive/drive-public-asset-policy"
import { PlatformMediaStorage, TODO_IMAGE_STORAGE_PREFIX } from "../drive/platform-media-storage"
import { PrismaService } from "../prisma/prisma.service"

const pendingTtlMs = 24 * 60 * 60 * 1000
const pendingCountLimit = TODO_MAX_IMAGES * 3
const pendingBytesLimit = TODO_MAX_IMAGES * TODO_MAX_IMAGE_BYTES
const imageKey = (id: string, variant: "original" | "thumbnail") => `${TODO_IMAGE_STORAGE_PREFIX}${id}/${variant}`
const unavailable = () => new NotFoundException({ code: "TODO_IMAGE_UNAVAILABLE", message: "图片已失效或无法访问" })
const expired = (now: Date): Prisma.TodoImageWhereInput => ({
  todoId: null, OR: [{ expiresAt: null }, { expiresAt: { lte: now } }],
})

@Injectable()
export class TodoImageService {
  private readonly logger = new Logger(TodoImageService.name)
  constructor(private readonly prisma: PrismaService, private readonly storage: PlatformMediaStorage) {}

  async stage(userId: string, id: string, original: Buffer, thumbnail: Buffer): Promise<{ imageId: string }> {
    const mimeType = detectPublicAssetImageType(original)
    if (!mimeType || detectPublicAssetImageType(thumbnail) !== "image/webp") {
      throw new BadRequestException({ code: "TODO_IMAGE_FORMAT", message: "图片格式不支持或无法读取" })
    }
    const sha256 = createHash("sha256").update(original).digest("hex")
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"todo-images:" + userId}, 0))::text`
      const row = await tx.todoImage.findUnique({ where: { id } })
      if (row) {
        this.checkStage(row, userId, sha256)
        return
      }
      const now = new Date()
      const pending = await tx.todoImage.aggregate({
        where: { userId, todoId: null, expiresAt: { gt: now } }, _count: { _all: true }, _sum: { byteSize: true },
      })
      if (pending._count._all >= pendingCountLimit || (pending._sum.byteSize ?? 0) + original.length > pendingBytesLimit) {
        throw new HttpException({ code: "TODO_IMAGE_PENDING_LIMIT", message: "待保存的图片过多，请稍后重试" }, 429)
      }
      await tx.todoImage.create({ data: {
        id, userId, mimeType, sha256, byteSize: original.length, thumbnailSize: thumbnail.length,
        expiresAt: new Date(now.getTime() + pendingTtlMs),
      } })
    })

    // The reservation survives a failed upload. Serializing writes for this ID avoids
    // overwriting a claimed image and lets an exact retry finish a partial upload.
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "TodoImage" WHERE "id" = ${id}::uuid FOR UPDATE`
      const row = await tx.todoImage.findUnique({ where: { id } })
      if (!row) throw unavailable()
      this.checkStage(row, userId, sha256)
      if (row.ready) return
      try {
        await this.storage.putObject(imageKey(id, "original"), original, mimeType)
        await this.storage.putObject(imageKey(id, "thumbnail"), thumbnail, "image/webp")
      } catch (error) {
        this.logger.warn({ imageId: id, errorName: error instanceof Error ? error.name : typeof error }, "Todo image upload failed")
        throw new ServiceUnavailableException({ code: "TODO_IMAGE_UPLOAD_FAILED", message: "图片上传失败，请重试" })
      }
      this.checkStage(row, userId, sha256)
      await tx.todoImage.update({ where: { id }, data: { ready: true, thumbnailSize: thumbnail.length } })
    }, { timeout: 45_000 })
    return { imageId: id }
  }

  private checkStage(row: TodoImage, userId: string, sha256: string): void {
    if (row.userId !== userId || (!row.todoId && (!row.expiresAt || row.expiresAt <= new Date()))) throw unavailable()
    if (row.sha256 !== sha256) throw new ConflictException({ code: "TODO_IMAGE_CONFLICT", message: "图片请求已用于其他内容" })
  }

  async open(userId: string, todoId: string, id: string, variant: "original" | "thumbnail") {
    const row = await this.prisma.todoImage.findFirst({
      where: { id, userId, todoId, ready: true, todo: { is: { userId, deletedAt: null } } },
      select: { mimeType: true, byteSize: true, thumbnailSize: true },
    })
    if (!row) throw unavailable()
    const { stream } = await this.storage.getObjectStream(imageKey(id, variant))
    return { stream, mimeType: variant === "thumbnail" ? "image/webp" : row.mimeType,
      byteSize: variant === "thumbnail" ? row.thumbnailSize : row.byteSize }
  }

  @Cron("0 */10 * * * *", { waitForCompletion: true })
  async prune(now = new Date()): Promise<void> {
    const rows = await this.prisma.todoImage.findMany({
      where: expired(now), select: { id: true }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: 50,
    })
    for (const { id } of rows) {
      try {
        await this.prisma.$transaction(async tx => {
          const lock = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "TodoImage" WHERE "id" = ${id}::uuid FOR UPDATE SKIP LOCKED`
          if (!lock.length || !await tx.todoImage.findFirst({ where: { id, ...expired(now) }, select: { id: true } })) return
          await this.storage.deleteObject(imageKey(id, "original"))
          await this.storage.deleteObject(imageKey(id, "thumbnail"))
          await tx.todoImage.delete({ where: { id } })
        }, { timeout: 45_000 })
      } catch (error) {
        this.logger.warn({ imageId: id, errorName: error instanceof Error ? error.name : typeof error }, "Todo image cleanup failed")
      }
    }
  }
}
