import { spawn } from "node:child_process"
import { access, copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import type { Dirent } from "node:fs"
import os from "node:os"
import path from "node:path"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { SynapseContentType } from "../../src/types/content"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import { createMainLogger } from "./log-store"

const CONTENT_META_FILE_NAME = "meta.json"
const logger = createMainLogger("service.content-download")

type ActiveRepositoryDownloadContext = {
  repository: SynapseRepositoryConfig
  rootPath: string
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false
    }

    return false
  }
}

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

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    return await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return []
    }

    logger.warn("Failed to read content directory while preparing download.", {
      directoryPath,
      error,
    })

    return []
  }
}

async function readMetaId(directoryPath: string): Promise<string | null> {
  const metaPath = path.join(directoryPath, CONTENT_META_FILE_NAME)

  try {
    const rawMeta = JSON.parse(await readFile(metaPath, "utf8")) as unknown

    if (!isRecord(rawMeta) || !isNonEmptyString(rawMeta.id)) {
      return null
    }

    return rawMeta.id.trim()
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      logger.warn("Failed to read content meta while locating download source.", {
        directoryPath,
        error,
      })
    }

    return null
  }
}

async function getActiveRepositoryContext(
  contentType: SynapseContentType,
): Promise<ActiveRepositoryDownloadContext | null> {
  const config = await configStore.load()
  const repository = getActiveRepositoryConfig(config)

  if (!repository) {
    return null
  }

  return {
    repository,
    rootPath: path.join(
      repository.localPath,
      contentType === "rule" ? repository.rulesDir : repository.skillsDir,
    ),
  }
}

async function resolveContentDirectory(
  repository: SynapseRepositoryConfig,
  contentType: SynapseContentType,
  contentId: string,
): Promise<string | null> {
  const rootPath = path.join(
    repository.localPath,
    contentType === "rule" ? repository.rulesDir : repository.skillsDir,
  )
  const directPath = path.join(rootPath, contentId)

  if (await pathExists(directPath)) {
    return directPath
  }

  const entries = await readDirectoryEntries(rootPath)

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const directoryPath = path.join(rootPath, entry.name)
    const metaId = await readMetaId(directoryPath)

    if (metaId === contentId) {
      return directoryPath
    }
  }

  return null
}

async function resolveActiveContentDirectory(
  contentType: SynapseContentType,
  contentId: string,
): Promise<string> {
  const context = await getActiveRepositoryContext(contentType)

  if (!context) {
    throw new Error("当前还没有激活的本地目录。")
  }

  const directoryPath = await resolveContentDirectory(context.repository, contentType, contentId)

  if (directoryPath) {
    return directoryPath
  }

  throw new Error(contentType === "rule" ? "找不到对应的 Rule 内容。" : "找不到对应的 Skill 内容。")
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
    await rm(tempDirectoryPath, { recursive: true, force: true }).catch(() => {})
  }
}

class ContentDownloadService {
  async downloadRule(ruleId: string, targetPath: string): Promise<void> {
    const file = await contentService.getRuleContent(ruleId)

    await withTemporaryOutput(".md", async (tempPath) => {
      await writeFile(tempPath, file.content, "utf8")
      await copyFile(tempPath, targetPath)
    })

    logger.info("Rule download export completed.", {
      ruleId,
      targetPath,
    })
  }

  async downloadSkill(skillId: string, targetPath: string): Promise<void> {
    const sourceDirectoryPath = await resolveActiveContentDirectory("skill", skillId)

    await withTemporaryOutput(".zip", async (tempPath) => {
      await createSkillArchive(sourceDirectoryPath, tempPath)
      await copyFile(tempPath, targetPath)
    })

    logger.info("Skill download export completed.", {
      skillId,
      sourceDirectoryPath,
      targetPath,
    })
  }
}

export const contentDownloadService = new ContentDownloadService()
