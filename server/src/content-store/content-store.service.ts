import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type {
  ContentStoreDetailDto,
  ContentStoreDraftDto,
  ContentStoreFileDto,
  ContentStoreInstallSessionDto,
  ContentStoreItemDto,
  ContentStoreModerationStatus,
  ContentStoreType,
  ContentStoreVersionDto,
  ContentStoreVisibility,
} from "@synapse/shared"
import { PrismaService } from "../prisma/prisma.service"
import { toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { CONTENT_STORE_STORAGE_PORT, contentStoreInstallSessionTtlSeconds } from "./content-store.constants"
import { normalizePromptBody, normalizeRuleBody, normalizeSkillFiles } from "./content-store-file-rules"
import { buildContentStorePackage } from "./content-store-package"
import type { ContentStoreStoragePort } from "./content-store-storage"
import type { ContentStoreFileInput, NormalizedContentStoreFile } from "./content-store.types"

const revisionMismatchMessage = "草稿已在其它页面更新，请刷新后继续。"
const listSortFields = ["createdAt", "updatedAt", "title"] as const

export type ContentStoreDraftFileInput = {
  readonly path: string
  readonly contentBase64: string
  readonly mimeType?: string | null
}

export type CreateContentStoreDraftInput = {
  readonly type: ContentStoreType
  readonly title: string
  readonly description?: string | null
  readonly body?: string | null
  readonly files?: readonly ContentStoreDraftFileInput[]
}

export type SaveContentStoreDraftInput = {
  readonly title: string
  readonly description?: string | null
  readonly body?: string | null
  readonly files?: readonly ContentStoreDraftFileInput[]
}

export type ListContentStoreOptions = Partial<PaginationQuery> & {
  readonly type?: ContentStoreType
  readonly query?: string
}

export type AdminListContentStoreOptions = ListContentStoreOptions & {
  readonly visibility?: ContentStoreVisibility
  readonly moderationStatus?: ContentStoreModerationStatus
}

export interface ResolvedContentStoreInstallSession {
  readonly id: string
  readonly contentId: string
  readonly versionId: string
  readonly type: Extract<ContentStoreType, "skill" | "rule">
  readonly title: string
  readonly packageKey: string
  readonly packageSha256: string
  readonly packageSize: string | null
  readonly expiresAt: string
}

type ContentStoreSearchScope = "public" | "mine" | "admin"

type ContentStoreDb = Pick<
  PrismaService,
  | "auditLog"
  | "contentStoreDraft"
  | "contentStoreFile"
  | "contentStoreInstallEvent"
  | "contentStoreInstallSession"
  | "contentStoreItem"
  | "contentStoreVersion"
>

interface OwnerRow {
  readonly id: string
  readonly displayName: string | null
}

interface ContentStoreItemRow {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly description: string | null
  readonly ownerUserId: string
  readonly owner?: OwnerRow | null
  readonly visibility: string
  readonly moderationStatus: string
  readonly featured: boolean
  readonly copiedFromContentId: string | null
  readonly copiedFromVersionId: string | null
  readonly latestVersionId: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

interface ContentStoreDraftRow {
  readonly id: string
  readonly itemId: string
  readonly ownerUserId: string
  readonly baseVersionId: string | null
  readonly revision: number
  readonly title: string
  readonly description: string | null
  readonly body: string | null
  readonly files?: readonly ContentStoreFileRow[]
  readonly item?: ContentStoreItemRow
  readonly updatedAt: Date
}

interface ContentStoreVersionRow {
  readonly id: string
  readonly itemId: string
  readonly versionNumber: number
  readonly title: string
  readonly description: string | null
  readonly body: string | null
  readonly packageKey: string | null
  readonly packageSha256: string | null
  readonly packageSize: bigint | number | string | null
  readonly files?: readonly ContentStoreFileRow[]
  readonly createdAt: Date
}

interface ContentStoreFileRow {
  readonly path: string
  readonly size: bigint | number
  readonly sha256: string
  readonly kind: string
  readonly mimeType: string | null
  readonly storageKey: string | null
  readonly text: string | null
}

interface ContentStoreInstallSessionRow {
  readonly id: string
  readonly userId: string
  readonly itemId: string
  readonly versionId: string
  readonly type: string
  readonly status: string
  readonly expiresAt: Date
  readonly item: ContentStoreItemRow
  readonly version: ContentStoreVersionRow
}

@Injectable()
export class ContentStoreService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONTENT_STORE_STORAGE_PORT) private readonly storage: ContentStoreStoragePort,
  ) {}

  async createDraft(userId: string, input: CreateContentStoreDraftInput): Promise<ContentStoreDraftDto> {
    this.assertTitle(input.title)
    const normalized = this.normalizeDraftPayload(input.type, input)
    const draftId = randomUUID()

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.contentStoreItem.create({
        data: {
          type: input.type,
          title: input.title.trim(),
          description: normalizeDescription(input.description),
          ownerUserId: userId,
          visibility: "private",
          moderationStatus: "normal",
        },
      }) as ContentStoreItemRow
      const draft = await tx.contentStoreDraft.create({
        data: {
          id: draftId,
          itemId: item.id,
          ownerUserId: userId,
          baseVersionId: null,
          revision: 1,
          title: item.title,
          description: item.description,
          body: normalized.body,
        },
      }) as ContentStoreDraftRow
      await this.replaceDraftFiles(tx, userId, draft.id, normalized.files)
      return this.getDraftDto(tx, userId, item.id)
    })
  }

  async saveDraft(userId: string, itemId: string, baseRevision: number, input: SaveContentStoreDraftInput): Promise<ContentStoreDraftDto> {
    this.assertTitle(input.title)
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.contentStoreDraft.findFirst({
        where: { itemId, ownerUserId: userId },
        include: { item: true, files: true },
      }) as ContentStoreDraftRow | null
      if (!draft?.item) throw new NotFoundException("草稿不存在。")
      if (draft.revision !== baseRevision) throw new BadRequestException(revisionMismatchMessage)

      const normalized = this.normalizeDraftPayload(toContentStoreType(draft.item.type), input)
      const updated = await tx.contentStoreDraft.updateMany({
        where: { itemId, ownerUserId: userId, revision: baseRevision },
        data: {
          title: input.title.trim(),
          description: normalizeDescription(input.description),
          body: normalized.body,
          revision: { increment: 1 },
        },
      })
      if (updated.count !== 1) throw new BadRequestException(revisionMismatchMessage)
      await this.replaceDraftFiles(tx, userId, draft.id, normalized.files)
      return this.getDraftDto(tx, userId, itemId)
    })
  }

  async publishDraft(userId: string, itemId: string, baseRevision: number): Promise<ContentStoreVersionDto> {
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.contentStoreDraft.findFirst({
        where: { itemId, ownerUserId: userId },
        include: { item: true, files: true },
      }) as ContentStoreDraftRow | null
      if (!draft?.item) throw new NotFoundException("草稿不存在。")
      if (draft.revision !== baseRevision) throw new BadRequestException(revisionMismatchMessage)

      const type = toContentStoreType(draft.item.type)
      const versionNumber = await tx.contentStoreVersion.count({ where: { itemId } }) + 1
      const version = await tx.contentStoreVersion.create({
        data: {
          itemId,
          versionNumber,
          title: draft.title,
          description: draft.description,
          body: type === "prompt" ? draft.body : null,
          packageKey: null,
          packageSha256: null,
          packageSize: null,
          searchText: buildSearchText(type, draft.title, draft.description, draft.body, draft.files ?? []),
        },
      }) as ContentStoreVersionRow

      if (type === "skill" || type === "rule") {
        const files = await this.filesWithBytes(draft.files ?? [])
        const packageResult = await buildContentStorePackage({ contentId: itemId, versionId: version.id, type, title: draft.title, files })
        const packageKey = `content-store/packages/${itemId}/${version.id}.zip`
        await this.storage.putObject({ key: packageKey, body: packageResult.bytes, contentType: "application/zip" })
        const packagedVersion = await tx.contentStoreVersion.update({
          where: { id: version.id },
          data: {
            packageKey,
            packageSha256: packageResult.sha256,
            packageSize: BigInt(packageResult.bytes.length),
          },
        }) as ContentStoreVersionRow
        await this.createVersionFiles(tx, version.id, draft.files ?? [])
        await tx.contentStoreItem.update({
          where: { id: itemId },
          data: {
            title: draft.title,
            description: draft.description,
            latestVersionId: version.id,
          },
        })
        await tx.contentStoreDraft.delete({ where: { itemId } })
        return versionDto(packagedVersion)
      }

      await tx.contentStoreItem.update({
        where: { id: itemId },
        data: {
          title: draft.title,
          description: draft.description,
          latestVersionId: version.id,
        },
      })
      await tx.contentStoreDraft.delete({ where: { itemId } })
      return versionDto(version)
    })
  }

  async listStore(_userId: string, options: ListContentStoreOptions): Promise<PaginatedResponse<ContentStoreItemDto>> {
    const pagination = normalizePagination(options)
    const where: Prisma.ContentStoreItemWhereInput = {
      visibility: "public",
      moderationStatus: "normal",
      ...(options.type ? { type: options.type } : {}),
      ...buildSearchWhere(options.query, "public"),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contentStoreItem.findMany({ where, include: { owner: { select: { id: true, displayName: true } } }, ...toPrismaArgs(pagination) }),
      this.prisma.contentStoreItem.count({ where }),
    ]) as [ContentStoreItemRow[], number]
    return this.paginatedItems(this.prisma, items, total, pagination)
  }

  async listMine(userId: string, options: ListContentStoreOptions): Promise<PaginatedResponse<ContentStoreItemDto>> {
    const pagination = normalizePagination(options)
    const where: Prisma.ContentStoreItemWhereInput = {
      ownerUserId: userId,
      ...(options.type ? { type: options.type } : {}),
      ...buildSearchWhere(options.query, "mine"),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contentStoreItem.findMany({ where, include: { owner: { select: { id: true, displayName: true } } }, ...toPrismaArgs(pagination) }),
      this.prisma.contentStoreItem.count({ where }),
    ]) as [ContentStoreItemRow[], number]
    return this.paginatedItems(this.prisma, items, total, pagination)
  }

  async getDetail(userId: string, itemId: string): Promise<ContentStoreDetailDto> {
    const item = await this.prisma.contentStoreItem.findFirst({
      where: {
        id: itemId,
        OR: [
          { ownerUserId: userId },
          { visibility: "public", moderationStatus: "normal" },
        ],
      },
      include: { owner: { select: { id: true, displayName: true } } },
    }) as ContentStoreItemRow | null
    if (!item) throw new NotFoundException("内容不存在。")
    return this.detailDto(this.prisma, item)
  }

  async copyToMine(userId: string, itemId: string): Promise<ContentStoreItemDto> {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.contentStoreItem.findFirst({
        where: {
          id: itemId,
          moderationStatus: "normal",
          OR: [
            { visibility: "public" },
            { ownerUserId: userId },
          ],
        },
        include: { owner: { select: { id: true, displayName: true } } },
      }) as ContentStoreItemRow | null
      if (!source?.latestVersionId) throw new NotFoundException("内容不存在。")
      const sourceVersion = await tx.contentStoreVersion.findFirst({
        where: { id: source.latestVersionId, itemId: source.id },
        include: { files: true },
      }) as ContentStoreVersionRow | null
      if (!sourceVersion) throw new NotFoundException("内容版本不存在。")

      const type = toContentStoreType(source.type)
      const newItem = await tx.contentStoreItem.create({
        data: {
          type: source.type,
          title: source.title,
          description: source.description,
          ownerUserId: userId,
          visibility: "private",
          moderationStatus: "normal",
          copiedFromContentId: source.id,
          copiedFromVersionId: sourceVersion.id,
        },
      }) as ContentStoreItemRow
      const newVersion = await tx.contentStoreVersion.create({
        data: {
          itemId: newItem.id,
          versionNumber: 1,
          title: sourceVersion.title,
          description: sourceVersion.description,
          body: sourceVersion.body,
          packageKey: null,
          packageSha256: null,
          packageSize: null,
          searchText: buildSearchText(type, sourceVersion.title, sourceVersion.description, sourceVersion.body, sourceVersion.files ?? []),
        },
      }) as ContentStoreVersionRow
      await this.createVersionFiles(tx, newVersion.id, sourceVersion.files ?? [])

      if (type === "skill" || type === "rule") {
        const packageFiles = await this.filesWithBytes(sourceVersion.files ?? [])
        const packageResult = await buildContentStorePackage({ contentId: newItem.id, versionId: newVersion.id, type, title: newVersion.title, files: packageFiles })
        const packageKey = `content-store/packages/${newItem.id}/${newVersion.id}.zip`
        await this.storage.putObject({ key: packageKey, body: packageResult.bytes, contentType: "application/zip" })
        await tx.contentStoreVersion.update({
          where: { id: newVersion.id },
          data: { packageKey, packageSha256: packageResult.sha256, packageSize: BigInt(packageResult.bytes.length) },
        })
      }

      const updated = await tx.contentStoreItem.update({
        where: { id: newItem.id },
        data: { latestVersionId: newVersion.id },
        include: { owner: { select: { id: true, displayName: true } } },
      }) as ContentStoreItemRow
      return this.itemDto(tx, updated)
    })
  }

  async setVisibility(userId: string, itemId: string, visibility: ContentStoreVisibility): Promise<ContentStoreItemDto> {
    const item = await this.prisma.contentStoreItem.findFirst({ where: { id: itemId, ownerUserId: userId } }) as ContentStoreItemRow | null
    if (!item) throw new NotFoundException("内容不存在。")
    if (visibility === "public" && !item.description?.trim()) {
      throw new BadRequestException("公开内容必须填写描述。")
    }
    const updated = await this.prisma.contentStoreItem.update({
      where: { id: itemId },
      data: { visibility },
      include: { owner: { select: { id: true, displayName: true } } },
    }) as ContentStoreItemRow
    return this.itemDto(this.prisma, updated)
  }

  async deletePrivateItem(userId: string, itemId: string): Promise<{ ok: true }> {
    const item = await this.prisma.contentStoreItem.findFirst({ where: { id: itemId, ownerUserId: userId } }) as ContentStoreItemRow | null
    if (!item) throw new NotFoundException("内容不存在。")
    if (item.visibility !== "private") throw new BadRequestException("公开内容不能直接删除。")
    await this.prisma.contentStoreItem.delete({ where: { id: itemId } })
    return { ok: true }
  }

  async createInstallSession(userId: string, itemId: string, deepLinkBase: string): Promise<ContentStoreInstallSessionDto> {
    const item = await this.prisma.contentStoreItem.findFirst({
      where: {
        id: itemId,
        moderationStatus: "normal",
        OR: [
          { visibility: "public" },
          { ownerUserId: userId },
        ],
      },
    }) as ContentStoreItemRow | null
    if (!item?.latestVersionId) throw new NotFoundException("内容不存在。")
    const type = toContentStoreType(item.type)
    if (type === "prompt") throw new BadRequestException("Prompt 不支持安装。")

    const version = await this.prisma.contentStoreVersion.findFirst({
      where: { id: item.latestVersionId, itemId: item.id },
    }) as ContentStoreVersionRow | null
    if (!version?.packageKey || !version.packageSha256) throw new BadRequestException("内容安装包不存在。")

    const expiresAt = new Date(Date.now() + contentStoreInstallSessionTtlSeconds * 1000)
    const session = await this.prisma.contentStoreInstallSession.create({
      data: {
        userId,
        itemId: item.id,
        versionId: version.id,
        type,
        status: "pending",
        expiresAt,
      },
    }) as { readonly id: string; readonly expiresAt: Date }

    return {
      id: session.id,
      contentId: item.id,
      versionId: version.id,
      type,
      title: version.title,
      packageSha256: version.packageSha256,
      expiresAt: session.expiresAt.toISOString(),
      deepLinkUrl: appendSessionToDeepLink(deepLinkBase, session.id),
    }
  }

  async resolveInstallSession(userId: string, sessionId: string): Promise<ResolvedContentStoreInstallSession> {
    const session = await this.prisma.contentStoreInstallSession.findFirst({
      where: { id: sessionId },
      include: { item: true, version: true },
    }) as ContentStoreInstallSessionRow | null
    if (!session) throw new NotFoundException("安装会话不存在。")
    if (session.userId !== userId) throw new ForbiddenException("安装会话不属于当前用户。")
    if (session.status !== "pending") throw new BadRequestException("安装会话已失效。")
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.contentStoreInstallSession.update({ where: { id: sessionId }, data: { status: "expired" } })
      throw new BadRequestException("安装会话已过期。")
    }
    const type = toInstallableType(session.type)
    if (!session.version.packageKey || !session.version.packageSha256) throw new BadRequestException("内容安装包不存在。")
    return {
      id: session.id,
      contentId: session.itemId,
      versionId: session.versionId,
      type,
      title: session.version.title,
      packageKey: session.version.packageKey,
      packageSha256: session.version.packageSha256,
      packageSize: formatOptionalBigInt(session.version.packageSize),
      expiresAt: session.expiresAt.toISOString(),
    }
  }

  async recordInstall(userId: string, sessionId: string, clientInstanceId: string): Promise<{ ok: true }> {
    const resolved = await this.resolveInstallSession(userId, sessionId)
    await this.prisma.contentStoreInstallEvent.upsert({
      where: {
        userId_itemId_versionId_clientInstanceId: {
          userId,
          itemId: resolved.contentId,
          versionId: resolved.versionId,
          clientInstanceId,
        },
      },
      update: {},
      create: {
        userId,
        itemId: resolved.contentId,
        versionId: resolved.versionId,
        clientInstanceId,
      },
    })
    await this.prisma.contentStoreInstallSession.update({
      where: { id: sessionId },
      data: { status: "consumed", consumedAt: new Date() },
    })
    return { ok: true }
  }

  async listAdmin(options: AdminListContentStoreOptions): Promise<PaginatedResponse<ContentStoreItemDto>> {
    const pagination = normalizePagination(options)
    const where: Prisma.ContentStoreItemWhereInput = {
      ...(options.type ? { type: options.type } : {}),
      ...(options.visibility ? { visibility: options.visibility } : {}),
      ...(options.moderationStatus ? { moderationStatus: options.moderationStatus } : {}),
      ...buildSearchWhere(options.query, "admin"),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contentStoreItem.findMany({ where, include: { owner: { select: { id: true, displayName: true } } }, ...toPrismaArgs(pagination) }),
      this.prisma.contentStoreItem.count({ where }),
    ]) as [ContentStoreItemRow[], number]
    return this.paginatedItems(this.prisma, items, total, pagination)
  }

  async getAdminDetail(itemId: string): Promise<ContentStoreDetailDto> {
    const item = await this.prisma.contentStoreItem.findFirst({
      where: { id: itemId },
      include: { owner: { select: { id: true, displayName: true } } },
    }) as ContentStoreItemRow | null
    if (!item) throw new NotFoundException("内容不存在。")
    return this.detailDto(this.prisma, item)
  }

  async setFeaturedAsAdmin(adminEmail: string, ipAddress: string, itemId: string, featured: boolean): Promise<ContentStoreItemDto> {
    return this.updateItemAsAdmin(adminEmail, ipAddress, itemId, featured ? "content_store.feature" : "content_store.unfeature", { featured })
  }

  async setRemovedAsAdmin(adminEmail: string, ipAddress: string, itemId: string, removed: boolean): Promise<ContentStoreItemDto> {
    return this.updateItemAsAdmin(adminEmail, ipAddress, itemId, removed ? "content_store.remove" : "content_store.restore", {
      moderationStatus: removed ? "removed" : "normal",
    })
  }

  private async updateItemAsAdmin(
    adminEmail: string,
    ipAddress: string,
    itemId: string,
    action: "content_store.feature" | "content_store.unfeature" | "content_store.remove" | "content_store.restore",
    data: { readonly featured?: boolean; readonly moderationStatus?: ContentStoreModerationStatus },
  ): Promise<ContentStoreItemDto> {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.contentStoreItem.update({
        where: { id: itemId },
        data,
        include: { owner: { select: { id: true, displayName: true } } },
      }) as ContentStoreItemRow
      await tx.auditLog.create({
        data: {
          adminEmail,
          action,
          targetType: "content_store_item",
          targetId: itemId,
          ipAddress,
          detail: data,
        },
      })
      return this.itemDto(tx, item)
    })
  }

  private normalizeDraftPayload(type: ContentStoreType, input: Pick<CreateContentStoreDraftInput, "body" | "files">): {
    readonly body: string | null
    readonly files: readonly NormalizedContentStoreFile[]
  } {
    if (type === "skill") return { body: null, files: normalizeSkillFiles(decodeFiles(input.files ?? [])) }
    if (type === "rule") {
      const body = input.body ?? ""
      return { body, files: [normalizeRuleBody(body)] }
    }
    return { body: normalizePromptBody(input.body ?? ""), files: [] }
  }

  private async replaceDraftFiles(
    tx: ContentStoreDb,
    userId: string,
    draftId: string,
    files: readonly NormalizedContentStoreFile[],
  ): Promise<void> {
    await tx.contentStoreFile.deleteMany({ where: { draftId } })
    const rows = []
    for (const file of files) {
      const key = `content-store/drafts/${userId}/${draftId}/${file.sha256}`
      await this.storage.putObject({ key, body: file.bytes, contentType: file.mimeType })
      rows.push({
        draftId,
        path: file.path,
        size: BigInt(file.size),
        sha256: file.sha256,
        kind: file.kind,
        mimeType: file.mimeType,
        storageKey: key,
        text: file.text,
      })
    }
    if (rows.length > 0) await tx.contentStoreFile.createMany({ data: rows })
  }

  private async createVersionFiles(tx: ContentStoreDb, versionId: string, files: readonly ContentStoreFileRow[]): Promise<void> {
    if (files.length === 0) return
    await tx.contentStoreFile.createMany({
      data: files.map((file) => ({
        versionId,
        path: file.path,
        size: BigInt(file.size),
        sha256: file.sha256,
        kind: file.kind,
        mimeType: file.mimeType,
        storageKey: file.storageKey,
        text: file.text,
      })),
    })
  }

  private async filesWithBytes(files: readonly ContentStoreFileRow[]): Promise<NormalizedContentStoreFile[]> {
    const result: NormalizedContentStoreFile[] = []
    for (const file of files) {
      const bytes = file.storageKey
        ? await streamToBuffer((await this.storage.getObjectStream({ key: file.storageKey })).stream)
        : Buffer.from(file.text ?? "", "utf8")
      result.push({
        path: file.path,
        size: numberFromSize(file.size),
        sha256: file.sha256,
        kind: toFileKind(file.kind),
        mimeType: file.mimeType,
        text: file.text,
        bytes,
      })
    }
    return result
  }

  private async getDraftDto(tx: ContentStoreDb, userId: string, itemId: string): Promise<ContentStoreDraftDto> {
    const draft = await tx.contentStoreDraft.findFirst({
      where: { itemId, ownerUserId: userId },
      include: { files: { orderBy: { path: "asc" } } },
    }) as ContentStoreDraftRow | null
    if (!draft) throw new NotFoundException("草稿不存在。")
    return draftDto(draft)
  }

  private async paginatedItems(
    db: ContentStoreDb,
    items: readonly ContentStoreItemRow[],
    total: number,
    pagination: PaginationQuery,
  ): Promise<PaginatedResponse<ContentStoreItemDto>> {
    return {
      data: await Promise.all(items.map((item) => this.itemDto(db, item))),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
  }

  private async itemDto(db: ContentStoreDb, item: ContentStoreItemRow): Promise<ContentStoreItemDto> {
    const installCount = await db.contentStoreInstallEvent.count({ where: { itemId: item.id } })
    const latestVersion = item.latestVersionId
      ? await db.contentStoreVersion.findFirst({
        where: { id: item.latestVersionId, itemId: item.id },
        select: { versionNumber: true },
      }) as { readonly versionNumber: number } | null
      : null
    return itemDto(item, installCount, latestVersion?.versionNumber ?? null)
  }

  private async detailDto(db: ContentStoreDb, item: ContentStoreItemRow): Promise<ContentStoreDetailDto> {
    const latestVersion = item.latestVersionId
      ? await db.contentStoreVersion.findFirst({
        where: { id: item.latestVersionId, itemId: item.id },
        include: { files: { orderBy: { path: "asc" } } },
      }) as ContentStoreVersionRow | null
      : null
    return {
      ...await this.itemDto(db, item),
      latestVersion: latestVersion ? versionDto(latestVersion) : null,
      body: latestVersion?.body ?? null,
      files: (latestVersion?.files ?? []).map(fileDto),
    }
  }

  private assertTitle(title: string): void {
    if (!title.trim()) throw new BadRequestException("标题不能为空。")
  }
}

