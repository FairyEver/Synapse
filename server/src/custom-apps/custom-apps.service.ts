import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import {
  CUSTOM_APPS_API_PATHS,
  DOCK_CATALOG_VERSION,
  customAppBootstrapInputSchema,
  customAppCreateInputSchema,
  customAppDockOperationSchema,
  customAppUpdateInputSchema,
  type CustomAppBootstrapInput,
  type CustomAppCreateInput,
  type CustomAppDockOperation,
  type CustomAppDto,
  type CustomAppId,
  type CustomAppSnapshotDto,
  type CustomAppUpdateInput,
} from "@synapse/shared/custom-apps-contracts"
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../prisma/prisma.service"
import { applyServerDockAction, normalizeServerDockLayout } from "./custom-app-dock"
import { CustomAppIconsService } from "./custom-app-icons.service"
import { CustomAppEvents } from "./custom-app-events"

const MAX_CUSTOM_APPS = 100
const OPERATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

type CustomAppRecord = {
  readonly id: string
  readonly userId: string
  readonly kind: string
  readonly name: string
  readonly startUrl: string
  readonly iconId: string | null
  readonly iconSource: string
  readonly version: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

type CustomAppSettingsRecord = {
  readonly userId: string
  readonly dockAppIds: Prisma.JsonValue
  readonly dockMigrationIds: Prisma.JsonValue
  readonly dockCatalogVersion: number
  readonly revision: number
  readonly initializedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

@Injectable()
export class CustomAppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly icons: CustomAppIconsService,
    @Optional() private readonly events?: CustomAppEvents,
  ) {}

  async snapshot(userId: string): Promise<CustomAppSnapshotDto> {
    return this.prisma.$transaction(async (tx) => {
      const settings = await this.ensureSettings(tx, userId)
      const apps = await tx.userCustomApp.findMany({
        where: { userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
      return toSnapshot(settings, apps)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    })
  }

  async create(userId: string, input: CustomAppCreateInput): Promise<CustomAppSnapshotDto> {
    const parsed = customAppCreateInputSchema.parse(input)
    const operationHash = hashOperation("create", parsed)

    let stagedIconId: string | null = null
    if (parsed.iconPngBase64) {
      const staged = await this.icons.stagePng({
        userId,
        appId: parsed.id,
        png: Buffer.from(parsed.iconPngBase64, "base64"),
      })
      stagedIconId = staged.iconId
    }

    let publishedRevision: number | null = null
    try {
      const result = await this.runLocked(userId, async (tx) => {
        if (await this.replayOperation(tx, userId, parsed.operationId, operationHash)) {
          return { created: false, revision: null }
        }

        const existing = await tx.userCustomApp.findUnique({ where: { id: parsed.id } })
        if (existing) {
          if (existing.userId !== userId || existing.name !== parsed.name || existing.startUrl !== parsed.startUrl) {
            throw new ConflictException("自定义应用 ID 已存在。")
          }
          return { created: false, revision: null }
        }

        const tombstone = await tx.userCustomAppTombstone.findUnique({
          where: { userId_appId: { userId, appId: parsed.id } },
        })
        if (tombstone) throw new ConflictException("该应用已删除，不能重新创建。")

        const count = await tx.userCustomApp.count({ where: { userId } })
        if (count >= MAX_CUSTOM_APPS) throw new ConflictException("自定义应用数量已达到上限。")

        const app = await tx.userCustomApp.create({
          data: {
            id: parsed.id,
            userId,
            kind: "web",
            name: parsed.name,
            startUrl: parsed.startUrl,
            iconId: stagedIconId,
            iconSource: parsed.iconSource,
          },
        })
        const nextSettings = await tx.userCustomAppSettings.update({
          where: { userId },
          data: { revision: { increment: 1 }, dockCatalogVersion: DOCK_CATALOG_VERSION },
        })
        publishedRevision = nextSettings.revision
        await this.recordOperation(tx, {
          userId,
          operationId: parsed.operationId,
          operationHash,
          resultRevision: nextSettings.revision,
        })
        if (stagedIconId) await tx.userCustomAppIconAsset.updateMany({
          where: { id: stagedIconId, userId, status: "pending" },
          data: { appId: app.id, status: "active", deletePending: false },
        })
        return { created: true, revision: nextSettings.revision }
      })
      if (!result.created && stagedIconId) await this.icons.discard(stagedIconId)
    } catch (error) {
      if (stagedIconId) await this.icons.discard(stagedIconId)
      if (isPrismaUniqueConstraintError(error)) {
        throw new ConflictException("自定义应用 ID 或操作标识已存在。")
      }
      throw error
    }

    if (publishedRevision !== null) this.events?.publish(userId, publishedRevision)
    return this.snapshot(userId)
  }

  async update(
    userId: string,
    id: CustomAppId,
    input: CustomAppUpdateInput,
  ): Promise<CustomAppSnapshotDto> {
    const parsed = customAppUpdateInputSchema.parse(input)
    const operationHash = hashOperation("update", { id, ...parsed })

    let stagedIconId: string | null = null
    if (typeof parsed.iconPngBase64 === "string") {
      const staged = await this.icons.stagePng({
        userId,
        appId: id,
        png: Buffer.from(parsed.iconPngBase64, "base64"),
      })
      stagedIconId = staged.iconId
    }
    const clearIcon = parsed.iconPngBase64 === null

    let publishedRevision: number | null = null
    try {
      const result = await this.runLocked(userId, async (tx) => {
        if (await this.replayOperation(tx, userId, parsed.operationId, operationHash)) {
          return { updated: false, previousIconId: null }
        }
        const existing = await tx.userCustomApp.findFirst({
          where: { id, userId },
        })
        if (!existing) throw new NotFoundException("自定义应用不存在。")

        const updated = await tx.userCustomApp.updateMany({
          where: { id, userId },
          data: {
            ...(parsed.name !== undefined ? { name: parsed.name } : {}),
            ...(parsed.startUrl !== undefined ? { startUrl: parsed.startUrl } : {}),
            ...(parsed.iconSource !== undefined ? { iconSource: parsed.iconSource } : {}),
            ...(stagedIconId ? { iconId: stagedIconId } : {}),
            ...(clearIcon ? { iconId: null } : {}),
            version: { increment: 1 },
          },
        })
        if (updated.count === 0) throw new NotFoundException("自定义应用不存在。")
        const nextSettings = await tx.userCustomAppSettings.update({
          where: { userId },
          data: { revision: { increment: 1 }, dockCatalogVersion: DOCK_CATALOG_VERSION },
        })
        publishedRevision = nextSettings.revision
        await this.recordOperation(tx, {
          userId,
          operationId: parsed.operationId,
          operationHash,
          resultRevision: nextSettings.revision,
        })
        if (stagedIconId) await tx.userCustomAppIconAsset.updateMany({
          where: { id: stagedIconId, userId, status: "pending" },
          data: { appId: id, status: "active", deletePending: false },
        })
        return { updated: true, previousIconId: existing.iconId }
      })
      if (!result.updated && stagedIconId) await this.icons.discard(stagedIconId)
      if (result.updated && (stagedIconId || clearIcon) && result.previousIconId) {
        await this.icons.discard(result.previousIconId)
      }
    } catch (error) {
      if (stagedIconId) await this.icons.discard(stagedIconId)
      if (isPrismaUniqueConstraintError(error)) {
        throw new ConflictException("操作标识已被使用。")
      }
      throw error
    }

    if (publishedRevision !== null) this.events?.publish(userId, publishedRevision)
    return this.snapshot(userId)
  }

  async delete(
    userId: string,
    id: CustomAppId,
    input: { readonly operationId: string },
  ): Promise<CustomAppSnapshotDto> {
    const operationId = input.operationId.trim()
    if (!operationId) throw new ConflictException("操作标识无效。")
    const operationHash = hashOperation("delete", { id })

    let publishedRevision: number | null = null
    let deletedIconId: string | null = null
    try {
      const result = await this.runLocked(userId, async (tx, settings) => {
        if (await this.replayOperation(tx, userId, operationId, operationHash)) {
          return { deleted: false, iconId: null }
        }

        const tombstone = await tx.userCustomAppTombstone.findUnique({
          where: { userId_appId: { userId, appId: id } },
        })
        if (tombstone) {
          await this.recordOperation(tx, {
            userId,
            operationId,
            operationHash,
            resultRevision: settings.revision,
          })
          return { deleted: false, iconId: null }
        }

        const existing = await tx.userCustomApp.findFirst({ where: { id, userId } })
        if (!existing) {
          await this.recordOperation(tx, {
            userId,
            operationId,
            operationHash,
            resultRevision: settings.revision,
          })
          return { deleted: false, iconId: null }
        }

        const apps = await tx.userCustomApp.findMany({
          where: { userId },
          select: { id: true },
        })
        const nextDock = normalizeServerDockLayout(
          asStringArray(settings.dockAppIds).filter((value) => value !== id),
          { knownCustomAppIds: new Set(apps.map((app) => app.id).filter((appId) => appId !== id)) },
        )
        await tx.userCustomAppTombstone.upsert({
          where: { userId_appId: { userId, appId: id } },
          create: { userId, appId: id },
          update: { deletedAt: new Date() },
        })
        await tx.userCustomApp.deleteMany({ where: { id, userId } })
        const nextSettings = await tx.userCustomAppSettings.update({
          where: { userId },
          data: {
            dockAppIds: nextDock,
            dockCatalogVersion: DOCK_CATALOG_VERSION,
            revision: { increment: 1 },
          },
        })
        publishedRevision = nextSettings.revision
        await this.recordOperation(tx, {
          userId,
          operationId,
          operationHash,
          resultRevision: nextSettings.revision,
        })
        return { deleted: true, iconId: existing.iconId }
      })
      deletedIconId = result.iconId
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new ConflictException("操作标识已被使用。")
      }
      throw error
    }

    if (deletedIconId) await this.icons.discard(deletedIconId)
    if (publishedRevision !== null) this.events?.publish(userId, publishedRevision)
    return this.snapshot(userId)
  }

  async bootstrap(
    userId: string,
    input: CustomAppBootstrapInput,
  ): Promise<CustomAppSnapshotDto> {
    const parsed = customAppBootstrapInputSchema.parse(input)
    const operationHash = hashOperation("bootstrap", parsed)

    let publishedRevision: number | null = null
    try {
      await this.runLocked(userId, async (tx, settings) => {
        if (await this.replayOperation(tx, userId, parsed.operationId, operationHash)) return
        if (settings.initializedAt) {
          await this.recordOperation(tx, {
            userId,
            operationId: parsed.operationId,
            operationHash,
            resultRevision: settings.revision,
          })
          return
        }

        const apps = await tx.userCustomApp.findMany({
          where: { userId },
          select: { id: true },
        })
        const dockAppIds = normalizeServerDockLayout(parsed.dockAppIds, {
          knownCustomAppIds: new Set(apps.map((app) => app.id)),
        })
        const nextSettings = await tx.userCustomAppSettings.update({
          where: { userId },
          data: {
            dockAppIds,
            dockMigrationIds: [...new Set(parsed.dockMigrationIds)],
            dockCatalogVersion: DOCK_CATALOG_VERSION,
            initializedAt: new Date(),
            revision: { increment: 1 },
          },
        })
        publishedRevision = nextSettings.revision
        await this.recordOperation(tx, {
          userId,
          operationId: parsed.operationId,
          operationHash,
          resultRevision: nextSettings.revision,
        })
      })
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new ConflictException("操作标识已被使用。")
      }
      throw error
    }

    if (publishedRevision !== null) this.events?.publish(userId, publishedRevision)
    return this.snapshot(userId)
  }

  async applyDockOperation(
    userId: string,
    input: CustomAppDockOperation,
  ): Promise<CustomAppSnapshotDto> {
    const parsed = customAppDockOperationSchema.parse(input) as CustomAppDockOperation
    const operationHash = hashOperation("dock", parsed)

    const { operationId, ...action } = parsed
    let publishedRevision: number | null = null
    try {
      await this.runLocked(userId, async (tx, settings) => {
        if (await this.replayOperation(tx, userId, operationId, operationHash)) return
        const apps = await tx.userCustomApp.findMany({
          where: { userId },
          select: { id: true },
        })
        const currentDock = normalizeServerDockLayout(asStringArray(settings.dockAppIds), {
          knownCustomAppIds: new Set(apps.map((app) => app.id)),
        })
        const result = applyServerDockAction(currentDock, action, {
          knownCustomAppIds: new Set(apps.map((app) => app.id)),
          appliedMigrationIds: asStringArray(settings.dockMigrationIds),
        })
        const nextSettings = await tx.userCustomAppSettings.update({
          where: { userId },
          data: {
            dockAppIds: result.dockAppIds,
            dockMigrationIds: result.dockMigrationIds,
            dockCatalogVersion: DOCK_CATALOG_VERSION,
            revision: { increment: 1 },
          },
        })
        publishedRevision = nextSettings.revision
        await this.recordOperation(tx, {
          userId,
          operationId,
          operationHash,
          resultRevision: nextSettings.revision,
        })
      })
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new ConflictException("操作标识已被使用。")
      }
      throw error
    }

    if (publishedRevision !== null) this.events?.publish(userId, publishedRevision)
    return this.snapshot(userId)
  }

  @Cron("0 3 * * *")
  async cleanupOperationReceipts(): Promise<void> {
    await this.prisma.userCustomAppOperation.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    })
  }

  private ensureSettings(
    client: Pick<PrismaService, "userCustomAppSettings"> | Prisma.TransactionClient,
    userId: string,
  ): Promise<CustomAppSettingsRecord> {
    return client.userCustomAppSettings.upsert({
      where: { userId },
      create: {
        userId,
        dockAppIds: [],
        dockMigrationIds: [],
        dockCatalogVersion: DOCK_CATALOG_VERSION,
        revision: 0,
      },
      update: {},
    }) as Promise<CustomAppSettingsRecord>
  }

  private runLocked<T>(
    userId: string,
    run: (tx: Prisma.TransactionClient, settings: CustomAppSettingsRecord) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // PostgreSQL returns void for advisory locks, which Prisma cannot deserialize.
      await tx.$queryRaw`
        WITH lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
        )
        SELECT 1 AS locked FROM lock
      `
      const settings = await this.ensureSettings(tx, userId)
      return run(tx, settings)
    })
  }

  private async replayOperation(
    client: Pick<PrismaService, "userCustomAppOperation"> | Prisma.TransactionClient,
    userId: string,
    operationId: string,
    operationHash: string,
  ): Promise<boolean> {
    const prior = await client.userCustomAppOperation.findUnique({
      where: { userId_operationId: { userId, operationId } },
    })
    if (!prior) return false
    if (prior.operationHash !== operationHash) throw new ConflictException("操作标识已被使用。")
    return true
  }

  private recordOperation(
    tx: Prisma.TransactionClient,
    input: {
      readonly userId: string
      readonly operationId: string
      readonly operationHash: string
      readonly resultRevision: number
    },
  ): Promise<unknown> {
    return tx.userCustomAppOperation.create({
      data: {
        ...input,
        expiresAt: new Date(Date.now() + OPERATION_TTL_MS),
      },
    })
  }
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "P2002"
}

