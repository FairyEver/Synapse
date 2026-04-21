import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { getContentTypeDefinition } from "../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type {
  SynapseContentInstallResult,
  SynapseInstallToEditorPayload,
  SynapsePeekCursorFrontmatterPayload,
  SynapsePeekCursorFrontmatterResult,
} from "../../src/types/editor"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { attachmentsPoolService } from "./attachments-pool-service"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import { editorAdapterService } from "./editor-adapter-service"
import { parseMdcFrontmatter, serializeMdcFrontmatter } from "./editor-adapters/cursor-mdc"
import { applyRuleSection } from "./editor-adapters/rule-section"
import {
  SYNAPSE_SKILL_ID_FILE_NAME,
  findSkillDirectoryByContentId,
} from "./editor-adapters/skill-identity"
import { serializeSkillFrontmatter } from "./editor-adapters/skill-frontmatter"
import { createMainLogger } from "./log-store"
import { repositoryStore } from "./repository-store"

const INSTALLED_SKILL_MAIN_FILE_NAME = "SKILL.md"
const logger = createMainLogger("service.content-install")

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error.code === "EACCES" || error.code === "EPERM")
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
      await rename(backupPath, targetPath).catch((err) => logger.warn("Failed to restore backup", err))
    }

    throw error
  } finally {
    if (movedExistingTarget && movedReplacement) {
      await rm(backupPath, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean up backup", err))
    }
  }
}

async function readExistingTextFile(targetPath: string): Promise<string> {
  try {
    return await readFile(targetPath, "utf8")
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return ""
    }

    throw error
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
    logger.info("Wrote file atomically.", { targetPath })
  } finally {
    await rm(tempDirectoryPath, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean up temp directory", err))
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
    await rm(stagingDirectoryPath, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean up staging directory", err))
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
    const definition = getContentTypeDefinition(payload.contentType)

    if (target.status !== "ready") {
      throw new Error(target.message ?? "当前编辑器暂时不能安装到这个位置。")
    }

    try {
      switch (definition.install.kind) {
        case "none":
          throw new Error(`${definition.singularLabel} 不支持安装到编辑器。`)
        case "single-file": {
          if (target.targetKind !== "file") {
            throw new Error(`当前编辑器没有返回合法的 ${definition.singularLabel} 安装目标。`)
          }

          const file = await contentService.getContent(payload.contentType, payload.contentId)
          const ruleBody = file.content

          if (
            payload.editorId === "cursor"
            && payload.contentType === "rule"
          ) {
            const wrapped = payload.cursorFrontmatter
              ? serializeMdcFrontmatter(payload.cursorFrontmatter) + ruleBody
              : ruleBody
            await replaceFileAtomically(target.targetPath, wrapped)
          } else if (
            payload.contentType === "rule"
            && (payload.editorId === "claude-code" || payload.editorId === "codex")
          ) {
            const existing = await readExistingTextFile(target.targetPath)
            const merged = applyRuleSection(existing, payload.contentId, ruleBody)
            await replaceFileAtomically(target.targetPath, merged)
          } else {
            await replaceFileAtomically(target.targetPath, ruleBody)
          }

          break
        }
        case "directory-overwrite": {
          if (target.targetKind !== "directory") {
            throw new Error(`当前编辑器没有返回合法的 ${definition.singularLabel} 安装目标。`)
          }

          const repositoryRootPath = await getActiveRepositoryRootPath()
          const detail = await contentService.getDetail(payload.contentType, payload.contentId)
          const parentDirectoryPath = path.dirname(target.targetPath)
          const previousSkillDirectoryPath = payload.contentType === "skill"
            ? await findSkillDirectoryByContentId(parentDirectoryPath, payload.contentId)
            : null

          // Handle Skill replacement: backup existing directory if replace confirmed
          if (payload.contentType === "skill" && payload.replaceConfirmed) {
            const targetExists = await pathExists(target.targetPath)
            if (targetExists && target.targetPath !== previousSkillDirectoryPath) {
              const backupPath = `${target.targetPath}-backup`
              await rename(target.targetPath, backupPath).catch((err) => {
                logger.warn("Failed to backup existing skill directory", { targetPath: target.targetPath, error: err })
              })
            }
          }

          const skillMainContent = payload.contentType === "skill"
            ? serializeSkillFrontmatter({
                description: detail.description,
                name: path.basename(target.targetPath),
              }) + detail.content
            : detail.content

          await replaceDirectoryAtomically(target.targetPath, async (stagingDirectoryPath) => {
            const skillMainFilePath = path.join(stagingDirectoryPath, INSTALLED_SKILL_MAIN_FILE_NAME)
            await writeFile(
              skillMainFilePath,
              normalizeMarkdownContent(skillMainContent),
              "utf8",
            )
            logger.info("Staged skill main file.", { filePath: skillMainFilePath })

            if (payload.contentType === "skill") {
              const meta = { id: payload.contentId }
              const idFilePath = path.join(stagingDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME)
              await writeFile(
                idFilePath,
                JSON.stringify(meta, null, 2),
                "utf8",
              )
              logger.info("Staged skill identity file.", { filePath: idFilePath })
            }

            for (const attachment of detail.attachments) {
              const attachmentTargetPath = path.join(stagingDirectoryPath, attachment.originalName)
              await attachmentsPoolService.copyAttachmentToPath(
                repositoryRootPath,
                attachment,
                attachmentTargetPath,
              )
              logger.info("Staged skill attachment.", { filePath: attachmentTargetPath, originalName: attachment.originalName })
            }
          })

          if (
            previousSkillDirectoryPath
            && previousSkillDirectoryPath !== target.targetPath
          ) {
            await rm(previousSkillDirectoryPath, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean up previous skill directory", err))
          }

          break
        }
        default:
          throw new Error(`不支持 ${definition.singularLabel} 的安装方式。`)
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

  async peekCursorFrontmatter(
    payload: SynapsePeekCursorFrontmatterPayload,
  ): Promise<SynapsePeekCursorFrontmatterResult> {
    try {
      const existing = await readFile(payload.targetPath, "utf8")
      return { frontmatter: parseMdcFrontmatter(existing) }
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return { frontmatter: null }
      }

      throw error
    }
  }
}

export const contentInstallService = new ContentInstallService()
