import { app } from "electron"
import { cp, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { getContentTypeDefinition } from "../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import { applyVariableSubstitutions } from "../../src/lib/variable-substitution"
import { assertNoRuntimeSkillEnvPath } from "../../src/lib/content-attachments"
import type { SynapseContentDetail } from "../../src/types/content"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseContentInstallResult,
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
  SynapseResolveEditorTargetPayload,
} from "../../src/types/editor"
import type {
  SynapseInstallSourceToEditorPayload,
  SynapseInstallerSource,
  SynapseRuleInstallerSource,
  SynapseSkillInstallerSource,
} from "../../src/types/installers"
import { attachmentsPoolService } from "./attachments-pool-service"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import {
  findSkillDirectoryByContentId,
} from "./editor-adapters/skill-identity"
import {
  createEditorWriteErrorLogMeta,
  formatEditorWriteFailure,
  readExistingTextFile,
  replaceDirectoryAtomically,
  replaceFileAtomically,
} from "./editor-file-write-utils"
import { editorInstallStrategyById } from "./definitions/generated/main-registry"
import { pathExists } from "./fs-utils"
import { createMainLogger } from "./log-store"
import { repositoryStore } from "./repository-store"
import { materializeSkillEnv } from "./skill-env/skill-env-materializer"
import {
  checkEditorWritePermission,
  recordEditorWriteAudit,
  type EditorWriteSecurityDeps,
} from "./editor-write-security"
import {
  assertTrustedResolvedRuleTarget,
  isSameEditorPath,
} from "./editor-install-target-security"

const logger = createMainLogger("service.editor-install-core")

const MAX_SKILL_BACKUP_PATH_ATTEMPTS = 1000

