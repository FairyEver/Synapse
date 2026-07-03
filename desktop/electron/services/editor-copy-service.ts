import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseCopyToEditorPayload,
  SynapseEditorCopyResult,
  SynapseEditorCopySource,
  SynapseResolveEditorCopyTargetPayload,
} from "../../src/types/editor-copy"
import type {
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
} from "../../src/types/editor"
import {
  assertUniqueContentAttachmentPaths,
  normalizeContentAttachmentPath,
} from "../../src/lib/content-attachments"
import { isWindowsReservedContentNameInput } from "../../src/lib/content-name-input"
import { editorInstallStrategyById } from "./definitions/generated/main-registry"
import { editorAdapterService } from "./editor-adapter-service"
import { configStore } from "./config-store"
import { pathExists } from "./fs-utils"
import { createMainLogger } from "./log-store"
import { prepareQuickPublishDraft } from "./editor-scan-service"
import {
  formatEditorWriteFailure,
  normalizeMarkdownContent,
  readExistingTextFile,
  replaceDirectoryAtomically,
  replaceFileAtomically,
} from "./editor-file-write-utils"
import {
  checkEditorWritePermission,
  recordEditorWriteAudit,
  type EditorWriteSecurityDeps,
} from "./editor-write-security"
import { isSameEditorPath } from "./editor-install-target-security"

const logger = createMainLogger("service.editor-copy")
const MARKDOWN_EXTENSION_PATTERN = /\.(md|mdc)$/iu
const SAFE_RULE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/
const UNTRUSTED_PROJECT_PATH_ERROR = "项目路径不在已配置项目中。"

function stripRuleExtension(value: string): string {
  return value.replace(MARKDOWN_EXTENSION_PATTERN, "")
}

function deriveRuleName(source: SynapseEditorCopySource): string {
  const name = stripRuleExtension(source.itemName.trim())
  if (name) {
    return path.basename(name)
  }

  return stripRuleExtension(path.basename(source.itemPath)) || "rule"
}

function deriveSafeRuleId(source: SynapseEditorCopySource): string {
  if (source.synapseContentId && SAFE_RULE_ID_PATTERN.test(source.synapseContentId)) {
    return source.synapseContentId
  }

  const ruleName = deriveRuleName(source)
  const asciiName = ruleName
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")

  if (asciiName && SAFE_RULE_ID_PATTERN.test(asciiName)) {
    return asciiName
  }

  const digest = createHash("sha256").update(source.itemPath).digest("hex").slice(0, 8)
  return `copied-rule-${digest}`
}

function assertEditorCopyRuleName(ruleName: string): void {
  if (isWindowsReservedContentNameInput(ruleName)) {
    throw new Error("Rule 名称是 Windows 系统保留字，请重命名后再复制。")
  }
}

