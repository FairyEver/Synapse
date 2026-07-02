import { randomUUID } from "node:crypto"
import { buffer as readStreamBuffer } from "node:stream/consumers"
import { Inject, Injectable, Logger } from "@nestjs/common"
import {
  normalizeSkillRepositoryName,
  type SkillRepositoryLegacyMigrationResultDto,
  type SkillRepositoryLegacyMigrationSkippedDto,
  type SkillRepositoryLegacyMigrationWarningDto,
} from "@synapse/shared"
import { CONTENT_STORE_STORAGE_PORT } from "../content-store/content-store.constants"
import type { ContentStoreStoragePort } from "../content-store/content-store-storage"
import { PrismaService } from "../prisma/prisma.service"
import { normalizeSkillRepositoryFiles, type SkillRepositoryFileInput } from "./skill-repository-file-rules"

type LegacyOwnerRow = {
  readonly handle: string | null
}

type LegacyItemRow = {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly description: string | null
  readonly ownerUserId: string
  readonly visibility: string
  readonly moderationStatus: string
  readonly latestVersionId: string | null
  readonly copiedFromContentId: string | null
  readonly owner?: LegacyOwnerRow | null
  readonly _count?: {
    readonly installEvents: number
  }
}

type LegacyFileRow = {
  readonly path: string
  readonly storageKey: string | null
  readonly text: string | null
  readonly mimeType: string | null
}

type LegacySourceRow = {
  readonly title: string
  readonly description: string | null
  readonly files?: readonly LegacyFileRow[]
}

type LegacyRepositoryRow = {
  readonly id: string
}

