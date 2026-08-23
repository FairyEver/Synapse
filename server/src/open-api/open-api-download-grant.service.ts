import { Inject, Injectable } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma } from "@prisma/client"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { PinoLogger } from "nestjs-pino"
import { DrivePublicAssetService } from "../drive/drive-public-asset.service"
import { DriveService } from "../drive/drive.service"
import { DriveSiteService } from "../drive/drive-site.service"
import type { DriveStoragePort } from "../drive/drive-storage"
import type {
  DriveOpenApiDownloadArtifact,
  DriveOpenApiDownloadTarget,
} from "../drive/drive-open-api-download"
import { PrismaService } from "../prisma/prisma.service"
import { OpenApiHttpError } from "./open-api.types"

const OPEN_API_DOWNLOAD_PLAN_VERSION = 1
const OPEN_API_DOWNLOAD_TTL_MS = 10 * 60 * 1000
const OPEN_API_DOWNLOAD_LEASE_HEARTBEAT_MS = 30 * 1000
const OPEN_API_DOWNLOAD_LEASE_WINDOW_MS = 60 * 1000

const grantInclude = {
  entries: {
    orderBy: { ordinal: "asc" },
    include: { driveFileVersion: true },
  },
  apiKey: {
    select: {
      revokedAt: true,
      user: { select: { status: true } },
    },
  },
} satisfies Prisma.OpenApiDownloadGrantInclude

export type ResolvedOpenApiDownloadGrant = Prisma.OpenApiDownloadGrantGetPayload<{
  include: typeof grantInclude
}>

