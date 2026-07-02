import { randomUUID } from "node:crypto"
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import {
  normalizeSkillRepositoryName,
  type SkillRepositoryDetailDto,
  type SkillRepositoryFileDto,
  type SkillRepositoryItemDto,
  type SkillRepositoryStatus,
  type SkillRepositoryVisibility,
} from "@synapse/shared"
import { CONTENT_STORE_STORAGE_PORT } from "../content-store/content-store.constants"
import type { ContentStoreStoragePort } from "../content-store/content-store-storage"
import { PrismaService } from "../prisma/prisma.service"
import { normalizeSkillRepositoryFiles, type NormalizedSkillRepositoryFile } from "./skill-repository-file-rules"
import type { SkillRepositoryImportRequest } from "./skill-repository.types"

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
        where: { id: explicitRepositoryId, ownerUserId: userId, visibility: "private", status: "active" },
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
      where: { ownerUserId: userId, visibility: "private", status: "active" },
      orderBy: { updatedAt: "desc" },
      include: { owner: { select: { id: true, handle: true, displayName: true } } },
    }) as SkillRepositoryRow[]
    return repositories.map(repositoryItemDto)
  }

  async getMine(userId: string, repositoryId: string): Promise<SkillRepositoryDetailDto> {
    const repository = await this.prisma.skillRepository.findFirst({
      where: { id: repositoryId, ownerUserId: userId, visibility: "private", status: "active" },
      include: {
        owner: { select: { id: true, handle: true, displayName: true } },
        files: { orderBy: { path: "asc" } },
      },
    }) as SkillRepositoryRow | null
    if (!repository) throw new NotFoundException("Skill 仓库不存在。")
    return repositoryDetailDto(repository)
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
}

function skillRepositoryConflict(message: string): BadRequestException {
  return new BadRequestException({
    code: "SKILL_REPOSITORY_NAME_CONFLICT",
    message,
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

function normalizeRepositoryName(input: string | null | undefined): string {
  try {
    return normalizeSkillRepositoryName(input ?? "")
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : "仓库名无效。")
  }
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
