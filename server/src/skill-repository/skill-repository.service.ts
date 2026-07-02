import { randomUUID } from "node:crypto"
import { buffer as readStreamBuffer } from "node:stream/consumers"
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma } from "@prisma/client"
import {
  appendSkillRepositoryInstallSessionToDeepLink,
  buildSkillRepositoryManagementUrl,
  buildSkillRepositoryPublicUrl,
  defaultSkillRepositoryInstallDeepLinkBase,
  normalizeSkillRepositoryName,
  normalizeUserHandle,
  skillRepositoryTextPreviewMaxBytes,
  type SkillRepositoryDeleteResultDto,
  type SkillRepositoryDetailDto,
  type SkillRepositoryFileContentDto,
  type SkillRepositoryFileDeleteInput,
  type SkillRepositoryFileDto,
  type SkillRepositoryFileRenameInput,
  type SkillRepositoryFileUploadInput,
  type SkillRepositoryForkInput,
  type SkillRepositoryForkResultDto,
  type SkillRepositoryInstallSessionDto,
  type SkillRepositoryItemDto,
  type SkillRepositoryLegacyContentRouteDto,
  type SkillRepositoryListResultDto,
  type SkillRepositoryPublicListInput,
  type SkillRepositoryPublicPathDto,
  type SkillRepositoryResolvedInstallSessionDto,
  type SkillRepositoryStatus,
  type SkillRepositoryTextSaveInput,
  type SkillRepositoryUpdateInput,
  type SkillRepositoryVisibility,
} from "@synapse/shared"
import { CONTENT_STORE_STORAGE_PORT } from "../content-store/content-store.constants"
import type { ContentStoreStoragePort } from "../content-store/content-store-storage"
import { PrismaService } from "../prisma/prisma.service"
import {
  isSkillRepositoryRootPath,
  normalizeSkillRepositoryFile,
  normalizeSkillRepositoryFiles,
  normalizeSkillRepositoryPath,
  type NormalizedSkillRepositoryFile,
} from "./skill-repository-file-rules"
import { buildSkillRepositoryInstallPackage } from "./skill-repository-install-package"
import type { SkillRepositoryImportRequest } from "./skill-repository.types"

const skillRepositoryInstallSessionTtlSeconds = 5 * 60

interface SkillRepositoryOwnerRow {
  readonly id: string
  readonly handle: string | null
  readonly displayName: string | null
}

interface SkillRepositoryRow {
  readonly id: string
  readonly ownerUserId: string
  readonly owner?: SkillRepositoryOwnerRow | null
  readonly name: string
  readonly title: string
  readonly description: string | null
  readonly visibility: string
  readonly status: string
  readonly forkedFromRepositoryId: string | null
  readonly legacyContentStoreItemId: string | null
  readonly legacyInstallCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly lastSyncedAt: Date | null
  readonly files?: readonly SkillRepositoryFileRow[]
}

interface SkillRepositoryFileRow {
  readonly id: string
  readonly path: string
  readonly pathKey: string
  readonly kind: string
  readonly mimeType: string | null
  readonly size: bigint | number
  readonly sha256: string
  readonly storageKey: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

interface SkillRepositoryStorageKeyRow {
  readonly storageKey: string | null
}

interface UserHandleRedirectRow {
  readonly userId: string
}

interface SkillRepositoryNameRedirectRow {
  readonly repositoryId: string
}

interface SkillRepositoryInstallSessionRow {
  readonly id: string
  readonly userId: string
  readonly repositoryId: string
  readonly packageStorageKey: string
  readonly packageSha256: string
  readonly packageSize: bigint | number
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly repository: SkillRepositoryRow
}

interface LegacyContentStoreItemRouteRow {
  readonly id: string
  readonly type: string
  readonly ownerUserId: string
}

@Injectable()
export class SkillRepositoryService {
  private readonly logger = new Logger(SkillRepositoryService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONTENT_STORE_STORAGE_PORT) private readonly storage: ContentStoreStoragePort,
  ) {}