@Injectable()
export class OpenApiDownloadGrantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
    private readonly sites: DriveSiteService,
    private readonly publicAssets: DrivePublicAssetService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
    private readonly logger: PinoLogger,
  ) {}

  async create(input: {
    readonly userId: string
    readonly apiKeyId: string
    readonly artifact: DriveOpenApiDownloadArtifact
    readonly now?: Date
  }): Promise<{
    readonly grantId: string
    readonly token: string
    readonly expiresAt: Date
    readonly snapshotId: string
  }> {
    const now = input.now ?? new Date()
    const expiresAt = new Date(now.getTime() + OPEN_API_DOWNLOAD_TTL_MS)
    const token = randomBytes(32).toString("base64url")
    const tokenHash = hashSecret(token)
    const grantId = `dlg_${randomBytes(16).toString("hex")}`
    const snapshotId = createSnapshotId(input.artifact)
    const versionIds = input.artifact.entries
      .map((entry) => entry.driveFileVersionId)
      .filter((id): id is string => Boolean(id))

    await this.prisma.$transaction(async (tx) => {
      if (versionIds.length > 0) {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "DriveFileVersion"
          WHERE "id" IN (${Prisma.join(versionIds)})
          FOR UPDATE
        `)
        const availableVersions = await tx.driveFileVersion.count({
          where: {
            id: { in: versionIds },
            deletedAt: null,
            deletePending: false,
          },
        })
        if (availableVersions !== new Set(versionIds).size) {
          throw new OpenApiHttpError(404, "LINK_NOT_FOUND", "分享链接不存在或已失效。")
        }
      }
      await tx.openApiDownloadGrant.create({
        data: {
          id: grantId,
          tokenHash,
          apiKeyId: input.apiKeyId,
          userId: input.userId,
          sourceType: input.artifact.sourceType,
          artifactType: input.artifact.artifactType,
          planVersion: OPEN_API_DOWNLOAD_PLAN_VERSION,
          snapshotId,
          fileName: input.artifact.fileName,
          mimeType: input.artifact.mimeType,
          size: input.artifact.size,
          entryPath: input.artifact.entryPath,
          target: input.artifact.target as Prisma.InputJsonValue,
          expiresAt,
          leaseUntil: expiresAt,
          createdAt: now,
          entries: {
            create: input.artifact.entries.map((entry, ordinal) => ({
              ordinal,
              entryType: entry.entryType,
              relativePath: entry.relativePath,
              storageKey: entry.storageKey,
              driveFileVersionId: entry.driveFileVersionId,
              size: entry.size,
              mimeType: entry.mimeType,
              etag: entry.etag,
              sha256: entry.sha256,
            })),
          },
        },
      })
    })
    return { grantId, token, expiresAt, snapshotId }
  }

  async authenticate(grantId: string, token: string | undefined): Promise<ResolvedOpenApiDownloadGrant> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      throw new OpenApiHttpError(400, "INVALID_DOWNLOAD_TOKEN", "临时下载凭证无效。")
    }
    const grant = await this.prisma.openApiDownloadGrant.findUnique({
      where: { id: grantId },
      include: grantInclude,
    })
    const actual = Buffer.from(hashSecret(token), "hex")
    const expected = Buffer.from(grant?.tokenHash ?? "0".repeat(64), "hex")
    const matches = timingSafeEqual(actual, expected)
    if (!grant || !matches) {
      throw new OpenApiHttpError(404, "DOWNLOAD_NOT_FOUND", "临时下载地址不存在。")
    }
    return grant
  }

  async assertAvailable(grant: ResolvedOpenApiDownloadGrant, now = new Date()): Promise<void> {
    if (
      grant.expiresAt.getTime() <= now.getTime()
      || grant.planVersion !== OPEN_API_DOWNLOAD_PLAN_VERSION
      || grant.apiKey.revokedAt
      || grant.apiKey.user.status !== "active"
    ) {
      throw downloadUnavailable()
    }
    const target = parseTarget(grant.target)
    const sourceActive = target.kind === "share"
      ? await this.drive.revalidateOpenApiShareTarget(target)
      : target.kind === "site"
        ? await this.sites.revalidateOpenApiSiteTarget(target)
        : await this.publicAssets.revalidateOpenApiPublicAssetTarget({
          ...target,
          storageKey: grant.entries[0]?.storageKey ?? "",
        })
    if (!sourceActive) throw downloadUnavailable()
    if (
      target.kind === "site"
      && !await this.sites.revalidateOpenApiSiteEntries({
        deploymentId: target.deploymentId,
        entries: grant.entries,
      })
    ) {
      throw downloadUnavailable()
    }

    for (const entry of grant.entries) {
      if (entry.entryType === "directory") continue
      if (!entry.storageKey || entry.size === null) throw downloadUnavailable()
      if (entry.driveFileVersionId) {
        const version = entry.driveFileVersion
        if (
          !version
          || version.deletedAt
          || version.deletePending
          || version.storageKey !== entry.storageKey
          || version.size !== entry.size
          || (entry.etag && version.etag !== entry.etag)
        ) {
          throw downloadUnavailable()
        }
      }
      const object = await this.storage.headObject(entry.storageKey)
      if (!object || object.size !== entry.size || (entry.etag && object.etag !== entry.etag)) {
        throw downloadUnavailable()
      }
    }
  }

  async renewLease(grantId: string, now = new Date()): Promise<void> {
    const leaseUntil = new Date(now.getTime() + OPEN_API_DOWNLOAD_LEASE_WINDOW_MS)
    await this.prisma.openApiDownloadGrant.updateMany({
      where: { id: grantId, leaseUntil: { lt: leaseUntil } },
      data: { leaseUntil },
    })
  }

  leaseHeartbeatMs(): number {
    return OPEN_API_DOWNLOAD_LEASE_HEARTBEAT_MS
  }

  @Cron("10 3 * * *")
  async cleanupExpired(now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    try {
      await this.prisma.openApiDownloadGrant.deleteMany({
        where: { expiresAt: { lt: cutoff }, leaseUntil: { lt: now } },
      })
    } catch (error) {
      this.logger.warn({
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Open API download grant cleanup failed")
    }
  }
}

function createSnapshotId(artifact: DriveOpenApiDownloadArtifact): string {
  const descriptor = {
    sourceType: artifact.sourceType,
    artifactType: artifact.artifactType,
    entryPath: artifact.entryPath,
    entries: artifact.entries.map((entry) => ({
      entryType: entry.entryType,
      relativePath: entry.relativePath,
      immutableId: entry.immutableId,
      storageKey: entry.storageKey,
      size: entry.size?.toString() ?? null,
      mimeType: entry.mimeType,
      etag: entry.etag,
      sha256: entry.sha256,
    })),
  }
  return `snap_${createHash("sha256").update(JSON.stringify(descriptor), "utf8").digest("base64url")}`
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

function parseTarget(value: Prisma.JsonValue): DriveOpenApiDownloadTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw downloadUnavailable()
  const target = value as Record<string, Prisma.JsonValue>
  if (target.kind === "share" && typeof target.shareId === "string" && typeof target.itemId === "string") {
    return { kind: "share", shareId: target.shareId, itemId: target.itemId }
  }
  if (target.kind === "site" && typeof target.siteId === "string" && typeof target.deploymentId === "string") {
    return { kind: "site", siteId: target.siteId, deploymentId: target.deploymentId }
  }
  if (target.kind === "public_asset" && typeof target.assetId === "string" && typeof target.publicAssetId === "string") {
    return { kind: "public_asset", assetId: target.assetId, publicAssetId: target.publicAssetId }
  }
  throw downloadUnavailable()
}

function downloadUnavailable(): OpenApiHttpError {
  return new OpenApiHttpError(410, "DOWNLOAD_UNAVAILABLE", "临时下载地址已失效。")
}
