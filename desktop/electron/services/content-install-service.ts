import { app } from "electron"
import { cp, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
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
import type { SynapseContentDetail } from "../../src/types/content"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { attachmentsPoolService } from "./attachments-pool-service"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import { editorAdapterService } from "./editor-adapter-service"
import { editorAdapterById } from "./editor-adapters"
import { editorInstallStrategyById } from "./definitions/generated/main-registry"
import {
  findSkillDirectoryByContentId,
} from "./editor-adapters/skill-identity"
import { applyVariableSubstitutions } from "../../src/lib/variable-substitution"
import { builtinContentService } from "./builtin-content-service"
import { createMainLogger } from "./log-store"
import { repositoryStore } from "./repository-store"
import {
  createEditorWriteErrorLogMeta,
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

type PreparedContentInstallSourceProvider = {
  readPreparedRule(sourceId: string, contentId: string): Promise<string>
  readPreparedSkill(sourceId: string, contentId: string): Promise<SynapseContentDetail<"skill">>
  beginPreparedInstall(sourceId: string, contentId: string): Promise<void>
  endPreparedInstall(sourceId: string, contentId: string): Promise<void>
  copyPreparedSkillAttachment(
    sourceId: string,
    contentId: string,
    relativePath: string,
    targetPath: string,
  ): Promise<void>
  markPreparedInstalled(sourceId: string, contentId: string): Promise<void>
}

type ContentInstallServiceDeps = {
  readonly preparedSourceProvider?: PreparedContentInstallSourceProvider
}

const unavailablePreparedSourceProvider: PreparedContentInstallSourceProvider = {
  async readPreparedRule() {
    throw new Error("Content Store 安装源尚未初始化。")
  },
  async readPreparedSkill() {
    throw new Error("Content Store 安装源尚未初始化。")
  },
  async beginPreparedInstall() {
    throw new Error("Content Store 安装源尚未初始化。")
  },
  async endPreparedInstall() {
    throw new Error("Content Store 安装源尚未初始化。")
  },
  async copyPreparedSkillAttachment() {
    throw new Error("Content Store 安装源尚未初始化。")
  },
  async markPreparedInstalled() {
    throw new Error("Content Store 安装源尚未初始化。")
  },
}

const UNTRUSTED_PROJECT_PATH_ERROR = "项目路径不在已配置项目中。"
const UNTRUSTED_INSTALL_TARGET_ERROR = "安装目标不在已配置编辑器路径中。"
const MAX_SKILL_BACKUP_PATH_ATTEMPTS = 1000

function isCrossDeviceRenameError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "EXDEV"
}

async function moveDirectoryAllowingCrossDevice(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await rename(sourcePath, destinationPath)
  } catch (error) {
    if (!isCrossDeviceRenameError(error)) {
      throw error
    }

    await cp(sourcePath, destinationPath, { recursive: true, force: true })
    await rm(sourcePath, { recursive: true, force: true })
  }
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
    throw new Error("当前还没有选中的本地目录。")
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

function getDesktopSkillBackupPath(targetPath: string): string {
  return path.join(app.getPath("desktop"), `${path.basename(targetPath)}-synapse备份`)
}

async function getAvailableDesktopSkillBackupPath(targetPath: string): Promise<string> {
  const preferredPath = getDesktopSkillBackupPath(targetPath)
  if (!await pathEntryExists(preferredPath)) return preferredPath
  for (let index = 2; index <= MAX_SKILL_BACKUP_PATH_ATTEMPTS; index += 1) {
    const candidate = `${preferredPath}-${index}`
    if (!await pathEntryExists(candidate)) return candidate
  }
  throw new Error("无法创建唯一的 Skill 备份路径。")
}

async function pathEntryExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false
    }
    throw error
  }
}

function createSkillBackupRestoreFailureError(backupPath: string): Error {
  return new Error(`安装失败，且旧 Skill 备份恢复失败。旧备份仍保留在桌面：${path.basename(backupPath)}，请手动检查目标目录。`)
}

function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(targetPath))
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
}

type TrustedRuleTargetPath = {
  kind: "directory" | "file"
  targetPath: string
}

function inferRuleTargetKind(targetPath: string): TrustedRuleTargetPath["kind"] {
  return path.basename(targetPath) === "rules" ? "directory" : "file"
}