  async importRepository(userId: string, input: SkillRepositoryImportRequest): Promise<SkillRepositoryDetailDto> {
    const files = normalizeImportFiles(input.files)
    const explicitRepositoryId = input.repositoryId?.trim() || null
    const staleStorageKeys: string[] = []
    const uploadedStorageKeys: string[] = []

    let existingRepository: SkillRepositoryRow | null = null
    let createName: string | null = null

    if (explicitRepositoryId) {
      existingRepository = await this.prisma.skillRepository.findFirst({
        where: { id: explicitRepositoryId, ownerUserId: userId, status: "active" },
      }) as SkillRepositoryRow | null
      if (!existingRepository) throw new NotFoundException("Skill 仓库不存在。")
    } else {
      createName = normalizeRepositoryName(input.name)
      const sameNameRepository = await this.prisma.skillRepository.findFirst({
        where: { ownerUserId: userId, name: createName },
      }) as SkillRepositoryRow | null
      if (sameNameRepository) throw skillRepositoryConflict("Skill 仓库名已存在。")

      const redirectConflict = await this.prisma.skillRepositoryNameRedirect.findUnique({
        where: { ownerUserId_oldName: { ownerUserId: userId, oldName: createName } },
      })
      if (redirectConflict) throw skillRepositoryConflict("Skill 仓库名已存在。")
    }

    const nextTitle = normalizeTitle(input.title, existingRepository?.title ?? createName!)
    const nextDescription = input.description === undefined && existingRepository
      ? existingRepository.description
      : normalizeDescription(input.description)

    let repositoryId: string
    try {
      repositoryId = await this.prisma.$transaction(async (tx) => {
        const repository = existingRepository ?? await tx.skillRepository.create({
          data: {
            ownerUserId: userId,
            name: createName!,
            title: nextTitle,
            description: nextDescription,
            visibility: "private",
            status: "active",
            lastSyncedAt: new Date(),
          },
        }) as SkillRepositoryRow

        const oldFiles = await tx.skillRepositoryFile.findMany({
          where: { repositoryId: repository.id },
          select: { storageKey: true },
        }) as SkillRepositoryStorageKeyRow[]
        staleStorageKeys.push(...oldFiles.map((file) => file.storageKey).filter((key): key is string => Boolean(key)))
        const staleUniqueKeys = uniqueKeys(staleStorageKeys)
        if (staleUniqueKeys.length > 0) {
          await tx.skillRepositoryObjectCleanupTask.createMany({
            data: staleUniqueKeys.map((storageKey) => ({
              repositoryId: repository.id,
              storageKey,
              reason: "skill-file-replaced",
            })),
            skipDuplicates: true,
          })
        }

        const rows = []
        for (const file of files) {
          const fileId = randomUUID()
          const storageKey = `skill-repositories/${repository.id}/files/${fileId}/${file.sha256}`
          await this.storage.putObject({ key: storageKey, body: file.bytes, contentType: file.mimeType ?? undefined })
          uploadedStorageKeys.push(storageKey)
          rows.push(skillRepositoryFileCreateRow(repository.id, fileId, storageKey, file))
        }

        await tx.skillRepository.update({
          where: { id: repository.id },
          data: {
            title: nextTitle,
            description: nextDescription,
            lastSyncedAt: new Date(),
          },
        })
        await tx.skillRepositoryFile.deleteMany({ where: { repositoryId: repository.id } })
        if (rows.length > 0) await tx.skillRepositoryFile.createMany({ data: rows })

        return repository.id
      })
    } catch (error) {
      await this.cleanupNewObjects(uploadedStorageKeys)
      if (!explicitRepositoryId && isPrismaUniqueConstraintError(error)) {
        throw skillRepositoryConflict("Skill 仓库名已存在。")
      }
      throw error
    }

    await this.cleanupStaleObjects(staleStorageKeys)
    return this.getMine(userId, repositoryId)
  }

  async listMine(userId: string): Promise<SkillRepositoryItemDto[]> {
    const repositories = await this.prisma.skillRepository.findMany({
      where: { ownerUserId: userId, status: "active" },
      orderBy: { updatedAt: "desc" },
      include: { owner: { select: { id: true, handle: true, displayName: true } } },
    }) as SkillRepositoryRow[]
    return repositories.map(repositoryItemDto)
  }

  async getMine(userId: string, repositoryId: string): Promise<SkillRepositoryDetailDto> {
    const repository = await this.prisma.skillRepository.findFirst({
      where: { id: repositoryId, ownerUserId: userId, status: "active" },
      include: {
        owner: { select: { id: true, handle: true, displayName: true } },
        files: { orderBy: { path: "asc" } },
      },
    }) as SkillRepositoryRow | null
    if (!repository) throw new NotFoundException("Skill 仓库不存在。")
    return repositoryDetailDto(repository)
  }

  async resolveLegacyContentRoute(
    userId: string,
    contentId: string,
    publicAppUrl: string,
  ): Promise<SkillRepositoryLegacyContentRouteDto> {
    const item = await this.prisma.contentStoreItem.findUnique({
      where: { id: contentId },
      select: { id: true, type: true, ownerUserId: true },
    }) as LegacyContentStoreItemRouteRow | null
    if (!item) return { status: "not_found", message: "旧内容不存在。" }

    if (item.type === "rule" || item.type === "prompt") {
      return {
        status: "retired",
        contentType: item.type,
        message: item.type === "rule" ? "云端 Rule 商店已停止维护。" : "云端 Prompt 商店已停止维护。",
      }
    }

    const repository = await this.prisma.skillRepository.findUnique({
      where: { legacyContentStoreItemId: contentId },
      include: { owner: { select: { id: true, handle: true, displayName: true } } },
    }) as SkillRepositoryRow | null
    if (!repository || !canReadRepository(userId, repository)) {
      return { status: "not_found", message: "旧 Skill 尚未迁移。" }
    }

    return {
      status: "migrated",
      repositoryId: repository.id,
      managementUrl: buildSkillRepositoryManagementUrl(publicAppUrl, repository.id),
      publicUrl: repository.visibility === "public" && repository.owner?.handle
        ? buildSkillRepositoryPublicUrl(publicAppUrl, repository.owner.handle, repository.name)
        : null,
    }
  }

