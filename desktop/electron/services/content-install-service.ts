import { rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathExists } from "./fs-utils"
import { getContentTypeDefinition } from "../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import { arePathsEqualForCompare } from "../../src/lib/path-compare"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import type {
  SynapseContentInstallResult,
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
  SynapseReadEditorInstallFormValuesPayload,
  SynapseReadEditorInstallFormValuesResult,
  SynapseResolveEditorTargetPayload,
} from "../../src/types/editor"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { attachmentsPoolService } from "./attachments-pool-service"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import { editorAdapterService } from "./editor-adapter-service"
import { editorAdapterById } from "./editor-adapters"
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

type EditorReadSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

const UNTRUSTED_PROJECT_PATH_ERROR = "项目路径不在已配置项目中。"
const UNTRUSTED_INSTALL_TARGET_ERROR = "安装目标不在已配置编辑器路径中。"

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

async function checkEditorReadPermission(
  deps: EditorReadSecurityDeps | undefined,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps) return
  const permission = await deps.permissionGuard.check({
    action: "fs.read.outside-userdata",
    actor: deps.actor,
    context: metadata,
    resource,
  })
  if (!permission.allowed) {
    deps.auditSink.record({
      action: "fs.read.outside-userdata",
      actor: deps.actor,
      metadata: {
        ...metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
      outcome: "denied",
      resource,
    })
    throw new Error(permission.reason)
  }
}

function recordEditorReadAudit(
  deps: EditorReadSecurityDeps | undefined,
  resource: string,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): void {
  deps?.auditSink.record({
    action: "fs.read.outside-userdata",
    actor: deps.actor,
    metadata,
    outcome,
    resource,
  })
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

function isSamePath(left: string, right: string): boolean {
  return arePathsEqualForCompare(left, right, {
    platform: process.platform,
    resolvePath: path.resolve,
  })
}

function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(targetPath))
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function assertConfiguredProjectPath(
  payload: SynapseResolveEditorTargetPayload,
): Promise<void> {
  if (payload.scope !== "project") return
  if (!payload.projectPath?.trim()) {
    throw new Error("项目路径为空，无法解析项目安装位置。")
  }

  const config = await configStore.load()
  const isConfigured = config.global.projects.some((project) => isSamePath(project.path, payload.projectPath ?? ""))
  if (!isConfigured) {
    throw new Error(UNTRUSTED_PROJECT_PATH_ERROR)
  }
}

async function getTrustedRuleDirectories(editorId: string): Promise<string[]> {
  const adapter = editorAdapterById.get(editorId)
  if (!adapter) return []

  const directories: string[] = []
  const globalRulesPath = adapter.resolveGlobalDirectoryPaths().rulesPath
  if (globalRulesPath) directories.push(globalRulesPath)

  const config = await configStore.load()
  const scanConfig = adapter.getScanPathConfig()
  for (const project of config.global.projects) {
    directories.push(scanConfig.projectPaths(project.path).rulesPath)
  }

  return Array.from(new Set(directories))
}

async function assertTrustedInstallFormTarget(
  payload: SynapseReadEditorInstallFormValuesPayload,
): Promise<void> {
  const directories = await getTrustedRuleDirectories(payload.editorId)
  const isTrusted = directories.some((directory) => isPathInsideDirectory(payload.targetPath, directory))
  if (!isTrusted) {
    throw new Error(UNTRUSTED_INSTALL_TARGET_ERROR)
  }
}

export class ContentInstallService {
  async resolveEditorInstallTarget(
    payload: SynapseResolveEditorTargetPayload,
  ): Promise<SynapseEditorResolvedTarget> {
    await assertConfiguredProjectPath(payload)
    return editorAdapterService.resolveTarget(payload)
  }

  async installToEditor(
    payload: SynapseInstallToEditorPayload,
    security?: EditorWriteSecurityDeps,
  ): Promise<SynapseContentInstallResult> {
    const target = await this.resolveEditorInstallTarget(payload)
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

    let installWarning: string | undefined

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
              if (await pathExists(backupPath)) {
                await rm(backupPath, { recursive: true, force: true }).catch(() => {})
              }
              try {
                await rename(target.targetPath, backupPath)
                backupPathForRestore = backupPath
              } catch (error) {
                logger.warn("Failed to backup existing skill directory", { targetPath: path.basename(target.targetPath), error })
                throw new Error("备份旧 Skill 失败，未替换目标。", { cause: error })
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
                  logger.info("Staged skill file.", { filePath: path.basename(filePath) })
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
                    filePath: path.basename(attachmentTargetPath),
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
                  backupPath: path.basename(backupPathForRestore),
                  targetPath: path.basename(target.targetPath),
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
            try {
              await rm(previousSkillDirectoryPath, { recursive: true, force: true })
            } catch (err) {
              logger.warn("Failed to clean up previous skill directory", err)
              installWarning = "旧 Skill 目录清理失败，编辑器可能残留旧文件。"
            }
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
      targetPath: path.basename(target.targetPath),
    })

    return {
      editorId: target.editorId,
      label: target.label,
      scope: target.scope,
      contentType: target.contentType,
      contentId: payload.contentId,
      targetKind: target.targetKind,
      targetPath: target.targetPath,
      ...(installWarning ? { warning: installWarning } : {}),
    }
  }

  async readEditorInstallFormValues(
    payload: SynapseReadEditorInstallFormValuesPayload,
    security?: EditorReadSecurityDeps,
  ): Promise<SynapseReadEditorInstallFormValuesResult> {
    const installStrategy = editorInstallStrategyById.get(payload.editorId)

    if (!installStrategy?.readRuleProjectFormValues) {
      return { values: null }
    }

    await assertTrustedInstallFormTarget(payload)
    const auditMetadata = {
      editorId: payload.editorId,
      operation: "read-install-form-values",
    }
    await checkEditorReadPermission(security, payload.targetPath, auditMetadata)

    try {
      const values = await installStrategy.readRuleProjectFormValues({
        targetPath: payload.targetPath,
        readExistingTextFile,
      })

      recordEditorReadAudit(security, payload.targetPath, "allowed", auditMetadata)
      return { values }
    } catch (error) {
      recordEditorReadAudit(security, payload.targetPath, "failed", auditMetadata)
      throw error
    }
  }
}

export const contentInstallService = new ContentInstallService()
