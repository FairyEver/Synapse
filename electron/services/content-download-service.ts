import { spawn } from "node:child_process"
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { attachmentsPoolService } from "./attachments-pool-service"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import { createMainLogger } from "./log-store"

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
    const repository = await getActiveRepository()
    const detail = await contentService.getSkillDetail(skillId)

    await withTemporaryOutput(".zip", async (tempPath) => {
      const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-export-"))
      const stagingDirectoryPath = path.join(stagingRoot, skillId)

      try {
        await mkdir(stagingDirectoryPath, { recursive: true })
        await writeFile(path.join(stagingDirectoryPath, "main.md"), `${detail.content}\n`, "utf8")

        for (const attachment of detail.attachments) {
          await attachmentsPoolService.copyAttachmentToPath(
            repository.localPath,
            attachment,
            path.join(stagingDirectoryPath, attachment.originalName),
          )
        }

        await createSkillArchive(stagingDirectoryPath, tempPath)
        await copyFile(tempPath, targetPath)
      } finally {
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
      }
    })

    logger.info("Skill download export completed.", {
      skillId,
      targetPath,
    })
  }
}

export const contentDownloadService = new ContentDownloadService()