  async listPublic(input: SkillRepositoryPublicListInput = {}): Promise<SkillRepositoryListResultDto> {
    const page = normalizePage(input.page)
    const pageSize = normalizePageSize(input.pageSize)
    const query = input.query?.trim()
    const where: Prisma.SkillRepositoryWhereInput = {
      visibility: "public",
      status: "active",
      owner: { handle: { not: null } },
      ...(query ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { owner: { handle: { contains: query, mode: "insensitive" } } },
        ],
      } : {}),
    }
    const total = await this.prisma.skillRepository.count({ where })
    const repositories = await this.prisma.skillRepository.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { owner: { select: { id: true, handle: true, displayName: true } } },
    }) as SkillRepositoryRow[]
    return {
      items: repositories.map(repositoryItemDto),
      total,
      page,
      pageSize,
    }
  }

  async getReadable(userId: string, repositoryId: string): Promise<SkillRepositoryDetailDto> {
    const repository = await this.requireReadableActiveRepository(userId, repositoryId, true)
    return repositoryDetailDto(repository)
  }

  async getPublicByPath(userId: string, ownerHandle: string, repositoryName: string): Promise<SkillRepositoryPublicPathDto> {
    const normalizedHandle = normalizeUserHandleForRequest(ownerHandle)
    const normalizedName = normalizeRepositoryName(repositoryName)
    const { userId: ownerUserId, redirected: handleRedirected } = await this.resolveOwnerHandle(normalizedHandle)
    const { repository, redirected: nameRedirected } = await this.resolvePublicRepositoryName(ownerUserId, normalizedName)
    const canonicalOwnerHandle = repository.owner?.handle
    if (!canonicalOwnerHandle) throw new NotFoundException("Skill 仓库不存在。")
    return {
      repository: repositoryDetailDto(repository),
      canonicalPath: {
        ownerHandle: canonicalOwnerHandle,
        repositoryName: repository.name,
      },
      redirected: handleRedirected || nameRedirected,
    }
  }

  async updateMine(userId: string, repositoryId: string, input: SkillRepositoryUpdateInput): Promise<SkillRepositoryDetailDto> {
    const existingRepository = await this.requireOwnedActiveRepository(userId, repositoryId)
    const nextName = input.name === undefined ? existingRepository.name : normalizeRepositoryName(input.name)
    const nextTitle = input.title === undefined ? existingRepository.title : normalizeTitle(input.title, existingRepository.title)
    const nextDescription = input.description === undefined ? existingRepository.description : normalizeDescription(input.description)
    const nextVisibility = input.visibility === undefined ? toVisibility(existingRepository.visibility) : normalizeVisibility(input.visibility)

    if (nextName !== existingRepository.name) {
      const sameNameRepository = await this.prisma.skillRepository.findFirst({
        where: { ownerUserId: userId, name: nextName },
      }) as SkillRepositoryRow | null
      if (sameNameRepository && sameNameRepository.id !== repositoryId) throw skillRepositoryConflict("Skill 仓库名已存在。")

      const redirectConflict = await this.prisma.skillRepositoryNameRedirect.findUnique({
        where: { ownerUserId_oldName: { ownerUserId: userId, oldName: nextName } },
      })
      if (redirectConflict) throw skillRepositoryConflict("Skill 仓库名已存在。")
    }

    if (nextVisibility === "public" && toVisibility(existingRepository.visibility) !== "public") {
      const owner = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { handle: true },
      }) as { readonly handle: string | null } | null
      if (!owner?.handle) throw userHandleRequired()
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        if (nextName !== existingRepository.name) {
          await tx.skillRepositoryNameRedirect.create({
            data: {
              ownerUserId: userId,
              oldName: existingRepository.name,
              repositoryId,
            },
          })
        }
        await tx.skillRepository.update({
          where: { id: repositoryId },
          data: {
            name: nextName,
            title: nextTitle,
            description: nextDescription,
            visibility: nextVisibility,
          },
        })
      })
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) throw skillRepositoryConflict("Skill 仓库名已存在。")
      throw error
    }

    return this.getMine(userId, repositoryId)
  }

  async deleteMine(userId: string, repositoryId: string): Promise<SkillRepositoryDeleteResultDto> {
    await this.requireOwnedActiveRepository(userId, repositoryId)
    const staleStorageKeys: string[] = []

    const repository = await this.prisma.$transaction(async (tx) => {
      const oldFiles = await tx.skillRepositoryFile.findMany({
        where: { repositoryId },
        select: { storageKey: true },
      }) as SkillRepositoryStorageKeyRow[]
      staleStorageKeys.push(...oldFiles.map((file) => file.storageKey).filter((key): key is string => Boolean(key)))
      await this.createCleanupTasks(tx, repositoryId, staleStorageKeys, "skill-repository-removed")
      return tx.skillRepository.update({
        where: { id: repositoryId },
        data: { status: "removed" },
      }) as Promise<SkillRepositoryRow>
    })

    await this.cleanupStaleObjects(staleStorageKeys)
    return { id: repository.id, status: toStatus(repository.status) }
  }

  async getFileContent(userId: string, repositoryId: string, path: string): Promise<SkillRepositoryFileContentDto> {
    await this.requireReadableActiveRepository(userId, repositoryId)
    const file = await this.requireRepositoryFile(repositoryId, path)
    const size = numberFromSize(file.size)
    if (toFileKind(file.kind) !== "text") {
      return { file: fileDto(file), text: null, downloadUrl: null, truncated: false }
    }
    if (!file.storageKey) throw new NotFoundException("Skill 文件不存在。")
    if (size > skillRepositoryTextPreviewMaxBytes) {
      return { file: fileDto(file), text: null, downloadUrl: null, truncated: true }
    }
    const object = await this.storage.getObjectStream({ key: file.storageKey })
    const bytes = await readStreamBuffer(object.stream)
    return {
      file: fileDto(file),
      text: bytes.toString("utf8"),
      downloadUrl: null,
      truncated: false,
    }
  }

  async openFileDownload(userId: string, repositoryId: string, path: string) {
    await this.requireReadableActiveRepository(userId, repositoryId)
    const file = await this.requireRepositoryFile(repositoryId, path)
    if (!file.storageKey) throw new NotFoundException("Skill 文件不存在。")
    const object = await this.storage.getObjectStream({ key: file.storageKey })
    return {
      stream: object.stream,
      contentType: file.mimeType ?? "application/octet-stream",
      size: numberFromSize(file.size),
      filename: file.path.split("/").filter(Boolean).at(-1) ?? "skill-file",
    }
  }

  async saveTextFile(userId: string, repositoryId: string, input: SkillRepositoryTextSaveInput): Promise<SkillRepositoryDetailDto> {
    await this.requireOwnedActiveRepository(userId, repositoryId)
    const existingFile = await this.requireRepositoryFile(repositoryId, input.path)
    if (toFileKind(existingFile.kind) !== "text") throw new BadRequestException("只能编辑文本文件。")
    if (existingFile.sha256 !== input.expectedSha256) throw skillRepositoryFileConflict()

    const normalizedFile = normalizeMutatedFile({
      path: existingFile.path,
      contentBase64: Buffer.from(input.text).toString("base64"),
      mimeType: existingFile.mimeType,
    })
    const staleStorageKeys: string[] = []
    await this.replaceRepositoryFile(repositoryId, normalizedFile, existingFile, staleStorageKeys, "skill-file-replaced")
    await this.cleanupStaleObjects(staleStorageKeys)
    return this.getMine(userId, repositoryId)
  }

  async uploadFile(userId: string, repositoryId: string, input: SkillRepositoryFileUploadInput): Promise<SkillRepositoryDetailDto> {
    await this.requireOwnedActiveRepository(userId, repositoryId)
    const normalizedFile = normalizeMutatedFile(input)
    const existingFile = await this.findRepositoryFile(repositoryId, normalizedFile.path)
    if (!existingFile && input.expectedSha256) throw skillRepositoryFileConflict()
    if (existingFile && input.expectedSha256 && existingFile.sha256 !== input.expectedSha256) throw skillRepositoryFileConflict()

    const staleStorageKeys: string[] = []
    await this.replaceRepositoryFile(repositoryId, normalizedFile, existingFile, staleStorageKeys, existingFile ? "skill-file-replaced" : null)
    await this.cleanupStaleObjects(staleStorageKeys)
    return this.getMine(userId, repositoryId)
  }

  async renameFile(userId: string, repositoryId: string, input: SkillRepositoryFileRenameInput): Promise<SkillRepositoryDetailDto> {
    await this.requireOwnedActiveRepository(userId, repositoryId)
    const fromPath = normalizeSkillRepositoryPath(input.fromPath)
    if (isSkillRepositoryRootPath(fromPath)) throw protectedRootFile()
    const toPath = normalizeSkillRepositoryPath(input.toPath)
    if (isSkillRepositoryRootPath(toPath)) throw protectedRootFile()

    const existingFile = await this.requireRepositoryFile(repositoryId, fromPath)
    const targetFile = await this.findRepositoryFile(repositoryId, toPath)
    if (targetFile && targetFile.id !== existingFile.id) throw new BadRequestException("目标文件已存在。")

    await this.prisma.skillRepositoryFile.update({
      where: { id: existingFile.id },
      data: { path: toPath, pathKey: toPath.toLowerCase() },
    })
    await this.touchRepository(repositoryId)
    return this.getMine(userId, repositoryId)
  }

  async deleteFile(userId: string, repositoryId: string, input: SkillRepositoryFileDeleteInput): Promise<SkillRepositoryDetailDto> {
    await this.requireOwnedActiveRepository(userId, repositoryId)
    const path = normalizeSkillRepositoryPath(input.path)
    if (isSkillRepositoryRootPath(path)) throw protectedRootFile()
    const existingFile = await this.requireRepositoryFile(repositoryId, path)
    if (input.expectedSha256 && existingFile.sha256 !== input.expectedSha256) throw skillRepositoryFileConflict()

    const staleStorageKeys = existingFile.storageKey ? [existingFile.storageKey] : []
    await this.prisma.$transaction(async (tx) => {
      await this.createCleanupTasks(tx, repositoryId, staleStorageKeys, "skill-file-deleted")
      await tx.skillRepositoryFile.deleteMany({ where: { repositoryId, pathKey: existingFile.pathKey } })
      await tx.skillRepository.update({ where: { id: repositoryId }, data: { lastSyncedAt: new Date() } })
    })

    await this.cleanupStaleObjects(staleStorageKeys)
    return this.getMine(userId, repositoryId)
  }

  async forkRepository(userId: string, sourceRepositoryId: string, input: SkillRepositoryForkInput = {}): Promise<SkillRepositoryForkResultDto> {
    const source = await this.requireReadableActiveRepository(userId, sourceRepositoryId, true)
    const nextName = await this.findAvailableForkName(userId, input.name ?? source.name)
    const nextTitle = normalizeTitle(input.title, source.title)
    const uploadedStorageKeys: string[] = []

    let repositoryId: string
    try {
      repositoryId = await this.prisma.$transaction(async (tx) => {
        const repository = await tx.skillRepository.create({
          data: {
            ownerUserId: userId,
            name: nextName,
            title: nextTitle,
            description: source.description,
            visibility: "private",
            status: "active",
            forkedFromRepositoryId: source.id,
            lastSyncedAt: new Date(),
          },
        }) as SkillRepositoryRow

        const rows = []
        for (const sourceFile of source.files ?? []) {
          if (!sourceFile.storageKey) throw new NotFoundException("Skill 文件不存在。")
          const object = await this.storage.getObjectStream({ key: sourceFile.storageKey })
          const bytes = await readStreamBuffer(object.stream)
          const fileId = randomUUID()
          const storageKey = `skill-repositories/${repository.id}/files/${fileId}/${sourceFile.sha256}`
          await this.storage.putObject({ key: storageKey, body: bytes, contentType: sourceFile.mimeType ?? undefined })
          uploadedStorageKeys.push(storageKey)
          rows.push({
            id: fileId,
            repositoryId: repository.id,
            path: sourceFile.path,
            pathKey: sourceFile.pathKey,
            kind: sourceFile.kind,
            mimeType: sourceFile.mimeType,
            size: sourceFile.size,
            sha256: sourceFile.sha256,
            storageKey,
          })
        }

        if (rows.length > 0) await tx.skillRepositoryFile.createMany({ data: rows })
        return repository.id
      })
    } catch (error) {
      await this.cleanupNewObjects(uploadedStorageKeys)
      throw error
    }

    return {
      repository: await this.getMine(userId, repositoryId),
      managementUrl: null,
    }
  }

  async createInstallSession(
    userId: string,
    repositoryId: string,
    deepLinkBase = defaultSkillRepositoryInstallDeepLinkBase,
  ): Promise<SkillRepositoryInstallSessionDto> {
    const repository = await this.requireReadableActiveRepository(userId, repositoryId, true)
    const deepLinkUrl = appendSkillRepositoryInstallSessionToDeepLink(deepLinkBase, "placeholder")
    if (!deepLinkUrl.startsWith("synapse://skill-install")) throw new BadRequestException("安装入口无效。")

    const sessionId = randomUUID()
    const packageKey = `skill-repositories/${repository.id}/exports/${sessionId}.zip`
    const packageResult = await buildSkillRepositoryInstallPackage({
      repository,
      files: repository.files ?? [],
      storage: this.storage,
    })
    await this.storage.putObject({ key: packageKey, body: packageResult.packageBuffer, contentType: "application/zip" })

    try {
      const expiresAt = new Date(Date.now() + skillRepositoryInstallSessionTtlSeconds * 1000)
      const session = await this.prisma.skillRepositoryInstallSession.create({
        data: {
          id: sessionId,
          userId,
          repositoryId: repository.id,
          packageStorageKey: packageKey,
          packageSha256: packageResult.packageSha256,
          packageSize: BigInt(packageResult.packageSize),
          expiresAt,
        },
      }) as { readonly id: string; readonly expiresAt: Date }
      return {
        id: session.id,
        repositoryId: repository.id,
        repositoryName: repository.name,
        ownerHandle: repository.owner?.handle ?? repository.ownerUserId,
        title: repository.title,
        packageSha256: packageResult.packageSha256,
        packageSize: packageResult.packageSize,
        expiresAt: session.expiresAt.toISOString(),
        deepLinkUrl: appendSkillRepositoryInstallSessionToDeepLink(deepLinkBase, session.id),
      }
    } catch (error) {
      await this.cleanupNewObjects([packageKey])
      throw error
    }
  }

  async resolveInstallSession(userId: string, sessionId: string): Promise<SkillRepositoryResolvedInstallSessionDto> {
    const session = await this.resolveInstallSessionForPackage(userId, sessionId)
    return {
      id: session.id,
      repository: repositoryItemDto(session.repository),
      packageSha256: session.packageSha256,
      packageSize: numberFromSize(session.packageSize),
      expiresAt: session.expiresAt.toISOString(),
    }
  }

  async openInstallPackage(userId: string, sessionId: string): Promise<{
    readonly stream: NodeJS.ReadableStream
    readonly packageSha256: string
    readonly packageSize: number
    readonly contentType: string
  }> {
    const session = await this.resolveInstallSessionForPackage(userId, sessionId)
    const object = await this.storage.getObjectStream({ key: session.packageStorageKey })
    return {
      stream: object.stream,
      packageSha256: session.packageSha256,
      packageSize: numberFromSize(object.size ?? session.packageSize),
      contentType: "application/zip",
    }
  }

  async recordInstall(userId: string, sessionId: string, clientInstanceId: string): Promise<{ ok: true }> {
    const consumedAt = new Date()
    const session = await this.prisma.skillRepositoryInstallSession.findFirst({
      where: { id: sessionId },
      include: {
        repository: {
          include: { owner: { select: { id: true, handle: true, displayName: true } } },
        },
      },
    }) as SkillRepositoryInstallSessionRow | null
    if (!session) throw installSessionNotFound()
    if (session.userId !== userId) throw new ForbiddenException("安装会话不属于当前用户。")
    if (session.expiresAt.getTime() <= consumedAt.getTime()) throw new BadRequestException("安装会话已过期。")
    if (!canReadRepository(userId, session.repository)) throw new NotFoundException("Skill 仓库不存在。")

    const eventKey = {
      userId,
      repositoryId: session.repositoryId,
      clientInstanceId,
    }
    if (session.consumedAt) {
      const existingEvent = await this.prisma.skillRepositoryInstallEvent.findUnique({
        where: { userId_repositoryId_clientInstanceId: eventKey },
      })
      if (existingEvent) return { ok: true }
      throw new BadRequestException("安装会话已失效。")
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.skillRepositoryInstallSession.updateMany({
        where: {
          id: sessionId,
          userId,
          consumedAt: null,
          expiresAt: { gt: consumedAt },
        },
        data: { consumedAt },
      })
      if (consumed.count !== 1) {
        const existingEvent = await tx.skillRepositoryInstallEvent.findUnique({
          where: { userId_repositoryId_clientInstanceId: eventKey },
        })
        if (existingEvent) return
        throw new BadRequestException("安装会话已失效。")
      }
      await tx.skillRepositoryInstallEvent.upsert({
        where: { userId_repositoryId_clientInstanceId: eventKey },
        update: {},
        create: eventKey,
      })
    })

    return { ok: true }
  }

  @Cron("0 * * * *")
  async scheduledInstallSessionCleanup(): Promise<void> {
    await this.cleanupExpiredInstallSessions()
  }

  async cleanupExpiredInstallSessions(now = new Date()): Promise<number> {
    const sessions = await this.prisma.skillRepositoryInstallSession.findMany({
      where: { expiresAt: { lte: now }, consumedAt: null },
      select: { id: true, packageStorageKey: true },
    }) as Array<{ readonly id: string; readonly packageStorageKey: string }>
    if (sessions.length === 0) return 0

    await this.prisma.skillRepositoryInstallSession.deleteMany({
      where: { id: { in: sessions.map((session) => session.id) } },
    })
    for (const session of sessions) {
      await this.cleanupNewObjects([session.packageStorageKey])
    }
    this.logger.log(`Deleted ${sessions.length} expired skill repository install sessions`)
    return sessions.length
  }

  private async cleanupStaleObjects(keys: readonly string[]): Promise<void> {
    for (const key of uniqueKeys(keys)) {
      try {
        await this.storage.deleteObject(key)
        await this.prisma.skillRepositoryObjectCleanupTask.deleteMany({ where: { storageKey: key } })
      } catch (error) {
        try {
          await this.prisma.skillRepositoryObjectCleanupTask.updateMany({
            where: { storageKey: key },
            data: {
              attempts: { increment: 1 },
              lastError: cleanupErrorMessage(error),
            },
          })
        } catch (cleanupTaskError) {
          this.logger.warn(`Skill repository cleanup task update failed for ${key}: ${cleanupErrorMessage(cleanupTaskError)}`)
        }
        this.logger.warn(`Skill repository stale object delete failed for ${key}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private async cleanupNewObjects(keys: readonly string[]): Promise<void> {
    for (const key of uniqueKeys(keys)) {
      try {
        await this.storage.deleteObject(key)
      } catch (error) {
        this.logger.warn(`Skill repository new object rollback cleanup failed for ${key}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private async requireOwnedActiveRepository(userId: string, repositoryId: string): Promise<SkillRepositoryRow> {
    const repository = await this.prisma.skillRepository.findFirst({
      where: { id: repositoryId, ownerUserId: userId, status: "active" },
    }) as SkillRepositoryRow | null
    if (!repository) throw new NotFoundException("Skill 仓库不存在。")
    return repository
  }

  private async requireReadableActiveRepository(
    userId: string,
    repositoryId: string,
    includeFiles = false,
  ): Promise<SkillRepositoryRow> {
    const repository = await this.prisma.skillRepository.findFirst({
      where: {
        id: repositoryId,
        status: "active",
        OR: [
          { ownerUserId: userId },
          { visibility: "public" },
        ],
      },
      include: {
        owner: { select: { id: true, handle: true, displayName: true } },
        ...(includeFiles ? { files: { orderBy: { path: "asc" } } } : {}),
      },
    }) as SkillRepositoryRow | null
    if (!repository || !canReadRepository(userId, repository)) throw new NotFoundException("Skill 仓库不存在。")
    return repository
  }

  private async resolveOwnerHandle(handle: string): Promise<{ readonly userId: string; readonly redirected: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { handle },
      select: { id: true },
    }) as { readonly id: string } | null
    if (user) return { userId: user.id, redirected: false }

    const redirect = await this.prisma.userHandleRedirect.findUnique({
      where: { oldHandle: handle },
      select: { userId: true },
    }) as UserHandleRedirectRow | null
    if (!redirect) throw new NotFoundException("Skill 仓库不存在。")
    return { userId: redirect.userId, redirected: true }
  }

  private async resolvePublicRepositoryName(
    ownerUserId: string,
    name: string,
  ): Promise<{ readonly repository: SkillRepositoryRow; readonly redirected: boolean }> {
    const repository = await this.prisma.skillRepository.findFirst({
      where: { ownerUserId, name, visibility: "public", status: "active" },
      include: {
        owner: { select: { id: true, handle: true, displayName: true } },
        files: { orderBy: { path: "asc" } },
      },
    }) as SkillRepositoryRow | null
    if (repository) return { repository, redirected: false }

    const redirect = await this.prisma.skillRepositoryNameRedirect.findUnique({
      where: { ownerUserId_oldName: { ownerUserId, oldName: name } },
      select: { repositoryId: true },
    }) as SkillRepositoryNameRedirectRow | null
    if (!redirect) throw new NotFoundException("Skill 仓库不存在。")

    const redirectedRepository = await this.prisma.skillRepository.findFirst({
      where: { id: redirect.repositoryId, ownerUserId, visibility: "public", status: "active" },
      include: {
        owner: { select: { id: true, handle: true, displayName: true } },
        files: { orderBy: { path: "asc" } },
      },
    }) as SkillRepositoryRow | null
    if (!redirectedRepository) throw new NotFoundException("Skill 仓库不存在。")
    return { repository: redirectedRepository, redirected: true }
  }

  private async findAvailableForkName(userId: string, requestedName: string): Promise<string> {
    const baseName = normalizeRepositoryName(requestedName)
    const candidates = [baseName, `${baseName}-fork`]
    for (let index = 2; index <= 100; index += 1) {
      candidates.push(`${baseName}-fork-${index}`)
    }
    for (const candidate of candidates) {
      const normalized = normalizeRepositoryName(candidate)
      const existing = await this.prisma.skillRepository.findFirst({
        where: { ownerUserId: userId, name: normalized },
      }) as SkillRepositoryRow | null
      if (existing) continue
      const redirect = await this.prisma.skillRepositoryNameRedirect.findUnique({
        where: { ownerUserId_oldName: { ownerUserId: userId, oldName: normalized } },
      })
      if (!redirect) return normalized
    }
    throw skillRepositoryConflict("Skill 仓库名已存在。")
  }

  private async resolveInstallSessionForPackage(userId: string, sessionId: string): Promise<SkillRepositoryInstallSessionRow> {
    const session = await this.prisma.skillRepositoryInstallSession.findFirst({
      where: { id: sessionId },
      include: {
        repository: {
          include: {
            owner: { select: { id: true, handle: true, displayName: true } },
          },
        },
      },
    }) as SkillRepositoryInstallSessionRow | null
    if (!session) throw installSessionNotFound()
    if (session.userId !== userId) throw new ForbiddenException("安装会话不属于当前用户。")
    if (session.consumedAt) throw new BadRequestException("安装会话已失效。")
    if (session.expiresAt.getTime() <= Date.now()) throw new BadRequestException("安装会话已过期。")
    if (!canReadRepository(userId, session.repository)) throw new NotFoundException("Skill 仓库不存在。")
    return session
  }

  private async findRepositoryFile(repositoryId: string, path: string): Promise<SkillRepositoryFileRow | null> {
    const relativePath = normalizeSkillRepositoryPath(path)
    return this.prisma.skillRepositoryFile.findFirst({
      where: { repositoryId, pathKey: relativePath.toLowerCase() },
    }) as Promise<SkillRepositoryFileRow | null>
  }

  private async requireRepositoryFile(repositoryId: string, path: string): Promise<SkillRepositoryFileRow> {
    const file = await this.findRepositoryFile(repositoryId, path)
    if (!file) throw new NotFoundException("Skill 文件不存在。")
    return file
  }

  private async replaceRepositoryFile(
    repositoryId: string,
    file: NormalizedSkillRepositoryFile,
    existingFile: SkillRepositoryFileRow | null,
    staleStorageKeys: string[],
    staleReason: string | null,
  ): Promise<void> {
    const uploadedStorageKeys: string[] = []
    try {
      await this.prisma.$transaction(async (tx) => {
        if (existingFile?.storageKey) staleStorageKeys.push(existingFile.storageKey)
        if (staleReason) await this.createCleanupTasks(tx, repositoryId, staleStorageKeys, staleReason)

        const fileId = randomUUID()
        const storageKey = `skill-repositories/${repositoryId}/files/${fileId}/${file.sha256}`
        await this.storage.putObject({ key: storageKey, body: file.bytes, contentType: file.mimeType ?? undefined })
        uploadedStorageKeys.push(storageKey)

        await tx.skillRepositoryFile.deleteMany({ where: { repositoryId, pathKey: file.pathKey } })
        await tx.skillRepositoryFile.createMany({ data: [skillRepositoryFileCreateRow(repositoryId, fileId, storageKey, file)] })
        await tx.skillRepository.update({ where: { id: repositoryId }, data: { lastSyncedAt: new Date() } })
      })
    } catch (error) {
      await this.cleanupNewObjects(uploadedStorageKeys)
      throw error
    }
  }

  private async touchRepository(repositoryId: string): Promise<void> {
    await this.prisma.skillRepository.update({
      where: { id: repositoryId },
      data: { lastSyncedAt: new Date() },
    })
  }

  private async createCleanupTasks(
    tx: Pick<PrismaService, "skillRepositoryObjectCleanupTask">,
    repositoryId: string,
    keys: readonly string[],
    reason: string,
  ): Promise<void> {
    const staleUniqueKeys = uniqueKeys(keys)
    if (staleUniqueKeys.length === 0) return
    await tx.skillRepositoryObjectCleanupTask.createMany({
      data: staleUniqueKeys.map((storageKey) => ({
        repositoryId,
        storageKey,
        reason,
      })),
      skipDuplicates: true,
    })
  }
}

function skillRepositoryConflict(message: string): BadRequestException {
  return new BadRequestException({
    code: "SKILL_REPOSITORY_NAME_CONFLICT",
    message,
  })
}

function skillRepositoryFileConflict(): ConflictException {
  return new ConflictException({
    code: "SKILL_REPOSITORY_FILE_CONFLICT",
    message: "文件已有新内容。",
  })
}

function userHandleRequired(): BadRequestException {
  return new BadRequestException({
    code: "USER_HANDLE_REQUIRED",
    message: "公开 Skill 仓库前需要先设置用户名。",
    settingsPath: "/settings/profile",
  })
}

function installSessionNotFound(): NotFoundException {
  return new NotFoundException({
    code: "SKILL_REPOSITORY_INSTALL_SESSION_NOT_FOUND",
    message: "安装会话不存在。",
  })
}

function protectedRootFile(): BadRequestException {
  return new BadRequestException({
    code: "SKILL_REPOSITORY_PROTECTED_ROOT_FILE",
    message: "SKILL.md 不能被重命名或删除。",
  })
}

function invalidSkill(message: string): BadRequestException {
  return new BadRequestException({
    code: "SKILL_REPOSITORY_INVALID_SKILL",
    message,
  })
}

function normalizeImportFiles(files: SkillRepositoryImportRequest["files"]): readonly NormalizedSkillRepositoryFile[] {
  try {
    return normalizeSkillRepositoryFiles(files)
  } catch (error) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse()
      const message = typeof response === "string"
        ? response
        : typeof response === "object" && response !== null && "message" in response
          ? String((response as { readonly message?: unknown }).message)
          : error.message
      throw invalidSkill(message)
    }
    throw error
  }
}

