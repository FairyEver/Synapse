import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { SynapseContentType } from "../../src/types/content"
import type {
  SynapseContentInstallResult,
  SynapseInstallToEditorPayload,
} from "../../src/types/editor"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import { editorAdapterService } from "./editor-adapter-service"
import { createMainLogger } from "./log-store"

const CONTENT_MAIN_FILE_NAME = "main.md"
const CONTENT_META_FILE_NAME = "meta.json"
const INSTALLED_SKILL_MAIN_FILE_NAME = "SKILL.md"
const logger = createMainLogger("service.content-install")

type ActiveRepositoryInstallContext = {
  repository: SynapseRepositoryConfig
  rootPath: string
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error.code === "EACCES" || error.code === "EPERM")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function normalizeMarkdownContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`
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

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    return await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return []
    }

    logger.warn("Failed to read content directory while installing content.", {
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
      logger.warn("Failed to read content meta while locating install source.", {
        directoryPath,
        error,
      })
    }

    return null
  }
}

async function getActiveRepositoryContext(
  contentType: SynapseContentType,
): Promise<ActiveRepositoryInstallContext | null> {
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

async function swapPathAtomically(replacementPath: string, targetPath: string): Promise<void> {
  const parentDirectoryPath = path.dirname(targetPath)
  const targetName = path.basename(targetPath)

  await mkdir(parentDirectoryPath, { recursive: true })

  const backupPath = path.join(
    parentDirectoryPath,
    `.synapse-install-backup-${targetName}-${Date.now()}`,
  )
  const hadExistingTarget = await pathExists(targetPath)
  let movedExistingTarget = false
  let movedReplacement = false

  try {
    if (hadExistingTarget) {
      await rename(targetPath, backupPath)
      movedExistingTarget = true
    }

    await rename(replacementPath, targetPath)
    movedReplacement = true
  } catch (error) {
    if (movedExistingTarget && !movedReplacement) {
      await rename(backupPath, targetPath).catch(() => {})
    }

    throw error
  } finally {
    if (movedExistingTarget && movedReplacement) {
      await rm(backupPath, { recursive: true, force: true }).catch(() => {})
    }
  }
}

async function replaceFileAtomically(targetPath: string, content: string): Promise<void> {
  const parentDirectoryPath = path.dirname(targetPath)

  await mkdir(parentDirectoryPath, { recursive: true })

  const tempDirectoryPath = await mkdtemp(path.join(parentDirectoryPath, ".synapse-install-file-"))
  const tempFilePath = path.join(tempDirectoryPath, path.basename(targetPath))

  try {
    await writeFile(tempFilePath, normalizeMarkdownContent(content), "utf8")
    await swapPathAtomically(tempFilePath, targetPath)
  } finally {
    await rm(tempDirectoryPath, { recursive: true, force: true }).catch(() => {})
  }
}

async function copySkillInstallFiles(sourceDirectoryPath: string, targetDirectoryPath: string): Promise<void> {
  const entries = await readdir(sourceDirectoryPath, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectoryPath, entry.name)

    if (entry.isDirectory()) {
      const nextTargetPath = path.join(targetDirectoryPath, entry.name)

      await mkdir(nextTargetPath, { recursive: true })
      await copySkillInstallFiles(sourcePath, nextTargetPath)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    if (entry.name === CONTENT_META_FILE_NAME) {
      continue
    }

    if (entry.name === CONTENT_MAIN_FILE_NAME) {
      const skillContent = await readFile(sourcePath, "utf8")

      await writeFile(
        path.join(targetDirectoryPath, INSTALLED_SKILL_MAIN_FILE_NAME),
        normalizeMarkdownContent(skillContent),
        "utf8",
      )
      continue
    }

    await copyFile(sourcePath, path.join(targetDirectoryPath, entry.name))
  }
}

async function replaceDirectoryAtomically(
  targetPath: string,
  populate: (stagingDirectoryPath: string) => Promise<void>,
): Promise<void> {
  const parentDirectoryPath = path.dirname(targetPath)

  await mkdir(parentDirectoryPath, { recursive: true })

  const stagingDirectoryPath = await mkdtemp(path.join(parentDirectoryPath, ".synapse-install-dir-"))

  try {
    await populate(stagingDirectoryPath)
    await swapPathAtomically(stagingDirectoryPath, targetPath)
  } catch (error) {
    await rm(stagingDirectoryPath, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

function formatInstallFailure(error: unknown, targetPath: string): Error {
  if (isPermissionError(error)) {
    return new Error(`目标位置不可写：${targetPath}`)
  }

  if (error instanceof Error) {
    return error
  }

  return new Error("安装失败，请稍后重试。")
}

class ContentInstallService {
  async installToEditor(
    payload: SynapseInstallToEditorPayload,
  ): Promise<SynapseContentInstallResult> {
    const target = await editorAdapterService.resolveTarget(payload)

    if (target.status !== "ready") {
      throw new Error(target.message ?? "当前编辑器暂时不能安装到这个位置。")
    }

    try {
      if (payload.contentType === "rule") {
        if (target.targetKind !== "file") {
          throw new Error("当前编辑器没有返回合法的 Rule 安装目标。")
        }

        const file = await contentService.getRuleContent(payload.contentId)

        await replaceFileAtomically(target.targetPath, file.content)
      } else {
        if (target.targetKind !== "directory") {
          throw new Error("当前编辑器没有返回合法的 Skill 安装目标。")
        }

        const sourceDirectoryPath = await resolveActiveContentDirectory("skill", payload.contentId)

        await replaceDirectoryAtomically(target.targetPath, async (stagingDirectoryPath) => {
          await copySkillInstallFiles(sourceDirectoryPath, stagingDirectoryPath)
        })
      }
    } catch (error) {
      throw formatInstallFailure(error, target.targetPath)
    }

    logger.info("Content installed to editor target.", {
      contentId: payload.contentId,
      contentType: payload.contentType,
      editorId: payload.editorId,
      scope: payload.scope,
      targetKind: target.targetKind,
      targetPath: target.targetPath,
    })

    return {
      editorId: target.editorId,
      label: target.label,
      scope: target.scope,
      contentType: target.contentType,
      contentId: payload.contentId,
      targetKind: target.targetKind,
      targetPath: target.targetPath,
    }
  }
}

export const contentInstallService = new ContentInstallService()
