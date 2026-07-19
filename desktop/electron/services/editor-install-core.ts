import { app } from "electron"
import { cp, lstat, mkdir, opendir, rename, rm, writeFile } from "node:fs/promises"
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
  SynapseCopyToEditorPayload,
  SynapseEditorCopyResult,
} from "../../src/types/editor-copy"
import type {
  SynapseInstallSourceToEditorPayload,
  SynapseInstallerSource,
  SynapseInstallSourceMode,
  SynapseRuleInstallerSource,
  SynapseSkillInstallerSource,
} from "../../src/types/installers"
import { attachmentsPoolService } from "./attachments-pool-service"
import { configStore } from "./config-store"
import { contentService } from "./content-service"
import {
  findSkillDirectoryByContentId,
  isSkillDirectoryOwnedByContentId,
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
import {
  materializeSkillEnv,
  type SkillEnvMaterializationGuard,
} from "./skill-env/skill-env-materializer"
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
const MAX_SKILL_CLONE_ENTRIES = 10_000
const MAX_SKILL_CLONE_DIRECTORIES = 1_000
const MAX_SKILL_CLONE_DEPTH = 32
const SKILL_CLONE_IGNORED_ENTRY_NAMES = new Set([".git", ".hg", ".svn"])

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
  cloneSkillDirectory?: (stagingDirectoryPath: string) => Promise<void>
  copySkillAttachment?: (relativePath: string, targetPath: string) => Promise<void>
  readRuleBody?: () => Promise<string>
  readSkillDetail?: () => Promise<SynapseContentDetail<"skill">>
}

type EditorInstallOperation = SynapseInstallSourceMode | "clone"

function createSkillCloneInstallPayload(
  payload: SynapseCopyToEditorPayload,
): SynapseInstallToEditorPayload {
  const sourceIdentity = payload.source.synapseContentId?.trim()
    || payload.source.itemName

  return {
    contentId: sourceIdentity,
    contentType: "skill",
    editorId: payload.targetEditorId,
    overwriteConfirmed: payload.overwriteConfirmed,
    projectPath: payload.targetProjectPath,
    replaceConfirmed: payload.overwriteConfirmed,
    scope: payload.targetScope,
    skillName: payload.source.itemName,
    skillTitle: payload.source.itemName,
  }
}

function toSamePathUnavailableCloneTarget(
  target: Extract<SynapseEditorResolvedTarget, { status: "ready" | "conflict" }>,
): SynapseEditorResolvedTarget {
  return {
    contentType: target.contentType,
    editorId: target.editorId,
    label: target.label,
    message: "目标位置与源位置相同",
    scope: target.scope,
    status: "unavailable",
    targetKind: null,
    targetPath: null,
  }
}

function normalizeSkillCloneTarget(
  sourcePath: string,
  target: SynapseEditorResolvedTarget,
): SynapseEditorResolvedTarget {
  if (target.status !== "ready" && target.status !== "conflict") {
    return target
  }

  if (isSameEditorPath(sourcePath, target.targetPath)) {
    return toSamePathUnavailableCloneTarget(target)
  }

  if (target.status === "conflict") {
    return {
      contentType: target.contentType,
      editorId: target.editorId,
      label: target.label,
      message: target.message,
      scope: target.scope,
      status: "ready",
      targetExists: true,
      targetKind: target.targetKind,
      targetPath: target.targetPath,
    }
  }

  return target
}

type SkillCloneSourceFailureReason = "depth-limit" | "directory-limit" | "entry-limit" | "special-entry" | "symlink"

class SkillCloneSourceError extends Error {
  constructor(message: string, readonly reason: SkillCloneSourceFailureReason) {
    super(message)
    this.name = "SkillCloneSourceError"
  }
}