function normalizeMutatedFile(file: SkillRepositoryFileUploadInput): NormalizedSkillRepositoryFile {
  const normalizedFile = normalizeSkillRepositoryFile(file)
  if (isSkillRepositoryRootPath(normalizedFile.path) && (normalizedFile.kind !== "text" || !normalizedFile.text?.trim())) {
    throw invalidSkill("Skill 必须包含非空 SKILL.md。")
  }
  return normalizedFile
}

function normalizeRepositoryName(input: string | null | undefined): string {
  try {
    return normalizeSkillRepositoryName(input ?? "")
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : "仓库名无效。")
  }
}

function normalizeUserHandleForRequest(input: string): string {
  try {
    return normalizeUserHandle(input)
  } catch (error) {
    throw new NotFoundException(error instanceof Error ? error.message : "Skill 仓库不存在。")
  }
}

function normalizeVisibility(input: SkillRepositoryVisibility): SkillRepositoryVisibility {
  if (input === "private" || input === "public") return input
  throw new BadRequestException("公开状态无效。")
}

function normalizePage(input: number | null | undefined): number {
  if (!input || !Number.isFinite(input)) return 1
  return Math.max(1, Math.floor(input))
}

function normalizePageSize(input: number | null | undefined): number {
  if (!input || !Number.isFinite(input)) return 20
  return Math.min(50, Math.max(1, Math.floor(input)))
}