@Injectable()
export class SkillRepositoryLegacyMigrationService {
  private readonly logger = new Logger(SkillRepositoryLegacyMigrationService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONTENT_STORE_STORAGE_PORT) private readonly storage: ContentStoreStoragePort,
  ) {}

  async migrateOwnerSkills(ownerUserId: string): Promise<SkillRepositoryLegacyMigrationResultDto> {
    const items = await this.prisma.contentStoreItem.findMany({
      where: { ownerUserId },
      include: {
        owner: { select: { handle: true } },
        _count: { select: { installEvents: true } },
      },
      orderBy: { createdAt: "asc" },
    }) as LegacyItemRow[]

    const skipped: SkillRepositoryLegacyMigrationSkippedDto[] = []
    const warnings: SkillRepositoryLegacyMigrationWarningDto[] = []
    let migrated = 0
    let alreadyMigrated = 0

    for (const item of items) {
      if (item.type !== "skill") {
        skipped.push({ contentStoreItemId: item.id, reason: "not_skill" })
        continue
      }
      if (item.moderationStatus === "removed") {
        skipped.push({ contentStoreItemId: item.id, reason: "removed" })
        continue
      }

      const existing = await this.prisma.skillRepository.findUnique({
        where: { legacyContentStoreItemId: item.id },
      }) as LegacyRepositoryRow | null
      if (existing) {
        alreadyMigrated += 1
        continue
      }

      const source = await this.resolveSource(item)
      if (!source?.files?.length) {
        skipped.push({ contentStoreItemId: item.id, reason: "missing_source" })
        continue
      }

      const legacyFiles = await this.readLegacyFiles(source.files)
      if (!legacyFiles) {
        skipped.push({ contentStoreItemId: item.id, reason: "missing_source" })
        continue
      }

      let normalizedFiles
      try {
        normalizedFiles = normalizeSkillRepositoryFiles(legacyFiles)
      } catch (error) {
        skipped.push({
          contentStoreItemId: item.id,
          reason: "invalid_skill",
          message: error instanceof Error ? error.message : "Skill 文件无效。",
        })
        continue
      }

      const wantsPublic = item.visibility === "public"
      const hasHandle = Boolean(item.owner?.handle)
      if (wantsPublic && !hasHandle) {
        warnings.push({
          contentStoreItemId: item.id,
          code: "USER_HANDLE_REQUIRED",
          message: "公开 Skill 需要先设置用户名，已按私有仓库迁移。",
        })
      }

      const repositoryId = randomUUID()
      const forkedFromRepositoryId = await this.resolveLegacyForkSource(item, warnings)
      const uploadedStorageKeys: string[] = []
      try {
        const repositoryName = await this.findAvailableName(ownerUserId, source.title || item.title)
        const fileRows = []
        for (const file of normalizedFiles) {
          const storageKey = `skill-repositories/${repositoryId}/files/${randomUUID()}/${file.sha256}`
          await this.storage.putObject({
            key: storageKey,
            body: file.bytes,
            contentType: file.mimeType ?? undefined,
          })
          uploadedStorageKeys.push(storageKey)
          fileRows.push({
            repositoryId,
            path: file.path,
            pathKey: file.pathKey,
            kind: file.kind,
            mimeType: file.mimeType,
            size: BigInt(file.size),
            sha256: file.sha256,
            storageKey,
          })
        }

        const created = await this.prisma.$transaction(async (tx) => {
          const duplicate = await tx.skillRepository.findUnique({
            where: { legacyContentStoreItemId: item.id },
          }) as LegacyRepositoryRow | null
          if (duplicate) return false

          await tx.skillRepository.create({
            data: {
              id: repositoryId,
              ownerUserId,
              name: repositoryName,
              title: normalizeTitle(source.title || item.title),
              description: normalizeDescription(source.description ?? item.description),
              visibility: wantsPublic && hasHandle ? "public" : "private",
              status: "active",
              ...(forkedFromRepositoryId ? { forkedFromRepositoryId } : {}),
              legacyContentStoreItemId: item.id,
              legacyInstallCount: item._count?.installEvents ?? 0,
            },
          })
          await tx.skillRepositoryFile.createMany({ data: fileRows })
          return true
        })

        if (created) migrated += 1
        else {
          alreadyMigrated += 1
          await this.cleanupUploadedObjects(uploadedStorageKeys)
        }
      } catch (error) {
        await this.cleanupUploadedObjects(uploadedStorageKeys)
        this.logger.warn("Legacy Content Store Skill migration failed.", {
          contentStoreItemId: item.id,
          error,
        })
        skipped.push({
          contentStoreItemId: item.id,
          reason: "invalid_skill",
          message: error instanceof Error ? error.message : "Skill 迁移失败。",
        })
      }
    }

    return {
      scanned: items.length,
      migrated,
      alreadyMigrated,
      skipped,
      warnings,
    }
  }

  private async resolveLegacyForkSource(
    item: LegacyItemRow,
    warnings: SkillRepositoryLegacyMigrationWarningDto[],
  ): Promise<string | null> {
    if (!item.copiedFromContentId) return null
    const sourceRepository = await this.prisma.skillRepository.findUnique({
      where: { legacyContentStoreItemId: item.copiedFromContentId },
      select: { id: true },
    }) as LegacyRepositoryRow | null
    if (sourceRepository) return sourceRepository.id
    warnings.push({
      contentStoreItemId: item.id,
      code: "SKILL_REPOSITORY_LEGACY_FORK_SOURCE_MISSING",
      message: "旧 Skill 复制来源尚未迁移，已按独立仓库迁移。",
    })
    return null
  }

  private async resolveSource(item: LegacyItemRow): Promise<LegacySourceRow | null> {
    if (item.latestVersionId) {
      return this.prisma.contentStoreVersion.findUnique({
        where: { id: item.latestVersionId },
        include: { files: true },
      }) as Promise<LegacySourceRow | null>
    }

    return this.prisma.contentStoreDraft.findUnique({
      where: { itemId: item.id },
      include: { files: true },
    }) as Promise<LegacySourceRow | null>
  }

  private async readLegacyFiles(files: readonly LegacyFileRow[]): Promise<SkillRepositoryFileInput[] | null> {
    const output: SkillRepositoryFileInput[] = []
    for (const file of files) {
      const bytes = await this.readLegacyFileBytes(file)
      if (!bytes) return null
      output.push({
        path: file.path,
        contentBase64: bytes.toString("base64"),
        mimeType: file.mimeType,
      })
    }
    return output
  }

  private async readLegacyFileBytes(file: LegacyFileRow): Promise<Buffer | null> {
    if (file.storageKey) {
      const object = await this.storage.getObjectStream({ key: file.storageKey })
      return readStreamBuffer(object.stream)
    }
    if (file.text !== null) return Buffer.from(file.text, "utf8")
    return null
  }

  private async findAvailableName(ownerUserId: string, title: string): Promise<string> {
    const base = normalizeSkillRepositoryName(slugifyName(title))
    for (let index = 0; index < 100; index += 1) {
      const candidate = index === 0 ? base : `${base}-${index + 1}`
      const existingRepository = await this.prisma.skillRepository.findFirst({
        where: { ownerUserId, name: candidate },
        select: { id: true },
      })
      if (existingRepository) continue
      const existingRedirect = await this.prisma.skillRepositoryNameRedirect.findUnique({
        where: { ownerUserId_oldName: { ownerUserId, oldName: candidate } },
        select: { id: true },
      })
      if (!existingRedirect) return candidate
    }
    return `${base}-${randomUUID().slice(0, 8)}`
  }

  private async cleanupUploadedObjects(storageKeys: readonly string[]): Promise<void> {
    for (const storageKey of storageKeys) {
      try {
        await this.storage.deleteObject(storageKey)
      } catch (error) {
        this.logger.warn("Legacy Skill migration cleanup failed.", { storageKey, error })
      }
    }
  }
}

function slugifyName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  return slug || "skill"
}

function normalizeTitle(value: string): string {
  const title = value.trim()
  return title ? title.slice(0, 160) : "Skill"
}

function normalizeDescription(value: string | null | undefined): string | null {
  const description = value?.trim()
  return description ? description.slice(0, 2000) : null
}
