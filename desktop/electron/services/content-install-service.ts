import { rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathExists } from "./fs-utils"
import { getContentTypeDefinition } from "../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
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

type EditorWriteSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

async function checkEditorWritePermission(
  deps: EditorWriteSecurityDeps | undefined,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps) return
  const permission = await deps.permissionGuard.check({
    action: "fs.write",
    actor: deps.actor,
    context: metadata,
    resource,
  })
  if (!permission.allowed) {
    deps.auditSink.record({
      action: "fs.write",
      actor: deps.actor,
      metadata,
      outcome: "denied",
      resource,
    })
    throw new Error("没有写入该位置的权限。")
  }
}

function recordEditorWriteAudit(
  deps: EditorWriteSecurityDeps | undefined,
  resource: string,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): void {
  deps?.auditSink.record({
    action: "fs.write",
    actor: deps.actor,
    metadata,
    outcome,
    resource,
  })
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

function formatInstallFailure(error: unknown, targetPath: string): Error {
  const formatted = formatEditorWriteFailure(error, targetPath)
  return formatted.message === "写入失败，请稍后重试。"
    ? new Error("安装失败，请稍后重试。")
    : formatted
}

export class ContentInstallService {
  async installToEditor(
    payload: SynapseInstallToEditorPayload,
    security?: EditorWriteSecurityDeps,
  ): Promise<SynapseContentInstallResult> {
    const target = await editorAdapterService.resolveTarget(payload)
    const definition = getContentTypeDefinition(payload.contentType)

    const isConfirmedConflict = target.status === "conflict" && payload.replaceConfirmed

    if (target.status !== "ready" && !isConfirmedConflict) {
      throw new Error(target.message ?? "当前编辑器暂时不能安装到这个位置。")
    }

    const auditMetadata = {
      contentId: payload.contentId,
      contentType: payload.contentType,
      editorId: payload.editorId,
      operation: "install",
      scope: payload.scope,
    }

    await checkEditorWritePermission(security, target.targetPath, auditMetadata)

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
          let backupPathForRestore: string | null = null
          const previousSkillDirectoryPath = payload.contentType === "skill"
            ? await findSkillDirectoryByContentId(parentDirectoryPath, payload.contentId)
            : null

          // Handle Skill replacement: backup existing directory if replace confirmed
          if (payload.contentType === "skill" && payload.replaceConfirmed) {
            const targetExists = await pathExists(target.targetPath)
            if (targetExists && target.targetPath !== previousSkillDirectoryPath) {
              const backupPath = `${target.targetPath}-backup`
              try {
                await rename(target.targetPath, backupPath)
                backupPathForRestore = backupPath
              } catch (error) {
                logger.warn("Failed to backup existing skill directory", { targetPath: target.targetPath, error })
                throw new Error("备份旧 Skill 失败，未替换目标。")
              }
            }
          }

          const detailWithSubstitutions = payload.variableSubstitutions && Object.keys(payload.variableSubstitutions).length > 0
            ? {
                ...detail,
                content: applyVariableSubstitutions(detail.content, payload.variableSubstitutions),
              }
            : detail

          try {
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
          } catch (error) {
            if (backupPathForRestore && await pathExists(backupPathForRestore)) {
              try {
                await rm(target.targetPath, { recursive: true, force: true })
                await rename(backupPathForRestore, target.targetPath)
              } catch (restoreError) {
                logger.warn("Failed to restore backed up skill directory", {
                  backupPath: backupPathForRestore,
                  targetPath: target.targetPath,
                  error: restoreError,
                })
              }
            }

            throw error
          }

          if (
            previousSkillDirectoryPath
            && previousSkillDirectoryPath !== target.targetPath
          ) {
            await rm(previousSkillDirectoryPath, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean up previous skill directory", err))
          }

          if (backupPathForRestore) {
            await rm(backupPathForRestore, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean up conflict backup directory", err))
          }

          break
        }
        default:
          throw new Error(`不支持 ${definition.singularLabel} 的安装方式。`)
      }
    } catch (error) {
      recordEditorWriteAudit(security, target.targetPath, "failed", auditMetadata)
      throw formatInstallFailure(error, target.targetPath)
    }

    recordEditorWriteAudit(security, target.targetPath, "allowed", auditMetadata)

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
