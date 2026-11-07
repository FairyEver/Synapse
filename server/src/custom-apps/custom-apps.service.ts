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
} from "@synapse/shared"
import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"

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
    const settings = await this.ensureSettings(this.prisma, userId)
    const apps = await this.prisma.userCustomApp.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
    return toSnapshot(settings, apps)
  }

  async create(userId: string, input: CustomAppCreateInput): Promise<CustomAppSnapshotDto> {
    const parsed = customAppCreateInputSchema.parse(input)
    const operationHash = hashOperation("create", parsed)
    if (await this.replayOperation(userId, parsed.operationId, operationHash)) {
      return this.snapshot(userId)
    }

    const existing = await this.prisma.userCustomApp.findUnique({ where: { id: parsed.id } })
    if (existing) {
      if (existing.userId !== userId || existing.name !== parsed.name || existing.startUrl !== parsed.startUrl) {
        throw new ConflictException("自定义应用 ID 已存在。")
      }
      return this.snapshot(userId)
    }

    const tombstone = await this.prisma.userCustomAppTombstone.findUnique({
      where: { userId_appId: { userId, appId: parsed.id } },
    })
    if (tombstone) throw new ConflictException("该应用已删除，不能重新创建。")

    const count = await this.prisma.userCustomApp.count({ where: { userId } })
    if (count >= MAX_CUSTOM_APPS) throw new ConflictException("自定义应用数量已达到上限。")

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
      await this.prisma.$transaction(async (tx) => {
        const settings = await this.ensureSettings(tx, userId)
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
        void settings
      })
    } catch (error) {
      if (stagedIconId) await this.icons.discard(stagedIconId)
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
    if (await this.replayOperation(userId, parsed.operationId, operationHash)) {
      return this.snapshot(userId)
    }

    const existing = await this.prisma.userCustomApp.findFirst({
      where: { id, userId },
    })
    if (!existing) throw new NotFoundException("自定义应用不存在。")

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
      await this.prisma.$transaction(async (tx) => {
        await this.ensureSettings(tx, userId)
        await tx.userCustomApp.update({
          where: { id },
          data: {
            ...(parsed.name !== undefined ? { name: parsed.name } : {}),
            ...(parsed.startUrl !== undefined ? { startUrl: parsed.startUrl } : {}),
            ...(parsed.iconSource !== undefined ? { iconSource: parsed.iconSource } : {}),
            ...(stagedIconId ? { iconId: stagedIconId } : {}),
            ...(clearIcon ? { iconId: null } : {}),
            version: { increment: 1 },
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
          data: { appId: id, status: "active", deletePending: false },
        })
      })
    } catch (error) {
      if (stagedIconId) await this.icons.discard(stagedIconId)
      throw error
    }

    if ((stagedIconId || clearIcon) && existing.iconId) await this.icons.discard(existing.iconId)
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
    if (await this.replayOperation(userId, operationId, operationHash)) {
      return this.snapshot(userId)
    }

    const tombstone = await this.prisma.userCustomAppTombstone.findUnique({
      where: { userId_appId: { userId, appId: id } },
    })
    if (tombstone) return this.snapshot(userId)

    const existing = await this.prisma.userCustomApp.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) {
      return this.snapshot(userId)
    }
    const currentSettings = await this.prisma.userCustomAppSettings.findUnique({ where: { userId } })
    const currentDock = asStringArray(currentSettings?.dockAppIds)
    const knownCustomAppIds = new Set(
      currentDock.filter((value) => value.startsWith("cwa_")).concat(id),
    )
    const nextDock = normalizeServerDockLayout(
      currentDock.filter((value) => value !== id),
      { knownCustomAppIds },
    )

    let publishedRevision: number | null = null
    await this.prisma.$transaction(async (tx) => {
      await tx.userCustomAppTombstone.upsert({
        where: { userId_appId: { userId, appId: id } },
        create: { userId, appId: id },
        update: { deletedAt: new Date() },
      })
      await tx.userCustomApp.delete({ where: { id } })
      const settings = await this.ensureSettings(tx, userId)
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
      void settings
    })

    if (existing.iconId) await this.icons.discard(existing.iconId)
    if (publishedRevision !== null) this.events?.publish(userId, publishedRevision)
    return this.snapshot(userId)
  }

  async bootstrap(
    userId: string,
    input: CustomAppBootstrapInput,
  ): Promise<CustomAppSnapshotDto> {
    const parsed = customAppBootstrapInputSchema.parse(input)
    const operationHash = hashOperation("bootstrap", parsed)
    if (await this.replayOperation(userId, parsed.operationId, operationHash)) {
      return this.snapshot(userId)
    }

    let publishedRevision: number | null = null
    await this.prisma.$transaction(async (tx) => {
      const settings = await this.ensureSettings(tx, userId)
      if (settings.initializedAt) return

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

    if (publishedRevision !== null) this.events?.publish(userId, publishedRevision)
    return this.snapshot(userId)
  }

  async applyDockOperation(
    userId: string,
    input: CustomAppDockOperation,
  ): Promise<CustomAppSnapshotDto> {
    const parsed = customAppDockOperationSchema.parse(input) as CustomAppDockOperation
    const operationHash = hashOperation("dock", parsed)
    if (await this.replayOperation(userId, parsed.operationId, operationHash)) {
      return this.snapshot(userId)
    }

    const { operationId, ...action } = parsed
    let publishedRevision: number | null = null
    await this.prisma.$transaction(async (tx) => {
      const settings = await this.ensureSettings(tx, userId)
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

  private async replayOperation(userId: string, operationId: string, operationHash: string): Promise<boolean> {
    const prior = await this.prisma.userCustomAppOperation.findUnique({
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
