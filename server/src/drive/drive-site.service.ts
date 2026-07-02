import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import bcrypt from "bcryptjs"
import {
  DRIVE_SITE_DEFAULT_PAGE_SIZE,
  DRIVE_SITE_MAX_FILES,
  DRIVE_SITE_MAX_PAGE_SIZE,
  DRIVE_SITE_MAX_TOTAL_BYTES,
  type DriveAccessExpiresIn,
  type DriveSiteAccessMode,
  type DriveSiteAccessUpdateInput,
  type DriveSiteCreateInput,
  type DriveSiteDto,
  type DriveSiteListInput,
  type DriveSiteListPageDto,
  type DriveSitePreflightDto,
} from "@synapse/shared"
import { PrismaService } from "../prisma/prisma.service"
import {
  DRIVE_ITEM_LIFECYCLE_STATUS,
  DRIVE_ITEM_TYPE,
  DRIVE_SITE_ACCESS_MODE,
  DRIVE_SITE_DEPLOYMENT_STATUS,
  DRIVE_SITE_STATUS,
  DRIVE_STORAGE_STATUS,
  DRIVE_UPLOAD_STATUS,
} from "./drive.constants"
import {
  buildDriveAccessCookie,
  createDrivePasswordMaterial,
  decryptDrivePassword,
  encryptDrivePassword,
  verifyDriveAccessCookie,
  verifyDrivePasswordInput,
} from "./drive-access-protection"
import { normalizeDriveSiteRelativePath, resolveDriveSiteRequestPath } from "./drive-site-path"
import type { DriveStoragePort } from "./drive-storage"
import { createDriveSiteId } from "./drive-token"
import { toDriveSiteDto } from "./drive.types"

type DrivePrismaClient = PrismaService | Prisma.TransactionClient

type DriveSiteSourceItem = {
  readonly id: string
  readonly parentId: string | null
  readonly type: string
  readonly name: string
  readonly size: bigint
  readonly mimeType: string | null
  readonly storageKey: string | null
  readonly storageStatus: string
  readonly uploadStatus: string
  readonly lifecycleStatus: string
  readonly deletedAt: Date | null
}

type DriveSiteSnapshotFile = {
  readonly sourceItemId: string
  readonly relativePath: string
  readonly storageKey: string
  readonly contentType: string | null
  readonly size: bigint
}

type DriveSiteSnapshot = {
  readonly sourceFolderItemId: string
  readonly sourceFolderName: string
  readonly files: readonly DriveSiteSnapshotFile[]
  readonly htmlFiles: readonly string[]
  readonly defaultEntryPath: string | null
  readonly totalBytes: bigint
  readonly includesJavaScript: boolean
}

