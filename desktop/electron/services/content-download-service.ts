import { randomBytes } from "node:crypto"
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createZipArchive } from "../runtime/archive"
import type { ZipArchiveOptions } from "../runtime/archive"
import { getContentTypeDefinition } from "../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import {
  assertUniqueContentAttachmentPaths,
  normalizeContentAttachmentPath,
} from "../../src/lib/content-attachments"
import type { SynapseContentType } from "../../src/types/content"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { attachmentsPoolService } from "./attachments-pool-service"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import { createMainLogger } from "./log-store"
import { repositoryStore } from "./repository-store"

const logger = createMainLogger("service.content-download")
type ContentDownloadArchiveOptions = Pick<ZipArchiveOptions, "actor" | "processRunner">
const ATOMIC_TARGET_TEMP_SUFFIX_BYTES = 8

async function getActiveRepository(): Promise<SynapseRepositoryConfig> {
  const config = await configStore.load()
  const repository = getActiveRepositoryConfig(config)

  if (!repository) {
    throw new Error("当前还没有选中的本地目录。")
  }

  return repository
}

async function getActiveRepositoryRootPath(): Promise<string> {
  const repository = await getActiveRepository()
  const repositoryState = await repositoryStore.getRepositoryState(repository)

  return repositoryState.gitRootPath ?? repository.localPath
}

async function createSkillArchive(
  sourceDirectoryPath: string,
  outputFilePath: string,
  archiveOptions?: ContentDownloadArchiveOptions,
): Promise<void> {
  await createZipArchive(sourceDirectoryPath, outputFilePath, {
    ...archiveOptions,
    messages: {
      missingTool: "当前系统缺少导出 Skill 压缩包所需的工具，暂时不能下载 Skill。",
      startFailed: "启动导出命令失败。",
      failed: "导出 Skill 压缩包失败，请稍后重试。",
    },
  })
}

async function withTemporaryOutput<T>(
  extension: string,
  writeOutput: (outputPath: string) => Promise<T>,
): Promise<T> {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "synapse-download-"))
  const outputPath = path.join(tempDirectoryPath, `download${extension}`)

  try {
    return await writeOutput(outputPath)
  } finally {
    await rm(tempDirectoryPath, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean up temp directory", err))
  }
}

async function copyFileToTargetAtomically(sourcePath: string, targetPath: string): Promise<void> {
  const targetDirectoryPath = path.dirname(targetPath)
  const targetName = path.basename(targetPath)
  const temporaryTargetPath = path.join(
    targetDirectoryPath,
    `.${targetName}.tmp-${randomBytes(ATOMIC_TARGET_TEMP_SUFFIX_BYTES).toString("hex")}`,
  )

  await mkdir(targetDirectoryPath, { recursive: true })

  try {
    await copyFile(sourcePath, temporaryTargetPath)
    await rename(temporaryTargetPath, targetPath)
  } catch (err) {
    await rm(temporaryTargetPath, { force: true })
      .catch((cleanupError) => logger.warn("Failed to clean up target temp file", cleanupError))
    throw err
  }
}

class ContentDownloadService {
  async download(
    contentType: SynapseContentType,
    id: string,
    targetPath: string,
    archiveOptions?: ContentDownloadArchiveOptions,
  ): Promise<void> {
    const definition = getContentTypeDefinition(contentType)

    switch (definition.download.exporter) {
      case "text-file":
        return this.exportAsTextFile(contentType, id, targetPath)
      case "zip-archive":
        return this.exportAsZipArchive(contentType, id, targetPath, archiveOptions)
      default:
        throw new Error(`不支持 ${definition.singularLabel} 的下载方式。`)
    }
  }

  async downloadRule(ruleId: string, targetPath: string): Promise<void> {
    return this.download("rule", ruleId, targetPath)
  }

  async downloadSkill(
    skillId: string,
    targetPath: string,
    archiveOptions?: ContentDownloadArchiveOptions,
  ): Promise<void> {
    return this.download("skill", skillId, targetPath, archiveOptions)
  }

  private async exportAsTextFile(
    contentType: SynapseContentType,
    id: string,
    targetPath: string,
  ): Promise<void> {
    const file = await contentService.getContent(contentType, id)
    const definition = getContentTypeDefinition(contentType)

    await withTemporaryOutput(definition.download.extension, async (tempPath) => {
      await writeFile(tempPath, file.content, "utf8")
      logger.info("Wrote text content to temp file.", { tempPath: path.basename(tempPath) })
      await copyFileToTargetAtomically(tempPath, targetPath)
      logger.info("Replaced text content target.", { targetPath: path.basename(targetPath) })
    })

    logger.info("Text content download export completed.", {
      contentType,
      id,
      targetPath: path.basename(targetPath),
    })
  }

  private async exportAsZipArchive(
    contentType: SynapseContentType,
    id: string,
    targetPath: string,
    archiveOptions?: ContentDownloadArchiveOptions,
  ): Promise<void> {
    const detail = await contentService.getDetail(contentType, id)
    const repositoryRootPath = await getActiveRepositoryRootPath()

    await withTemporaryOutput(".zip", async (tempPath) => {
      const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-export-"))
      const stagingDirectoryPath = path.join(stagingRoot, id)

      try {
        await mkdir(stagingDirectoryPath, { recursive: true })
        logger.info("Created staging directory for zip export.", { stagingDirectoryPath: path.basename(stagingDirectoryPath) })

        const mainFilePath = path.join(stagingDirectoryPath, "SKILL.md")
        await writeFile(mainFilePath, `${detail.content}\n`, "utf8")
        logger.info("Wrote main content to staging.", { filePath: path.basename(mainFilePath) })

        assertUniqueContentAttachmentPaths(detail.attachments.map((attachment) => attachment.originalName))

        for (const attachment of detail.attachments) {
          const originalName = normalizeContentAttachmentPath(attachment.originalName)
          if (!originalName) {
            throw new Error("附件文件名不能为空。")
          }

          const attachmentTargetPath = path.join(stagingDirectoryPath, originalName)
          const copied = await attachmentsPoolService.copyAttachmentToPath(
            repositoryRootPath,
            { ...attachment, originalName },
            attachmentTargetPath,
          )

          if (!copied) {
            throw new Error(`Skill 附件复制失败：${originalName}`)
          }
        }

        await createSkillArchive(stagingDirectoryPath, tempPath, archiveOptions)
        logger.info("Created skill archive.", { tempPath: path.basename(tempPath) })
        await copyFileToTargetAtomically(tempPath, targetPath)
        logger.info("Replaced archive target.", { targetPath: path.basename(targetPath) })
      } finally {
        await rm(stagingRoot, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean up staging root", err))
      }
    })

    logger.info("Archive content download export completed.", {
      contentType,
      id,
      targetPath: path.basename(targetPath),
    })
  }
}

export const contentDownloadService = new ContentDownloadService()
