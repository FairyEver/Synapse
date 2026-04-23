import { spawn } from "node:child_process"
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { getContentTypeDefinition } from "../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { SynapseContentType } from "../../src/types/content"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { attachmentsPoolService } from "./attachments-pool-service"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import { createMainLogger } from "./log-store"
import { repositoryStore } from "./repository-store"

const logger = createMainLogger("service.content-download")

function formatArchiveSpawnError(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "当前系统缺少导出 Skill 压缩包所需的工具，暂时不能下载 Skill。"
  }

  return error instanceof Error ? error.message : "启动导出命令失败。"
}

function formatArchiveFailureMessage(output: string): string {
  const fallbackMessage = "导出 Skill 压缩包失败，请稍后重试。"
  const firstLine = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return firstLine ? `${fallbackMessage}\n${firstLine}` : fallbackMessage
}

async function getActiveRepository(): Promise<SynapseRepositoryConfig> {
  const config = await configStore.load()
  const repository = getActiveRepositoryConfig(config)

  if (!repository) {
    throw new Error("当前还没有激活的本地目录。")
  }

  return repository
}

async function getActiveRepositoryRootPath(): Promise<string> {
  const repository = await getActiveRepository()
  const repositoryState = await repositoryStore.getRepositoryState(repository)

  return repositoryState.gitRootPath ?? repository.localPath
}

function escapePowerShellSingleQuotedString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function runArchiveCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd: options?.cwd,
      env: {
        ...process.env,
      },
    })

    let stdout = ""
    let stderr = ""

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    childProcess.on("error", (error) => {
      reject(new Error(formatArchiveSpawnError(error)))
    })

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(formatArchiveFailureMessage(`${stdout}\n${stderr}`)))
    })
  })
}

async function createSkillArchive(sourceDirectoryPath: string, outputFilePath: string): Promise<void> {
  if (process.platform === "win32") {
    const script = [
      "Compress-Archive",
      "-LiteralPath",
      escapePowerShellSingleQuotedString(sourceDirectoryPath),
      "-DestinationPath",
      escapePowerShellSingleQuotedString(outputFilePath),
      "-CompressionLevel",
      "Optimal",
      "-Force",
    ].join(" ")

    await runArchiveCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ])
    return
  }

  if (process.platform === "darwin") {
    await runArchiveCommand("ditto", [
      "-c",
      "-k",
      "--keepParent",
      sourceDirectoryPath,
      outputFilePath,
    ])
    return
  }

  await runArchiveCommand(
    "zip",
    ["-r", "-q", outputFilePath, path.basename(sourceDirectoryPath)],
    { cwd: path.dirname(sourceDirectoryPath) },
  )
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

class ContentDownloadService {
  async download(contentType: SynapseContentType, id: string, targetPath: string): Promise<void> {
    const definition = getContentTypeDefinition(contentType)

    switch (definition.download.exporter) {
      case "text-file":
        return this.exportAsTextFile(contentType, id, targetPath)
      case "zip-archive":
        return this.exportAsZipArchive(contentType, id, targetPath)
      default:
        throw new Error(`不支持 ${definition.singularLabel} 的下载方式。`)
    }
  }

  async downloadRule(ruleId: string, targetPath: string): Promise<void> {
    return this.download("rule", ruleId, targetPath)
  }

  async downloadSkill(skillId: string, targetPath: string): Promise<void> {
    return this.download("skill", skillId, targetPath)
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
      logger.info("Wrote text content to temp file.", { tempPath })
      await copyFile(tempPath, targetPath)
      logger.info("Copied text content to target.", { targetPath })
    })

    logger.info("Text content download export completed.", {
      contentType,
      id,
      targetPath,
    })
  }

  private async exportAsZipArchive(
    contentType: SynapseContentType,
    id: string,
    targetPath: string,
  ): Promise<void> {
    const repositoryRootPath = await getActiveRepositoryRootPath()
    const detail = await contentService.getDetail(contentType, id)

    await withTemporaryOutput(".zip", async (tempPath) => {
      const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-export-"))
      const stagingDirectoryPath = path.join(stagingRoot, id)

      try {
        await mkdir(stagingDirectoryPath, { recursive: true })
        logger.info("Created staging directory for zip export.", { stagingDirectoryPath })

        const mainFilePath = path.join(stagingDirectoryPath, "main.md")
        await writeFile(mainFilePath, `${detail.content}\n`, "utf8")
        logger.info("Wrote main content to staging.", { filePath: mainFilePath })

        for (const attachment of detail.attachments) {
          const attachmentTargetPath = path.join(stagingDirectoryPath, attachment.originalName)
          await attachmentsPoolService.copyAttachmentToPath(
            repositoryRootPath,
            attachment,
            attachmentTargetPath,
          )
        }

        await createSkillArchive(stagingDirectoryPath, tempPath)
        logger.info("Created skill archive.", { tempPath })
        await copyFile(tempPath, targetPath)
        logger.info("Copied archive to target.", { targetPath })
      } finally {
        await rm(stagingRoot, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean up staging root", err))
      }
    })

    logger.info("Archive content download export completed.", {
      contentType,
      id,
      targetPath,
    })
  }
}

export const contentDownloadService = new ContentDownloadService()