async function assertSkillCloneTreeSafe(sourceDirectoryPath: string): Promise<void> {
  const queue: Array<{ readonly directoryPath: string; readonly depth: number }> = [{
    directoryPath: sourceDirectoryPath,
    depth: 0,
  }]
  let directoryCount = 1
  let entryCount = 0

  for (const current of queue) {
    const directory = await opendir(current.directoryPath)
    for await (const entry of directory) {
      if (SKILL_CLONE_IGNORED_ENTRY_NAMES.has(entry.name)) continue
      entryCount += 1
      if (entryCount > MAX_SKILL_CLONE_ENTRIES) {
        throw new SkillCloneSourceError("Skill 复制源条目过多，未执行复制。", "entry-limit")
      }
      if (entry.isSymbolicLink()) {
        throw new SkillCloneSourceError("Skill 复制源包含符号链接，未执行复制。", "symlink")
      }
      if (entry.isDirectory()) {
        const depth = current.depth + 1
        if (depth > MAX_SKILL_CLONE_DEPTH) {
          throw new SkillCloneSourceError("Skill 复制源目录层级过深，未执行复制。", "depth-limit")
        }
        directoryCount += 1
        if (directoryCount > MAX_SKILL_CLONE_DIRECTORIES) {
          throw new SkillCloneSourceError("Skill 复制源目录过多，未执行复制。", "directory-limit")
        }
        queue.push({ directoryPath: path.join(current.directoryPath, entry.name), depth })
        continue
      }
      if (!entry.isFile()) {
        throw new SkillCloneSourceError("Skill 复制源包含不支持的文件类型，未执行复制。", "special-entry")
      }
    }
  }
}

async function copySkillInstanceDirectory(
  sourceDirectoryPath: string,
  stagingDirectoryPath: string,
): Promise<void> {
  const sourceEntry = await lstat(sourceDirectoryPath)
  if (sourceEntry.isSymbolicLink() || !sourceEntry.isDirectory()) {
    throw new Error("Skill 复制源必须是普通目录。")
  }

  await assertSkillCloneTreeSafe(sourceDirectoryPath)

  await cp(sourceDirectoryPath, stagingDirectoryPath, {
    dereference: false,
    filter: async (sourcePath) => {
      if (
        sourcePath !== sourceDirectoryPath
        && SKILL_CLONE_IGNORED_ENTRY_NAMES.has(path.basename(sourcePath))
      ) return false
      const entry = await lstat(sourcePath)
      if (entry.isSymbolicLink()) {
        throw new SkillCloneSourceError("Skill 复制源包含符号链接，未执行复制。", "symlink")
      }
      if (!entry.isDirectory() && !entry.isFile()) {
        throw new SkillCloneSourceError("Skill 复制源包含不支持的文件类型，未执行复制。", "special-entry")
      }
      return true
    },
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  })
}

async function checkSkillCloneReadPermission(
  deps: EditorWriteSecurityDeps | undefined,
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

function recordSkillCloneReadAudit(
  deps: EditorWriteSecurityDeps | undefined,
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
    skillEnvReplacementValues: payload.skillEnvReplacementValues,
    skillEnvValues: payload.skillEnvValues,
    variableSubstitutions: payload.variableSubstitutions,
    preparedSourceId: payload.source.preparedSourceId,
  }
}

export class EditorInstallCore {
  constructor(private readonly deps: EditorInstallCoreDeps) {}

  async resolveSkillCloneTarget(
    payload: SynapseCopyToEditorPayload,
  ): Promise<SynapseEditorResolvedTarget> {
    const target = await this.deps.resolveEditorInstallTarget(
      createSkillCloneInstallPayload(payload),
    )
    return normalizeSkillCloneTarget(payload.source.itemPath, target)
  }