type DriveSiteRecord = {
  readonly id: string
  readonly siteId: string
  readonly userId: string
  readonly name: string
  readonly status: string
  readonly accessMode: string
  readonly passwordHash: string | null
  readonly passwordEncrypted: string | null
  readonly expiresIn: string
  readonly expiresAt: Date | null
  readonly currentDeploymentId: string | null
  readonly sourceFolderItemId: string | null
  readonly sourceFolderName: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

type DriveSiteDeploymentRecord = {
  readonly id: string
  readonly driveSiteId: string
  readonly status: string
  readonly entryPath: string
  readonly fileCount: number
  readonly totalBytes: bigint
  readonly activatedAt: Date | null
}

type DriveSiteAssetRecord = {
  readonly storageKey: string
  readonly relativePath: string
  readonly contentType: string | null
  readonly size: bigint
}

export type DriveResolvedSiteAccess =
  | { readonly status: "not_found" }
  | { readonly status: "disabled" }
  | { readonly status: "expired" }
  | { readonly status: "password_required" }
  | {
    readonly status: "ok"
    readonly site: DriveSiteRecord
    readonly deployment: DriveSiteDeploymentRecord
    readonly asset: DriveSiteAssetRecord
  }

export type DrivePublicSiteAssetListResult =
  | { readonly status: "not_found" | "disabled" | "expired" | "password_required" }
  | {
    readonly status: "ok"
    readonly assets: readonly DriveSiteAssetRecord[]
    readonly page: { readonly hasMore: boolean; readonly nextOffset: number | null }
  }

@Injectable()
export class DriveSiteService {
  private readonly accessSecret = readUserAccessJwtSecret(process.env)

  constructor(
    private readonly prisma: PrismaService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
  ) {}

  async preflightSite(userId: string, sourceFolderItemId: string): Promise<DriveSitePreflightDto> {
    const snapshot = await this.buildSnapshot(this.prisma, userId, sourceFolderItemId)
    return {
      sourceFolderItemId: snapshot.sourceFolderItemId,
      sourceFolderName: snapshot.sourceFolderName,
      htmlFiles: snapshot.htmlFiles,
      defaultEntryPath: snapshot.defaultEntryPath,
      fileCount: snapshot.files.length,
      totalBytes: snapshot.totalBytes.toString(),
      includesJavaScript: snapshot.includesJavaScript,
    }
  }

  async createSite(userId: string, publicAppUrl: string, input: DriveSiteCreateInput): Promise<DriveSiteDto> {
    const snapshot = await this.buildSnapshot(this.prisma, userId, input.sourceFolderItemId)
    const entryPath = this.resolveEntryPath(snapshot, input.entryPath ?? null)
    const passwordMaterial = await this.resolvePasswordMaterial(input.accessMode, input.password ?? null, input.expiresIn)
    const site = await this.prisma.driveSite.create({
      data: {
        siteId: createDriveSiteId(),
        userId,
        name: input.name.trim(),
        status: DRIVE_SITE_STATUS.failed,
        accessMode: input.accessMode,
        passwordHash: passwordMaterial.passwordHash,
        passwordEncrypted: passwordMaterial.passwordEncrypted,
        expiresIn: input.expiresIn,
        expiresAt: expiresAtFromInput(input.expiresIn),
        sourceFolderItemId: snapshot.sourceFolderItemId,
        sourceFolderName: snapshot.sourceFolderName,
      },
    })
    await this.publishDeployment(site, snapshot, entryPath)
    return this.getSiteDto(userId, site.siteId, publicAppUrl, passwordMaterial.password)
  }

  async listSites(userId: string, publicAppUrl: string, input: DriveSiteListInput = {}): Promise<DriveSiteListPageDto> {
    const page = normalizeSiteListPage(input)
    const statusWhere = siteListStatusWhere(input.status, new Date())
    const search = input.search?.trim()
    const matchingDeploymentIds = search ? await this.currentDeploymentIdsMatchingEntryPath(userId, search) : []
    const where: Prisma.DriveSiteWhereInput = {
      userId,
      deletedAt: null,
      ...(statusWhere ? { AND: [statusWhere] } : {}),
      ...(search
        ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { siteId: { contains: search, mode: "insensitive" } },
            { sourceFolderName: { contains: search, mode: "insensitive" } },
            ...(matchingDeploymentIds.length > 0 ? [{ currentDeploymentId: { in: matchingDeploymentIds } }] : []),
          ],
        }
        : {}),
    }
    const [sites, total] = await this.prisma.$transaction([
      this.prisma.driveSite.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit + 1,
      }),
      this.prisma.driveSite.count({ where }),
    ])
    const deployments = await this.currentDeploymentsForSites(sites)
    const items = sites.slice(0, page.limit)
      .map((site) => this.toDto(site, publicAppUrl, deployments.get(site.currentDeploymentId ?? "")))
    return {
      items,
      total,
      page: {
        offset: page.offset,
        limit: page.limit,
        hasMore: sites.length > page.limit,
        nextOffset: sites.length > page.limit ? page.offset + page.limit : null,
      },
    }
  }

  private async currentDeploymentIdsMatchingEntryPath(userId: string, search: string): Promise<string[]> {
    const deployments = await this.prisma.driveSiteDeployment.findMany({
      where: {
        entryPath: { contains: search, mode: "insensitive" },
        driveSite: { userId, deletedAt: null },
      },
      select: { id: true },
    })
    return deployments.map((deployment) => deployment.id)
  }

  async updateSiteAccess(userId: string, siteId: string, publicAppUrl: string, input: DriveSiteAccessUpdateInput): Promise<DriveSiteDto> {
    await this.requireOwnedSite(userId, siteId)
    const passwordMaterial = await this.resolvePasswordMaterial(input.accessMode, input.password ?? null, input.expiresIn)
    await this.prisma.driveSite.update({
      where: { siteId },
      data: {
        accessMode: input.accessMode,
        passwordHash: passwordMaterial.passwordHash,
        passwordEncrypted: passwordMaterial.passwordEncrypted,
        expiresIn: input.expiresIn,
        expiresAt: expiresAtFromInput(input.expiresIn),
      },
    })
    return this.getSiteDto(userId, siteId, publicAppUrl, passwordMaterial.password)
  }

  async disableSite(userId: string, siteId: string, publicAppUrl: string): Promise<DriveSiteDto> {
    await this.requireOwnedSite(userId, siteId)
    await this.prisma.driveSite.update({
      where: { siteId },
      data: { status: DRIVE_SITE_STATUS.disabled, disabledAt: new Date() },
    })
    return this.getSiteDto(userId, siteId, publicAppUrl)
  }

  async enableSite(userId: string, siteId: string, publicAppUrl: string): Promise<DriveSiteDto> {
    const site = await this.requireOwnedSite(userId, siteId)
    await this.prisma.driveSite.update({
      where: { siteId },
      data: {
        status: DRIVE_SITE_STATUS.active,
        disabledAt: null,
        expiresAt: expiresAtFromInput(site.expiresIn as DriveAccessExpiresIn),
      },
    })
    return this.getSiteDto(userId, siteId, publicAppUrl)
  }

  async deleteSite(userId: string, siteId: string): Promise<{ ok: true }> {
    await this.requireOwnedSite(userId, siteId)
    await this.prisma.driveSite.update({
      where: { siteId },
      data: { status: DRIVE_SITE_STATUS.deleted, deletedAt: new Date() },
    })
    return { ok: true }
  }

  async republishSite(userId: string, siteId: string, publicAppUrl: string, input: { readonly entryPath?: string | null }): Promise<DriveSiteDto> {
    const site = await this.requireOwnedSite(userId, siteId)
    if (!site.sourceFolderItemId) throw new BadRequestException("来源文件夹不可用。")
    const snapshot = await this.buildSnapshot(this.prisma, userId, site.sourceFolderItemId)
    const currentDeployment = site.currentDeploymentId
      ? await this.prisma.driveSiteDeployment.findUnique({ where: { id: site.currentDeploymentId } })
      : null
    const entryPath = this.resolveEntryPath(snapshot, input.entryPath ?? currentDeployment?.entryPath ?? null)
    await this.publishDeployment(site, snapshot, entryPath)
    return this.getSiteDto(userId, siteId, publicAppUrl)
  }

  async resolvePublicSite(siteId: string, input: { readonly cookie: string | null; readonly password?: string; readonly relativePath?: string }): Promise<DriveResolvedSiteAccess> {
    const context = await this.resolvePublicDeployment(siteId, input)
    if (context.status !== "ok") return context
    const { deployment, site } = context
    const requestPath = resolveDriveSiteRequestPath(input.relativePath ?? "")
    const relativePath = requestPath.kind === "entry" ? deployment.entryPath : requestPath.relativePath
    const asset = await this.prisma.driveSiteAsset.findUnique({
      where: { deploymentId_relativePath: { deploymentId: deployment.id, relativePath } },
    })
    if (!asset) return { status: "not_found" }
    return { status: "ok", site, deployment, asset }
  }

  async listPublicSiteAssets(siteId: string, input: {
    readonly cookie: string | null
    readonly password?: string
    readonly path?: string
    readonly offset?: number
    readonly limit?: number
  }): Promise<DrivePublicSiteAssetListResult> {
    const context = await this.resolvePublicDeployment(siteId, input)
    if (context.status !== "ok") return context
    const page = normalizeSiteListPage(input)
    const prefix = input.path ? normalizeDriveSiteRelativePath(input.path) : ""
    const pathFilter = prefix ? `${prefix.replace(/\/$/u, "")}/` : ""
    const assets = await this.prisma.driveSiteAsset.findMany({
      where: {
        deploymentId: context.deployment.id,
        ...(pathFilter
          ? { OR: [{ relativePath: prefix }, { relativePath: { startsWith: pathFilter } }] }
          : {}),
      },
      orderBy: [{ relativePath: "asc" }, { id: "asc" }],
      skip: page.offset,
      take: page.limit + 1,
    })
    return {
      status: "ok",
      assets: assets.slice(0, page.limit),
      page: {
        hasMore: assets.length > page.limit,
        nextOffset: assets.length > page.limit ? page.offset + page.limit : null,
      },
    }
  }

  private async resolvePublicDeployment(siteId: string, input: { readonly cookie: string | null; readonly password?: string }): Promise<
    | { readonly status: "not_found" | "disabled" | "expired" | "password_required" }
    | { readonly status: "ok"; readonly site: DriveSiteRecord; readonly deployment: DriveSiteDeploymentRecord }
  > {
    const site = await this.prisma.driveSite.findUnique({ where: { siteId } })
    if (!site || site.deletedAt) return { status: "not_found" }
    if (site.status !== DRIVE_SITE_STATUS.active) return { status: "disabled" }
    if (site.expiresAt && site.expiresAt.getTime() <= Date.now()) return { status: "expired" }
    const cookieAccepted = site.accessMode === DRIVE_SITE_ACCESS_MODE.password
      && verifyDriveAccessCookie(input.cookie, {
        kind: "site",
        publicId: site.siteId,
        now: new Date(),
        passwordHash: site.passwordHash,
        resourceExpiresAt: site.expiresAt,
        secret: this.accessSecret,
      })
    const passwordAccepted = site.accessMode === DRIVE_SITE_ACCESS_MODE.password
      && await verifyDrivePasswordInput(input.password, site.passwordHash)
    if (site.accessMode === DRIVE_SITE_ACCESS_MODE.password && !cookieAccepted && !passwordAccepted) {
      return { status: "password_required" }
    }
    if (!site.currentDeploymentId) return { status: "not_found" }
    const deployment = await this.prisma.driveSiteDeployment.findUnique({ where: { id: site.currentDeploymentId } })
    if (!deployment || deployment.status !== DRIVE_SITE_DEPLOYMENT_STATUS.active) return { status: "not_found" }
    return { status: "ok", site, deployment }
  }

  async verifySitePassword(siteId: string, password: string): Promise<boolean> {
    const site = await this.prisma.driveSite.findUnique({ where: { siteId } })
    if (!site || !site.passwordHash || site.deletedAt || site.status !== DRIVE_SITE_STATUS.active) return false
    if (site.expiresAt && site.expiresAt.getTime() <= Date.now()) return false
    return bcrypt.compare(password, site.passwordHash)
  }

  async createSiteAccessCookie(siteId: string, password: string): Promise<string | null> {
    const site = await this.prisma.driveSite.findUnique({ where: { siteId } })
    if (!site || !site.passwordHash || site.deletedAt || site.status !== DRIVE_SITE_STATUS.active) return null
    if (site.accessMode !== DRIVE_SITE_ACCESS_MODE.password) return null
    if (site.expiresAt && site.expiresAt.getTime() <= Date.now()) return null
    if (!await verifyDrivePasswordInput(password, site.passwordHash)) return null
    return buildDriveAccessCookie({
      kind: "site",
      publicId: site.siteId,
      expiresAt: site.expiresAt,
      passwordHash: site.passwordHash,
      secret: this.accessSecret,
    })
  }

  private async getSiteDto(userId: string, siteId: string, publicAppUrl: string, passwordOverride?: string | null): Promise<DriveSiteDto> {
    const site = await this.requireOwnedSite(userId, siteId)
    const deployment = site.currentDeploymentId
      ? await this.prisma.driveSiteDeployment.findUnique({ where: { id: site.currentDeploymentId } })
      : null
    return this.toDto(site, publicAppUrl, deployment, passwordOverride)
  }

  private async requireOwnedSite(userId: string, siteId: string): Promise<DriveSiteRecord> {
    const site = await this.prisma.driveSite.findFirst({ where: { userId, siteId, deletedAt: null } })
    if (!site) throw new NotFoundException("站点不存在。")
    return site
  }

  private async currentDeploymentsForSites(sites: readonly DriveSiteRecord[]): Promise<Map<string, DriveSiteDeploymentRecord>> {
    const ids = sites.map((site) => site.currentDeploymentId).filter((id): id is string => Boolean(id))
    if (ids.length === 0) return new Map()
    const deployments = await this.prisma.driveSiteDeployment.findMany({ where: { id: { in: ids } } })
    return new Map(deployments.map((deployment) => [deployment.id, deployment]))
  }

  private toDto(
    site: DriveSiteRecord,
    publicAppUrl: string,
    currentDeployment?: DriveSiteDeploymentRecord | null,
    passwordOverride?: string | null,
  ): DriveSiteDto {
    const password = passwordOverride ?? (site.accessMode === DRIVE_SITE_ACCESS_MODE.password
      ? this.decryptStoredPassword(site.passwordEncrypted)
      : null)
    return toDriveSiteDto({ ...site, currentDeployment: currentDeployment ?? null, password }, publicAppUrl)
  }

  private async publishDeployment(site: DriveSiteRecord, snapshot: DriveSiteSnapshot, entryPath: string): Promise<void> {
    const deployment = await this.prisma.driveSiteDeployment.create({
      data: {
        driveSiteId: site.id,
        status: DRIVE_SITE_DEPLOYMENT_STATUS.pending,
        entryPath,
        fileCount: snapshot.files.length,
        totalBytes: snapshot.totalBytes,
      },
    })
    try {
      for (const file of snapshot.files) {
        await this.storage.copyObject({
          fromKey: file.storageKey,
          toKey: driveSiteStorageKey(site.siteId, deployment.id, file.relativePath),
          contentType: file.contentType,
        })
      }
      await this.prisma.driveSiteAsset.createMany({
        data: snapshot.files.map((file) => ({
          driveSiteId: site.id,
          deploymentId: deployment.id,
          sourceItemId: file.sourceItemId,
          relativePath: file.relativePath,
          storageKey: driveSiteStorageKey(site.siteId, deployment.id, file.relativePath),
          contentType: file.contentType,
          size: file.size,
        })),
      })
      const activatedAt = new Date()
      await this.prisma.driveSiteDeployment.update({
        where: { id: deployment.id },
        data: { status: DRIVE_SITE_DEPLOYMENT_STATUS.active, activatedAt },
      })
      await this.prisma.driveSite.update({
        where: { id: site.id },
        data: { status: DRIVE_SITE_STATUS.active, currentDeploymentId: deployment.id },
      })
    } catch (error) {
      await this.prisma.driveSiteDeployment.update({
        where: { id: deployment.id },
        data: { status: DRIVE_SITE_DEPLOYMENT_STATUS.failed, error: error instanceof Error ? error.message : String(error) },
      })
      throw error
    }
  }

  private async buildSnapshot(db: DrivePrismaClient, userId: string, sourceFolderItemId: string): Promise<DriveSiteSnapshot> {
    const root = await db.driveItem.findFirst({
      where: {
        id: sourceFolderItemId,
        userId,
        type: DRIVE_ITEM_TYPE.folder,
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
        deletedAt: null,
      },
    })
    if (!root) throw new NotFoundException("来源文件夹不存在。")
    const files: DriveSiteSnapshotFile[] = []
    const htmlFiles: string[] = []
    const seen = new Set<string>()
    const queue: Array<{ readonly parentId: string; readonly prefix: string }> = [{ parentId: root.id, prefix: "" }]
    let totalBytes = 0n
    let includesJavaScript = false
    while (queue.length > 0) {
      const current = queue.shift()!
      const children = await db.driveItem.findMany({
        where: {
          userId,
          parentId: current.parentId,
          lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
          deletedAt: null,
        },
        orderBy: [{ type: "desc" }, { name: "asc" }, { id: "asc" }],
      }) as DriveSiteSourceItem[]
      for (const child of children) {
        const relativePath = normalizeDriveSiteRelativePath(`${current.prefix}${child.name}`)
        if (child.type === DRIVE_ITEM_TYPE.folder) {
          queue.push({ parentId: child.id, prefix: `${relativePath}/` })
          continue
        }
        if (child.type !== DRIVE_ITEM_TYPE.file) continue
        if (!child.storageKey || child.storageStatus !== DRIVE_STORAGE_STATUS.active || child.uploadStatus !== DRIVE_UPLOAD_STATUS.completed) {
          throw new BadRequestException(`文件不可发布：${relativePath}`)
        }
        if (seen.has(relativePath)) throw new BadRequestException(`站点路径重复：${relativePath}`)
        seen.add(relativePath)
        totalBytes += child.size
        if (files.length + 1 > DRIVE_SITE_MAX_FILES) throw new BadRequestException("站点文件数量超出限制。")
        if (totalBytes > BigInt(DRIVE_SITE_MAX_TOTAL_BYTES)) throw new BadRequestException("站点文件总大小超出限制。")
        if (/\.html?$/iu.test(relativePath)) htmlFiles.push(relativePath)
        if (/\.(?:mjs|cjs|js)$/iu.test(relativePath)) includesJavaScript = true
        files.push({
          sourceItemId: child.id,
          relativePath,
          storageKey: child.storageKey,
          contentType: child.mimeType,
          size: child.size,
        })
      }
    }
    const defaultEntryPath = htmlFiles.find((path) => path.toLowerCase() === "index.html") ?? null
    if (htmlFiles.length === 0) throw new BadRequestException("未找到 HTML 文件。")
    return {
      sourceFolderItemId: root.id,
      sourceFolderName: root.name,
      files,
      htmlFiles,
      defaultEntryPath,
      totalBytes,
      includesJavaScript,
    }
  }

  private resolveEntryPath(snapshot: DriveSiteSnapshot, requested: string | null): string {
    const normalized = requested ? normalizeDriveSiteRelativePath(requested) : snapshot.defaultEntryPath
    if (!normalized) throw new BadRequestException("请选择入口页。")
    if (!snapshot.htmlFiles.includes(normalized)) throw new BadRequestException("入口页不在站点文件中。")
    return normalized
  }

  private async resolvePasswordMaterial(
    accessMode: DriveSiteAccessMode,
    password: string | null,
    expiresIn: DriveAccessExpiresIn,
  ): Promise<{ readonly password: string | null; readonly passwordHash: string | null; readonly passwordEncrypted: string | null }> {
    if (accessMode === DRIVE_SITE_ACCESS_MODE.public) {
      return { password: null, passwordHash: null, passwordEncrypted: null }
    }
    if (password) {
      return {
        password,
        passwordHash: await bcrypt.hash(password, 12),
        passwordEncrypted: encryptDrivePassword(password, this.accessSecret),
      }
    }
    const material = await createDrivePasswordMaterial({ passwordEnabled: true, expiresIn }, this.accessSecret)
    return {
      password: material.password,
      passwordHash: material.passwordHash,
      passwordEncrypted: material.passwordEncrypted,
    }
  }

  private decryptStoredPassword(value: string | null | undefined): string | null {
    if (!value) return null
    return decryptDrivePassword(value, this.accessSecret)
  }
}