function toSamePathUnavailableTarget(
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

async function normalizeCopyTarget(
  source: SynapseEditorCopySource,
  target: SynapseEditorResolvedTarget,
): Promise<SynapseEditorResolvedTarget> {
  if (target.status !== "ready" && target.status !== "conflict") {
    return target
  }

  if (isSameEditorPath(source.itemPath, target.targetPath)) {
    return toSamePathUnavailableTarget(target)
  }

  const targetExists = await pathExists(target.targetPath)

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

  return {
    ...target,
    targetExists,
  }
}

function createResolvePayload(payload: SynapseResolveEditorCopyTargetPayload) {
  const { source } = payload
  const ruleName = source.itemType === "rule" ? deriveRuleName(source) : undefined
  if (ruleName) {
    assertEditorCopyRuleName(ruleName)
  }
  const contentId = source.itemType === "rule"
    ? deriveSafeRuleId(source)
    : source.itemName

  return {
    contentId,
    contentType: source.itemType,
    editorId: payload.targetEditorId,
    projectPath: payload.targetScope === "project" ? payload.targetProjectPath : undefined,
    ruleName,
    scope: payload.targetScope,
    skillName: source.itemType === "skill" ? source.itemName : undefined,
    skillTitle: source.itemType === "skill" ? source.itemName : undefined,
  }
}

async function assertConfiguredProjectPath(
  payload: SynapseResolveEditorCopyTargetPayload,
): Promise<void> {
  if (payload.targetScope !== "project") return
  if (!payload.targetProjectPath?.trim()) {
    throw new Error("项目路径为空，无法解析项目复制位置。")
  }

  const config = await configStore.load()
  const isConfigured = config.global.projects.some((project) => isSameEditorPath(project.path, payload.targetProjectPath ?? ""))
  if (!isConfigured) {
    throw new Error(UNTRUSTED_PROJECT_PATH_ERROR)
  }
}

function createInstallPayload(
  payload: SynapseCopyToEditorPayload,
): SynapseInstallToEditorPayload {
  const resolvePayload = createResolvePayload(payload)
  return {
    ...resolvePayload,
    installFormValues: payload.installFormValues,
  }
}

class EditorCopyService {
  async resolveTarget(
    payload: SynapseResolveEditorCopyTargetPayload,
  ): Promise<SynapseEditorResolvedTarget> {
    await assertConfiguredProjectPath(payload)
    const target = await editorAdapterService.resolveTarget(createResolvePayload(payload))
    return normalizeCopyTarget(payload.source, target)
  }

  async copy(
    payload: SynapseCopyToEditorPayload,
    security?: EditorWriteSecurityDeps,
  ): Promise<SynapseEditorCopyResult> {
    const target = await this.resolveTarget(payload)

    if (target.status !== "ready") {
      throw new Error(target.message ?? "当前编辑器暂时不能复制到这个位置。")
    }

    if (target.targetExists && !payload.overwriteConfirmed) {
      throw new Error("目标位置已有内容。")
    }

    const auditMetadata = {
      contentType: payload.source.itemType,
      editorId: payload.targetEditorId,
      operation: "copy",
      scope: payload.targetScope,
      sourceEditorId: payload.source.editorId,
    }

    await checkEditorWritePermission(security, target.targetPath, auditMetadata)

    try {
      if (payload.source.itemType === "rule") {
        await this.copyRule(payload, target, security)
      } else {
        await this.copySkill(payload, target, security)
      }
    } catch (error) {
      recordEditorWriteAudit(security, target.targetPath, "failed", auditMetadata)
      throw formatEditorWriteFailure(error, target.targetPath)
    }

    recordEditorWriteAudit(security, target.targetPath, "allowed", auditMetadata)

    logger.info("Copied scan item to editor target.", {
      contentType: payload.source.itemType,
      sourceEditorId: payload.source.editorId,
      sourceName: path.basename(payload.source.itemPath),
      targetEditorId: payload.targetEditorId,
      targetName: path.basename(target.targetPath),
      targetScope: payload.targetScope,
    })

    return {
      contentType: payload.source.itemType,
      editorId: target.editorId,
      label: target.label,
      overwritten: target.targetExists,
      scope: target.scope,
      targetKind: target.targetKind,
      targetPath: target.targetPath,
    }
  }

  private async copyRule(
    payload: SynapseCopyToEditorPayload,
    target: Extract<SynapseEditorResolvedTarget, { status: "ready" }>,
    security: EditorWriteSecurityDeps | undefined,
  ): Promise<void> {
    if (target.targetKind !== "file") {
      throw new Error("当前编辑器没有返回合法的 Rule 复制目标。")
    }

    const draft = await prepareQuickPublishDraft({
      itemName: payload.source.itemName,
      itemPath: payload.source.itemPath,
      itemType: "rule",
      metadata: payload.source.metadata,
      ruleContent: payload.source.content,
    }, security)

    if (draft.itemType !== "rule") {
      throw new Error("读取 Rule 内容失败。")
    }

    const installStrategy = editorInstallStrategyById.get(payload.targetEditorId)
    const content = installStrategy
      ? await installStrategy.prepareRuleFileContent({
          payload: createInstallPayload(payload),
          readExistingTextFile,
          ruleBody: draft.content,
          targetPath: target.targetPath,
        })
      : draft.content

    await replaceFileAtomically(target.targetPath, content)
  }

  private async copySkill(
    payload: SynapseCopyToEditorPayload,
    target: Extract<SynapseEditorResolvedTarget, { status: "ready" }>,
    security: EditorWriteSecurityDeps | undefined,
  ): Promise<void> {
    if (target.targetKind !== "directory") {
      throw new Error("当前编辑器没有返回合法的 Skill 复制目标。")
    }

    const draft = await prepareQuickPublishDraft({
      itemName: payload.source.itemName,
      itemPath: payload.source.itemPath,
      itemType: "skill",
      metadata: payload.source.metadata,
    }, security)

    if (draft.itemType !== "skill") {
      throw new Error("读取 Skill 内容失败。")
    }

    assertUniqueContentAttachmentPaths(draft.files.map((file) => file.originalName))

    await replaceDirectoryAtomically(target.targetPath, async (stagingDirectoryPath) => {
      await writeFile(
        path.join(stagingDirectoryPath, "SKILL.md"),
        normalizeMarkdownContent(draft.content),
        "utf8",
      )

      for (const file of draft.files) {
        const originalName = normalizeContentAttachmentPath(file.originalName)
        if (!originalName) {
          throw new Error("附件文件名不能为空。")
        }

        const targetFilePath = path.join(stagingDirectoryPath, originalName)
        await mkdir(path.dirname(targetFilePath), { recursive: true })
        await writeFile(targetFilePath, file.bytes)
      }
    })
  }
}

const editorCopyService = new EditorCopyService()

export { EditorCopyService, editorCopyService }