function normalizeDescription(description: string | null | undefined): string | null {
  const trimmed = description?.trim()
  if (trimmed && trimmed.length > 2000) throw new BadRequestException("描述不能超过 2000 个字符。")
  return trimmed ? trimmed : null
}

function normalizeTitle(title: string | null | undefined, fallback: string): string {
  const normalized = title?.trim() || fallback
  if (normalized.length > 160) throw new BadRequestException("标题不能超过 160 个字符。")
  return normalized
}

function skillRepositoryFileCreateRow(
  repositoryId: string,
  fileId: string,
  storageKey: string,
  file: NormalizedSkillRepositoryFile,
) {
  return {
    id: fileId,
    repositoryId,
    path: file.path,
    pathKey: file.pathKey,
    kind: file.kind,
    mimeType: file.mimeType,
    size: BigInt(file.size),
    sha256: file.sha256,
    storageKey,
  }
}

function repositoryDetailDto(repository: SkillRepositoryRow): SkillRepositoryDetailDto {
  return {
    ...repositoryItemDto(repository),
    files: (repository.files ?? []).map(fileDto),
  }
}

function repositoryItemDto(repository: SkillRepositoryRow): SkillRepositoryItemDto {
  return {
    id: repository.id,
    name: repository.name,
    title: repository.title,
    description: repository.description,
    visibility: toVisibility(repository.visibility),
    status: toStatus(repository.status),
    owner: {
      id: repository.owner?.id ?? repository.ownerUserId,
      handle: repository.owner?.handle ?? null,
      displayName: repository.owner?.displayName ?? null,
    },
    forkedFromRepositoryId: repository.forkedFromRepositoryId,
    legacyContentStoreItemId: repository.legacyContentStoreItemId,
    legacyInstallCount: repository.legacyInstallCount,
    createdAt: repository.createdAt.toISOString(),
    updatedAt: repository.updatedAt.toISOString(),
    lastSyncedAt: repository.lastSyncedAt?.toISOString() ?? null,
  }
}

function fileDto(file: SkillRepositoryFileRow): SkillRepositoryFileDto {
  return {
    id: file.id,
    path: file.path,
    size: numberFromSize(file.size),
    sha256: file.sha256,
    kind: toFileKind(file.kind),
    mimeType: file.mimeType,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  }
}

function toVisibility(value: string): SkillRepositoryVisibility {
  if (value === "private" || value === "public") return value
  return "private"
}

function toStatus(value: string): SkillRepositoryStatus {
  if (value === "active" || value === "removed") return value
  return "active"
}

function toFileKind(value: string): "text" | "binary" {
  return value === "text" ? "text" : "binary"
}

function canReadRepository(userId: string, repository: SkillRepositoryRow): boolean {
  if (repository.status !== "active") return false
  return repository.ownerUserId === userId || repository.visibility === "public"
}

function numberFromSize(size: bigint | number): number {
  return typeof size === "bigint" ? Number(size) : size
}

function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)]
}

function cleanupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 1000 ? message.slice(0, 1000) : message
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}