  async cloneSkillToEditor(
    payload: SynapseCopyToEditorPayload,
    security?: EditorWriteSecurityDeps,
  ): Promise<SynapseEditorCopyResult> {
    const installPayload = createSkillCloneInstallPayload(payload)
    const target = await this.deps.resolveEditorInstallTarget(installPayload)
    const normalizedTarget = normalizeSkillCloneTarget(payload.source.itemPath, target)
    if (normalizedTarget.status === "unavailable") {
      throw new Error(normalizedTarget.message ?? "当前编辑器暂时不能复制到这个位置。")
    }
    if (
      target.status === "ready"
      && target.targetExists
      && !payload.overwriteConfirmed
    ) {
      throw new Error("目标位置已有内容。")
    }

    const readAuditMetadata = {
      contentType: "skill",
      operation: "clone",
      sourceEditorId: payload.source.editorId,
    }
    await checkSkillCloneReadPermission(
      security,
      payload.source.itemPath,
      readAuditMetadata,
    )

    const result = await this.runInstallToEditor(
      installPayload,
      security,
      {
        cloneSkillDirectory: async (stagingDirectoryPath) => {
          try {
            await copySkillInstanceDirectory(payload.source.itemPath, stagingDirectoryPath)
            recordSkillCloneReadAudit(
              security,
              payload.source.itemPath,
              "allowed",
              readAuditMetadata,
            )
          } catch (error) {
            recordSkillCloneReadAudit(
              security,
              payload.source.itemPath,
              "failed",
              {
                ...readAuditMetadata,
                ...(error instanceof SkillCloneSourceError ? { reason: error.reason } : {}),
              },
            )
            throw error
          }
        },
      },
      "clone",
      target,
    )

    return {
      contentType: "skill",
      editorId: result.editorId,
      label: result.label,
      overwritten: target.status === "conflict"
        || (target.status === "ready" && target.targetExists),
      scope: result.scope,
      targetKind: result.targetKind,
      targetPath: result.targetPath,
    }
  }

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
      payload.mode ?? "install",
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
    operation: EditorInstallOperation = "install",
    resolvedTarget?: SynapseEditorResolvedTarget,
  ): Promise<SynapseContentInstallResult> {
    const target = resolvedTarget ?? await this.deps.resolveEditorInstallTarget(payload)
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
      operation,
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

          const cloneSkillDirectory = sourceOverride?.cloneSkillDirectory
          const installStrategy = cloneSkillDirectory
            ? null
            : editorInstallStrategyById.get(payload.editorId)

          if (!cloneSkillDirectory && !installStrategy?.prepareSkillDirectory) {
            throw new Error(`当前编辑器没有提供 ${definition.singularLabel} 安装策略。`)
          }

          const prepareSkillDirectory = installStrategy?.prepareSkillDirectory
          const detail = cloneSkillDirectory
            ? null
            : sourceOverride?.readSkillDetail
            ? await sourceOverride.readSkillDetail()
            : payload.preparedSourceId
            ? await this.deps.preparedSourceProvider.readPreparedSkill(payload.preparedSourceId, payload.contentId)
            : await contentService.getSkillDetail(payload.contentId)
          if (detail) {
            assertNoRuntimeSkillEnvPath(
              detail.attachments.map((attachment) => attachment.originalName),
            )
          }
          const repositoryRootPath = cloneSkillDirectory
            || sourceOverride?.readSkillDetail
            || payload.preparedSourceId
            || !detail
            ? null
            : await getActiveRepositoryRootPath()
          const parentDirectoryPath = path.dirname(target.targetPath)
          let backupPathForRestore: string | null = null
          const previousSkillDirectoryPath = payload.contentType === "skill" && operation !== "clone"
            ? await findSkillDirectoryByContentId(parentDirectoryPath, payload.contentId)
            : null
          const isOwnExistingSkillDirectory = (
            target.status === "ready" && target.ownedTargetExists === true
          ) || Boolean(
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
                operation: `${operation}-backup`,
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
          const renamedSkillDirectoryPath = previousSkillDirectoryPath
            && !isSameEditorPath(previousSkillDirectoryPath, target.targetPath)
            ? previousSkillDirectoryPath
            : null
          const existingSkillDirectoryPath = renamedSkillDirectoryPath
            ?? backupPathForRestore
            ?? target.targetPath

          try {
            let skillEnvGuard: SkillEnvMaterializationGuard | null = null
            await replaceDirectoryAtomically(target.targetPath, async (stagingDirectoryPath) => {
              if (cloneSkillDirectory) {
                await cloneSkillDirectory(stagingDirectoryPath)
                return
              }
              if (!detailWithSubstitutions) {
                throw new Error("Skill 安装源不可用。")
              }
              if (!prepareSkillDirectory) {
                throw new Error(`当前编辑器没有提供 ${definition.singularLabel} 安装策略。`)
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
              const inheritExistingEnv = await isSkillDirectoryOwnedByContentId(
                existingSkillDirectoryPath,
                payload.contentId,
              )
              await materializeSkillEnv({
                stagingDirectoryPath,
                existingTargetDirectoryPath: existingSkillDirectoryPath,
                inheritExistingEnv,
                replacementValues: payload.skillEnvReplacementValues ?? {},
                values: payload.skillEnvValues ?? {},
                registerPrecondition(guard) {
                  skillEnvGuard = guard
                },
              })
            }, {
              beforeSwap: async () => {
                if (cloneSkillDirectory) return
                if (!skillEnvGuard) {
                  throw new Error("Skill .env 更新前置校验未注册。")
                }
                await skillEnvGuard.validate()
              },
              afterMoveExistingTarget: async (movedTargetPath) => {
                if (cloneSkillDirectory) return
                if (!skillEnvGuard) {
                  throw new Error("Skill .env 更新前置校验未注册。")
                }
                await skillEnvGuard.validateMovedTarget(movedTargetPath)
              },
              beforeRestoreMovedTarget: async (movedTargetPath) => {
                if (cloneSkillDirectory) return
                if (!skillEnvGuard) {
                  throw new Error("Skill .env 更新前置校验未注册。")
                }
                await skillEnvGuard.validateMovedTargetForRestore(movedTargetPath)
              },
              beforeDeleteMovedTarget: async (movedTargetPath) => {
                if (cloneSkillDirectory) return
                if (!skillEnvGuard) {
                  throw new Error("Skill .env 更新前置校验未注册。")
                }
                await skillEnvGuard.validateMovedTarget(movedTargetPath)
              },
              onRetainedMovedTarget: () => {
                installWarning = "旧 Skill 备份发生变化，已保留，请手动检查。"
              },
            })
          } catch (error) {
            if (backupPathForRestore && await pathExists(backupPathForRestore)) {
              const restoreAuditMetadata = {
                ...auditMetadata,
                operation: `${operation}-backup-restore`,
                targetName: path.basename(target.targetPath),
              }
              try {
                if (await pathEntryExists(target.targetPath)) {
                  throw new Error("Skill 目标目录已重新出现，不能自动恢复旧备份。", { cause: error })
                }
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
            let previousBackupPath: string | null = null
            const previousBackupAuditMetadata = {
              ...auditMetadata,
              operation: `${operation}-previous-backup`,
              targetName: path.basename(previousSkillDirectoryPath),
            }
            try {
              if (!await isSkillDirectoryOwnedByContentId(previousSkillDirectoryPath, payload.contentId)) {
                installWarning = "旧 Skill 目录身份已变化，已保留，请手动检查。"
              } else {
                previousBackupPath = await getAvailableDesktopSkillBackupPath(previousSkillDirectoryPath)
                await checkEditorWritePermission(security, previousBackupPath, previousBackupAuditMetadata)
                await mkdir(path.dirname(previousBackupPath), { recursive: true })
                await moveDirectoryAllowingCrossDevice(previousSkillDirectoryPath, previousBackupPath)
                recordEditorWriteAudit(security, previousBackupPath, "allowed", previousBackupAuditMetadata)
                installWarning = `Skill 改名完成，旧目录已备份到桌面：${path.basename(previousBackupPath)}`
              }
            } catch (err) {
              const auditPath = previousBackupPath ?? previousSkillDirectoryPath
              recordEditorWriteAudit(security, auditPath, "failed", previousBackupAuditMetadata)
              logger.warn("Failed to backup previous skill directory", {
                targetPath: path.basename(previousSkillDirectoryPath),
                ...createEditorWriteErrorLogMeta(err),
              })
              installWarning = "旧 Skill 目录备份失败，原目录已保留，请手动检查。"
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