function isTrustedRuleTargetPath(targetPath: string, trusted: TrustedRuleTargetPath): boolean {
  if (trusted.kind === "file") {
    return isSamePath(targetPath, trusted.targetPath)
  }

  return isSamePath(targetPath, trusted.targetPath) || isPathInsideDirectory(targetPath, trusted.targetPath)
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

async function getTrustedRuleTargets(editorId: string): Promise<TrustedRuleTargetPath[]> {
  const adapter = editorAdapterById.get(editorId)
  if (!adapter) return []

  const targets: TrustedRuleTargetPath[] = []
  const scanConfig = adapter.getScanPathConfig()
  if (scanConfig.globalRulesPath) {
    targets.push({
      kind: inferRuleTargetKind(scanConfig.globalRulesPath),
      targetPath: scanConfig.globalRulesPath,
    })
  }

  const config = await configStore.load()
  for (const project of config.global.projects) {
    const rulesPath = scanConfig.projectPaths(project.path).rulesPath
    targets.push({
      kind: inferRuleTargetKind(rulesPath),
      targetPath: rulesPath,
    })
  }

  const seen = new Set<string>()
  return targets.filter((target) => {
    const key = `${target.kind}:${path.resolve(target.targetPath)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function assertTrustedInstallFormTarget(
  payload: SynapseReadEditorInstallFormValuesPayload,
): Promise<void> {
  const targets = await getTrustedRuleTargets(payload.editorId)
  const isTrusted = targets.some((target) => isTrustedRuleTargetPath(payload.targetPath, target))
  if (!isTrusted) {
    throw new Error(UNTRUSTED_INSTALL_TARGET_ERROR)
  }
}

async function assertTrustedResolvedRuleTarget(
  payload: SynapseInstallToEditorPayload,
  target: SynapseEditorResolvedTarget,
): Promise<void> {
  if (payload.contentType !== "rule") return
  if (target.status !== "ready" && target.status !== "conflict") return
  const targets = await getTrustedRuleTargets(payload.editorId)
  const isTrusted = targets.some((trusted) => isTrustedRuleTargetPath(target.targetPath, trusted))
  if (!isTrusted) {
    throw new Error(UNTRUSTED_INSTALL_TARGET_ERROR)
  }
}

export class ContentInstallService {
  private preparedSourceProvider: PreparedContentInstallSourceProvider

  constructor(deps: ContentInstallServiceDeps = {}) {
    this.preparedSourceProvider = deps.preparedSourceProvider ?? unavailablePreparedSourceProvider
  }

  setPreparedSourceProvider(provider: PreparedContentInstallSourceProvider): void {
    this.preparedSourceProvider = provider
  }

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

    await assertTrustedResolvedRuleTarget(payload, target)

    const auditMetadata = {
      contentId: payload.contentId,
      contentType: payload.contentType,
      editorId: payload.editorId,
      operation: "install",
      scope: payload.scope,
    }

    await checkEditorWritePermission(security, target.targetPath, auditMetadata)

    let installWarning: string | undefined
    let preparedInstallStarted = false
    if (payload.preparedSourceId) {
      await this.preparedSourceProvider.beginPreparedInstall(payload.preparedSourceId, payload.contentId)
      preparedInstallStarted = true
    }

    try {

      switch (definition.install.kind) {
        case "none":
          throw new Error(`${definition.singularLabel} 不支持安装到编辑器。`)
        case "single-file": {
          if (target.targetKind !== "file") {
            throw new Error(`当前编辑器没有返回合法的 ${definition.singularLabel} 安装目标。`)
          }

          let ruleBody = payload.preparedSourceId
            ? await this.preparedSourceProvider.readPreparedRule(payload.preparedSourceId, payload.contentId)
            : (await contentService.getContent(payload.contentType, payload.contentId)).content

          if (payload.variableSubstitutions && Object.keys(payload.variableSubstitutions).length > 0) {
            ruleBody = applyVariableSubstitutions(ruleBody, payload.variableSubstitutions, { includeCodeBlocks: true })
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
          const detail = payload.preparedSourceId
            ? await this.preparedSourceProvider.readPreparedSkill(payload.preparedSourceId, payload.contentId)
            : await contentService.getSkillDetail(payload.contentId)
          const repositoryRootPath = payload.preparedSourceId || !detail || detail.source === "builtin"
            ? null
            : await getActiveRepositoryRootPath()
          const parentDirectoryPath = path.dirname(target.targetPath)
          let backupPathForRestore: string | null = null
          const previousSkillDirectoryPath = payload.contentType === "skill"
            ? await findSkillDirectoryByContentId(parentDirectoryPath, payload.contentId)
            : null
          const isOwnExistingSkillDirectory = Boolean(
            previousSkillDirectoryPath && isSamePath(previousSkillDirectoryPath, target.targetPath),
          )

          if (
            target.status === "ready"
            && target.targetExists
            && !isOwnExistingSkillDirectory
            && !payload.overwriteConfirmed
          ) {
            throw new Error("覆盖目标目录前需要用户确认。")
          }

          // Handle Skill replacement: backup existing directory if replace confirmed
          if (payload.contentType === "skill" && payload.replaceConfirmed) {
            const targetExists = await pathExists(target.targetPath)
            if (targetExists && !isOwnExistingSkillDirectory) {
              const backupPath = await getAvailableDesktopSkillBackupPath(target.targetPath)
              const backupAuditMetadata = {
                ...auditMetadata,
                operation: "install-backup",
                targetName: path.basename(target.targetPath),
              }
              await checkEditorWritePermission(security, backupPath, backupAuditMetadata)
              try {
                await mkdir(path.dirname(backupPath), { recursive: true })
                await moveDirectoryAllowingCrossDevice(target.targetPath, backupPath)
                backupPathForRestore = backupPath
                recordEditorWriteAudit(security, backupPath, "allowed", backupAuditMetadata)
              } catch (error) {
                recordEditorWriteAudit(security, backupPath, "failed", backupAuditMetadata)
                logger.warn("Failed to backup existing skill directory", {
                  targetPath: path.basename(target.targetPath),
                  ...createEditorWriteErrorLogMeta(error),
                })
                throw new Error("备份旧 Skill 失败，未替换目标。", { cause: error })
              }
            }
          }

          const detailWithSubstitutions = detail && payload.variableSubstitutions && Object.keys(payload.variableSubstitutions).length > 0
            ? {
                ...detail,
                content: applyVariableSubstitutions(detail.content, payload.variableSubstitutions, { includeCodeBlocks: true }),
              }
            : detail

          try {
            await replaceDirectoryAtomically(target.targetPath, async (stagingDirectoryPath) => {
              if (!detailWithSubstitutions) {
                throw new Error("Skill 安装源不可用。")
              }
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
                  if (payload.preparedSourceId) {
                    await this.preparedSourceProvider.copyPreparedSkillAttachment(
                      payload.preparedSourceId,
                      payload.contentId,
                      attachment.originalName,
                      attachmentTargetPath,
                    )
                  } else if (detailWithSubstitutions.source === "builtin") {
                    await builtinContentService.copyAttachmentToPath(
                      payload.contentType,
                      payload.contentId,
                      attachment,
                      attachmentTargetPath,
                    )
                  } else {
                    if (!repositoryRootPath) {
                      throw new Error("当前还没有选中的本地目录。")
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
              const restoreAuditMetadata = {
                ...auditMetadata,
                operation: "install-backup-restore",
                targetName: path.basename(target.targetPath),
              }
              try {
                await rm(target.targetPath, { recursive: true, force: true })
                await moveDirectoryAllowingCrossDevice(backupPathForRestore, target.targetPath)
                recordEditorWriteAudit(security, backupPathForRestore, "allowed", restoreAuditMetadata)
              } catch (restoreError) {
                recordEditorWriteAudit(security, backupPathForRestore, "failed", restoreAuditMetadata)
                logger.warn("Failed to restore backed up skill directory", {
                  backupPath: path.basename(backupPathForRestore),
                  targetPath: path.basename(target.targetPath),
                  ...createEditorWriteErrorLogMeta(restoreError),
                })
                throw createSkillBackupRestoreFailureError(backupPathForRestore)
              }
            }

            throw error
          }

          if (
            previousSkillDirectoryPath
            && !isSamePath(previousSkillDirectoryPath, target.targetPath)
          ) {
            try {
              await rm(previousSkillDirectoryPath, { recursive: true, force: true })
            } catch (err) {
              logger.warn("Failed to clean up previous skill directory", {
                targetPath: path.basename(previousSkillDirectoryPath),
                ...createEditorWriteErrorLogMeta(err),
              })
              installWarning = "旧 Skill 目录清理失败，编辑器可能残留旧文件。"
            }
          }

          break
        }
        default:
          throw new Error(`不支持 ${definition.singularLabel} 的安装方式。`)
      }

      if (payload.preparedSourceId) {
        await this.preparedSourceProvider.markPreparedInstalled(payload.preparedSourceId, payload.contentId)
      }
    } catch (error) {
      recordEditorWriteAudit(security, target.targetPath, "failed", auditMetadata)
      throw formatInstallFailure(error, target.targetPath)
    } finally {
      if (preparedInstallStarted && payload.preparedSourceId) {
        try {
          await this.preparedSourceProvider.endPreparedInstall(payload.preparedSourceId, payload.contentId)
        } catch (error) {
          logger.warn("Failed to release prepared install lock.", {
            contentId: payload.contentId,
            ...createEditorWriteErrorLogMeta(error),
          })
        }
      }
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
