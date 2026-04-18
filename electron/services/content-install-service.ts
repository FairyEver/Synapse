import { access, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { getContentTypeDefinition } from "../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type {
  SynapseContentInstallResult,
  SynapseInstallToEditorPayload,
} from "../../src/types/editor"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { attachmentsPoolService } from "./attachments-pool-service"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import { editorAdapterService } from "./editor-adapter-service"
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
          await replaceFileAtomically(target.targetPath, file.content)
          break
        }
        case "directory-overwrite": {
          if (target.targetKind !== "directory") {
            throw new Error(`当前编辑器没有返回合法的 ${definition.singularLabel} 安装目标。`)
          }

          const repositoryRootPath = await getActiveRepositoryRootPath()
          const detail = await contentService.getDetail(payload.contentType, payload.contentId)

          await replaceDirectoryAtomically(target.targetPath, async (stagingDirectoryPath) => {
            await writeFile(
              path.join(stagingDirectoryPath, INSTALLED_SKILL_MAIN_FILE_NAME),
              normalizeMarkdownContent(detail.content),
              "utf8",
            )

            for (const attachment of detail.attachments) {
              await attachmentsPoolService.copyAttachmentToPath(
                repositoryRootPath,
                attachment,
                path.join(stagingDirectoryPath, attachment.originalName),
              )
            }
          })
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
}

export const contentInstallService = new ContentInstallService()
