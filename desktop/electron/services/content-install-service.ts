import { rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathExists } from "./fs-utils"
import { getContentTypeDefinition } from "../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type {
  SynapseContentInstallResult,
  SynapseInstallToEditorPayload,
  SynapseReadEditorInstallFormValuesPayload,
  SynapseReadEditorInstallFormValuesResult,
} from "../../src/types/editor"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { attachmentsPoolService } from "./attachments-pool-service"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import { editorAdapterService } from "./editor-adapter-service"
import { editorInstallStrategyById } from "./definitions/generated/main-registry"
import { findSkillDirectoryByContentId } from "./editor-adapters/skill-identity"
import { applyVariableSubstitutions } from "../../src/lib/variable-substitution"
import { builtinContentService } from "./builtin-content-service"
import { createMainLogger } from "./log-store"
import { repositoryStore } from "./repository-store"
import {
  formatEditorWriteFailure,
  readExistingTextFile,
  replaceDirectoryAtomically,
  replaceFileAtomically,
} from "./editor-file-write-utils"

const logger = createMainLogger("service.content-install")

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

function formatInstallFailure(error: unknown, targetPath: string): Error {
  const formatted = formatEditorWriteFailure(error, targetPath)
  return formatted.message === "写入失败，请稍后重试。"
    ? new Error("安装失败，请稍后重试。")
    : formatted
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
          let ruleBody = file.content

          if (payload.variableSubstitutions && Object.keys(payload.variableSubstitutions).length > 0) {
            ruleBody = applyVariableSubstitutions(ruleBody, payload.variableSubstitutions)
          }

          if (payload.contentType === "rule") {
            const installStrategy = editorInstallStrategyById.get(payload.editorId)
            const content = installStrategy
              ? await installStrategy.prepareRuleFileContent({
                  payload,
                  targetPath: target.targetPath,
                  ruleBody,
                  readExistingTextFile,
                })
              : ruleBody
            await replaceFileAtomically(target.targetPath, content)
          } else {
            await replaceFileAtomically(target.targetPath, ruleBody)
          }

          break
        }
        case "directory-overwrite": {
          if (target.targetKind !== "directory") {
            throw new Error(`当前编辑器没有返回合法的 ${definition.singularLabel} 安装目标。`)
          }

          if (payload.contentType !== "skill") {
            throw new Error(`当前编辑器没有提供 ${definition.singularLabel} 安装策略。`)
          }

          const installStrategy = editorInstallStrategyById.get(payload.editorId)

          if (!installStrategy?.prepareSkillDirectory) {
            throw new Error(`当前编辑器没有提供 ${definition.singularLabel} 安装策略。`)
          }

          const prepareSkillDirectory = installStrategy.prepareSkillDirectory
          const detail = await contentService.getSkillDetail(payload.contentId)
          const repositoryRootPath = detail.source === "builtin" ? null : await getActiveRepositoryRootPath()
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

          const detailWithSubstitutions = payload.variableSubstitutions && Object.keys(payload.variableSubstitutions).length > 0
            ? {
                ...detail,
                content: applyVariableSubstitutions(detail.content, payload.variableSubstitutions),
              }
            : detail

          await replaceDirectoryAtomically(target.targetPath, async (stagingDirectoryPath) => {
            await prepareSkillDirectory({
              payload,
              targetPath: target.targetPath,
              stagingDirectoryPath,
              detail: detailWithSubstitutions,
              repositoryRootPath: repositoryRootPath ?? "",
              writeTextFile: async (filePath, content) => {
                await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8")
                logger.info("Staged skill file.", { filePath })
              },
              copyAttachment: async (attachment, attachmentTargetPath) => {
                if (detail.source === "builtin") {
                  await builtinContentService.copyAttachmentToPath(
                    payload.contentType,
                    payload.contentId,
                    attachment,
                    attachmentTargetPath,
                  )
                } else {
                  if (!repositoryRootPath) {
                    throw new Error("当前还没有激活的本地目录。")
                  }

                  await attachmentsPoolService.copyAttachmentToPath(
                    repositoryRootPath,
                    attachment,
                    attachmentTargetPath,
                  )
                }
                logger.info("Staged skill attachment.", {
                  filePath: attachmentTargetPath,
                  originalName: attachment.originalName,
                })
              },
            })
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

  async readEditorInstallFormValues(
    payload: SynapseReadEditorInstallFormValuesPayload,
  ): Promise<SynapseReadEditorInstallFormValuesResult> {
    const installStrategy = editorInstallStrategyById.get(payload.editorId)

    if (!installStrategy?.readRuleProjectFormValues) {
      return { values: null }
    }

    const values = await installStrategy.readRuleProjectFormValues({
      targetPath: payload.targetPath,
      readExistingTextFile,
    })

    return { values }
  }
}

export const contentInstallService = new ContentInstallService()