export function driveSiteStorageKey(siteId: string, deploymentId: string, relativePath: string): string {
  return `drive-sites/${siteId}/${deploymentId}/${relativePath}`
}

function normalizeSiteListPage(input: DriveSiteListInput): { readonly offset: number; readonly limit: number } {
  const offset = Number.isInteger(input.offset) && input.offset! >= 0 ? input.offset! : 0
  const requestedLimit = Number.isInteger(input.limit) && input.limit! > 0 ? input.limit! : DRIVE_SITE_DEFAULT_PAGE_SIZE
  return { offset, limit: Math.min(requestedLimit, DRIVE_SITE_MAX_PAGE_SIZE) }
}

function siteListStatusWhere(
  status: DriveSiteListInput["status"] | undefined,
  now: Date,
): Prisma.DriveSiteWhereInput | null {
  if (!status || status === "all") return null
  if (status === "expired") {
    return { status: DRIVE_SITE_STATUS.active, expiresAt: { lte: now } }
  }
  if (status === "active") {
    return {
      status: DRIVE_SITE_STATUS.active,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    }
  }
  return { status }
}

function expiresAtFromInput(expiresIn: DriveAccessExpiresIn): Date | null {
  if (expiresIn === "forever") return null
  const days = expiresIn === "3d" ? 3 : expiresIn === "7d" ? 7 : expiresIn === "30d" ? 30 : 365
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function readUserAccessJwtSecret(source: NodeJS.ProcessEnv): string {
  const secret = source.USER_ACCESS_JWT_SECRET
  if (!secret || secret.length < 32) throw new Error("服务端环境变量无效：USER_ACCESS_JWT_SECRET")
  return secret
}