export type PreparedContentInstallSourceProvider = {
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

export type EditorInstallCoreDeps = {
  installerSourceProvider?: InstallerInstallSourceProvider
  preparedSourceProvider: PreparedContentInstallSourceProvider
  resolveEditorInstallTarget(payload: SynapseResolveEditorTargetPayload): Promise<SynapseEditorResolvedTarget>
}

export type InstallerInstallSourceProvider = {
  copyLocalSkillAttachment(
    source: SynapseSkillInstallerSource,
    relativePath: string,
    targetPath: string,
  ): Promise<void>
  readInlineRule(source: SynapseRuleInstallerSource): Promise<string>
  readLocalSkill(source: SynapseSkillInstallerSource): Promise<SynapseContentDetail<"skill">>
}

type EditorInstallSourceOverride = {
  copySkillAttachment?: (relativePath: string, targetPath: string) => Promise<void>
  readRuleBody?: () => Promise<string>
  readSkillDetail?: () => Promise<SynapseContentDetail<"skill">>
}

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

function toInstallToEditorPayload(payload: SynapseInstallSourceToEditorPayload): SynapseInstallToEditorPayload {
  return {
    editorId: payload.editorId,
    scope: payload.scope,
    projectPath: payload.projectPath,
    contentType: payload.source.kind,
    contentId: payload.source.sourceIdentity,
    skillName: payload.source.kind === "skill" ? payload.source.name : undefined,
    skillTitle: payload.source.kind === "skill" ? payload.source.title : undefined,
    ruleName: payload.source.kind === "rule" ? payload.source.name : undefined,
    installFormValues: payload.installFormValues,
    overwriteConfirmed: payload.overwriteConfirmed,
    replaceConfirmed: payload.replaceConfirmed,
    replacedContentId: payload.replacedSourceIdentity,
    skillEnvValues: payload.skillEnvValues,
    variableSubstitutions: payload.variableSubstitutions,
    preparedSourceId: payload.source.preparedSourceId,
  }
}

export class EditorInstallCore {
  constructor(private readonly deps: EditorInstallCoreDeps) {}

  async installToEditor(
    payload: SynapseInstallToEditorPayload,
    security?: EditorWriteSecurityDeps,
  ): Promise<SynapseContentInstallResult> {
    return this.runInstallToEditor(payload, security)
  }

  async installSourceToEditor(
    payload: SynapseInstallSourceToEditorPayload,
    security?: EditorWriteSecurityDeps,
  ): Promise<SynapseContentInstallResult> {
    return this.runInstallToEditor(
      toInstallToEditorPayload(payload),
      security,
      this.createSourceOverride(payload.source),
    )
  }

  private createSourceOverride(source: SynapseInstallerSource): EditorInstallSourceOverride | undefined {
    if (source.kind === "rule" && source.origin === "inline") {
      return {
        readRuleBody: async () => this.requireInstallerSourceProvider().readInlineRule(source),
      }
    }

    if (source.kind === "skill" && source.origin === "local-directory") {
      return {
        copySkillAttachment: async (relativePath, targetPath) =>
          this.requireInstallerSourceProvider().copyLocalSkillAttachment(source, relativePath, targetPath),
        readSkillDetail: async () => this.requireInstallerSourceProvider().readLocalSkill(source),
      }
    }

    return undefined
  }

  private requireInstallerSourceProvider(): InstallerInstallSourceProvider {
    if (!this.deps.installerSourceProvider) {
      throw new Error("安装源服务尚未初始化。")
    }
    return this.deps.installerSourceProvider
  }

  private async runInstallToEditor(
    payload: SynapseInstallToEditorPayload,
    security?: EditorWriteSecurityDeps,
    sourceOverride?: EditorInstallSourceOverride,
  ): Promise<SynapseContentInstallResult> {
    const target = await this.deps.resolveEditorInstallTarget(payload)
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
      await this.deps.preparedSourceProvider.beginPreparedInstall(payload.preparedSourceId, payload.contentId)
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

          let ruleBody = sourceOverride?.readRuleBody
            ? await sourceOverride.readRuleBody()
            : payload.preparedSourceId
            ? await this.deps.preparedSourceProvider.readPreparedRule(payload.preparedSourceId, payload.contentId)
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
          const detail = sourceOverride?.readSkillDetail
            ? await sourceOverride.readSkillDetail()
            : payload.preparedSourceId
            ? await this.deps.preparedSourceProvider.readPreparedSkill(payload.preparedSourceId, payload.contentId)
            : await contentService.getSkillDetail(payload.contentId)
          assertNoRuntimeSkillEnvPath(
            detail?.attachments.map((attachment) => attachment.originalName) ?? [],
          )
          const repositoryRootPath = sourceOverride?.readSkillDetail || payload.preparedSourceId || !detail
            ? null
            : await getActiveRepositoryRootPath()
          const parentDirectoryPath = path.dirname(target.targetPath)
          let backupPathForRestore: string | null = null
          const previousSkillDirectoryPath = payload.contentType === "skill"
            ? await findSkillDirectoryByContentId(parentDirectoryPath, payload.contentId)
            : null
          const isOwnExistingSkillDirectory = Boolean(
            previousSkillDirectoryPath && isSameEditorPath(previousSkillDirectoryPath, target.targetPath),
          )

          if (
            target.status === "ready"
            && target.targetExists
            && !isOwnExistingSkillDirectory
            && !payload.overwriteConfirmed
          ) {
            throw new Error("覆盖目标目录前需要用户确认。")
          }

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
                  if (sourceOverride?.copySkillAttachment) {
                    await sourceOverride.copySkillAttachment(attachment.originalName, attachmentTargetPath)
                  } else if (payload.preparedSourceId) {
                    await this.deps.preparedSourceProvider.copyPreparedSkillAttachment(
                      payload.preparedSourceId,
                      payload.contentId,
                      attachment.originalName,
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
              await materializeSkillEnv({
                stagingDirectoryPath,
                existingTargetDirectoryPath: target.targetPath,
                values: payload.skillEnvValues ?? {},
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
            && !isSameEditorPath(previousSkillDirectoryPath, target.targetPath)
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
        await this.deps.preparedSourceProvider.markPreparedInstalled(payload.preparedSourceId, payload.contentId)
      }
    } catch (error) {
      recordEditorWriteAudit(security, target.targetPath, "failed", auditMetadata)
      throw formatInstallFailure(error, target.targetPath)
    } finally {
      if (preparedInstallStarted && payload.preparedSourceId) {
        try {
          await this.deps.preparedSourceProvider.endPreparedInstall(payload.preparedSourceId, payload.contentId)
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
}