export function toSnapshot(
  settings: CustomAppSettingsRecord,
  apps: readonly CustomAppRecord[],
): CustomAppSnapshotDto {
  const knownCustomAppIds = new Set(apps.map((app) => app.id))
  const migrationIds = asStringArray(settings.dockMigrationIds)
  return {
    schemaVersion: 1,
    revision: settings.revision,
    initialized: settings.initializedAt !== null,
    dockCatalogVersion: settings.dockCatalogVersion,
    apps: apps.map(toDto),
    dockAppIds: normalizeServerDockLayout(asStringArray(settings.dockAppIds), {
      knownCustomAppIds,
    }),
    dockMigrationIds: migrationIds,
  }
}

function toDto(row: CustomAppRecord): CustomAppDto {
  return {
    id: row.id as CustomAppId,
    kind: row.kind,
    schemaVersion: 1,
    name: row.name,
    startUrl: row.startUrl,
    iconUrl: row.iconId
      ? `${CUSTOM_APPS_API_PATHS.icons}/${encodeURIComponent(row.iconId)}`
      : null,
    iconSource: row.iconSource === "custom" ? "custom" : "favicon",
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function asStringArray(value: Prisma.JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function hashOperation(type: string, value: unknown): string {
  return createHash("sha256").update(JSON.stringify({ type, value })).digest("hex")
}