function decodeFiles(files: readonly ContentStoreDraftFileInput[]): ContentStoreFileInput[] {
  return files.map((file) => ({
    path: file.path,
    bytes: Buffer.from(file.contentBase64, "base64"),
    mimeType: file.mimeType ?? null,
  }))
}

function normalizeDescription(description: string | null | undefined): string | null {
  const trimmed = description?.trim()
  return trimmed ? trimmed : null
}

function normalizePagination(options: ListContentStoreOptions): PaginationQuery {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 20
  const sortBy = options.sortBy ?? "updatedAt"
  const sortOrder = options.sortOrder ?? "desc"
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new BadRequestException("分页参数无效。")
  }
  if (!listSortFields.includes(sortBy as (typeof listSortFields)[number])) throw new BadRequestException("排序字段无效。")
  return { page, pageSize, sortBy, sortOrder }
}

function itemDto(item: ContentStoreItemRow, installCount: number, latestVersionNumber: number | null): ContentStoreItemDto {
  return {
    id: item.id,
    type: toContentStoreType(item.type),
    title: item.title,
    description: item.description,
    visibility: toVisibility(item.visibility),
    moderationStatus: toModerationStatus(item.moderationStatus),
    featured: item.featured,
    owner: {
      id: item.owner?.id ?? item.ownerUserId,
      displayName: item.owner?.displayName ?? null,
    },
    latestVersionId: item.latestVersionId,
    latestVersionNumber,
    installCount,
    copiedFromContentId: item.copiedFromContentId,
    copiedFromVersionId: item.copiedFromVersionId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

function versionDto(version: ContentStoreVersionRow): ContentStoreVersionDto {
  return {
    id: version.id,
    itemId: version.itemId,
    versionNumber: version.versionNumber,
    packageKey: version.packageKey,
    packageSha256: version.packageSha256,
    packageSize: formatOptionalBigInt(version.packageSize),
    createdAt: version.createdAt.toISOString(),
  }
}

function draftDto(draft: ContentStoreDraftRow): ContentStoreDraftDto {
  return {
    id: draft.id,
    itemId: draft.itemId,
    baseVersionId: draft.baseVersionId,
    revision: draft.revision,
    title: draft.title,
    description: draft.description,
    body: draft.body,
    files: (draft.files ?? []).map(fileDto),
    updatedAt: draft.updatedAt.toISOString(),
  }
}

function fileDto(file: ContentStoreFileRow): ContentStoreFileDto {
  return {
    path: file.path,
    size: numberFromSize(file.size),
    sha256: file.sha256,
    kind: toFileKind(file.kind),
    mimeType: file.mimeType,
    ...(file.text !== null ? { text: file.text } : {}),
  }
}

function buildSearchWhere(query: string | undefined, scope: ContentStoreSearchScope): Prisma.ContentStoreItemWhereInput {
  const normalizedQuery = query?.trim()
  if (!normalizedQuery) return {}
  const searchVersionWhere = scope === "mine"
    ? { searchText: { contains: normalizedQuery, mode: "insensitive" as const } }
    : {
      searchText: { contains: normalizedQuery, mode: "insensitive" as const },
      item: scope === "public" ? { visibility: "public", moderationStatus: "normal" } : undefined,
    }
  return {
    OR: [
      { title: { contains: normalizedQuery, mode: "insensitive" } },
      { description: { contains: normalizedQuery, mode: "insensitive" } },
      { owner: { displayName: { contains: normalizedQuery, mode: "insensitive" } } },
      { versions: { some: searchVersionWhere } },
    ],
  }
}

function buildSearchText(
  type: ContentStoreType,
  title: string,
  description: string | null,
  body: string | null,
  files: readonly ContentStoreFileRow[],
): string {
  const bodyText = type === "prompt"
    ? body
    : files.find((file) => file.path === (type === "skill" ? "SKILL.md" : "RULE.md"))?.text
  return [title, description, bodyText].filter((value): value is string => Boolean(value)).join("\n")
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of Readable.from(stream)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function appendSessionToDeepLink(base: string, sessionId: string): string {
  const separator = base.includes("?") ? "&" : "?"
  return `${base}${separator}session=${encodeURIComponent(sessionId)}`
}

function formatOptionalBigInt(value: bigint | number | string | null): string | null {
  if (value === null) return null
  return String(value)
}

function numberFromSize(size: bigint | number): number {
  return typeof size === "bigint" ? Number(size) : size
}

function toContentStoreType(value: string): ContentStoreType {
  if (value === "skill" || value === "rule" || value === "prompt") return value
  throw new BadRequestException("内容类型无效。")
}

function toInstallableType(value: string): Extract<ContentStoreType, "skill" | "rule"> {
  if (value === "skill" || value === "rule") return value
  throw new BadRequestException("内容不支持安装。")
}

function toVisibility(value: string): ContentStoreVisibility {
  if (value === "private" || value === "public") return value
  throw new BadRequestException("可见性无效。")
}

function toModerationStatus(value: string): ContentStoreModerationStatus {
  if (value === "normal" || value === "removed") return value
  throw new BadRequestException("审核状态无效。")
}

function toFileKind(value: string): "text" | "binary" {
  if (value === "text" || value === "binary") return value
  throw new BadRequestException("文件类型无效。")
}
