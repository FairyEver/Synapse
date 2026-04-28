import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseCopyToEditorPayload,
  SynapseEditorCopyResult,
  SynapseEditorCopySource,
  SynapseResolveEditorCopyTargetPayload,
} from "../../src/types/editor-copy"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import type {
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
} from "../../src/types/editor"
import { editorInstallStrategyById } from "./definitions/generated/main-registry"
import { editorAdapterService } from "./editor-adapter-service"
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

const logger = createMainLogger("service.editor-copy")
const MARKDOWN_EXTENSION_PATTERN = /\.(md|mdc)$/iu
const SAFE_RULE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/

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

function isSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right)
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

  if (isSamePath(source.itemPath, target.targetPath)) {
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
        await this.copyRule(payload, target)
      } else {
        await this.copySkill(payload, target)
      }
    } catch (error) {
      recordEditorWriteAudit(security, target.targetPath, "failed", auditMetadata)
      throw formatEditorWriteFailure(error, target.targetPath)
    }

    recordEditorWriteAudit(security, target.targetPath, "allowed", auditMetadata)

    logger.info("Copied scan item to editor target.", {
      contentType: payload.source.itemType,
      sourceEditorId: payload.source.editorId,
      sourcePath: payload.source.itemPath,
      targetEditorId: payload.targetEditorId,
      targetPath: target.targetPath,
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
    })

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
  ): Promise<void> {
    if (target.targetKind !== "directory") {
      throw new Error("当前编辑器没有返回合法的 Skill 复制目标。")
    }

    const draft = await prepareQuickPublishDraft({
      itemName: payload.source.itemName,
      itemPath: payload.source.itemPath,
      itemType: "skill",
      metadata: payload.source.metadata,
    })

    if (draft.itemType !== "skill") {
      throw new Error("读取 Skill 内容失败。")
    }

    await replaceDirectoryAtomically(target.targetPath, async (stagingDirectoryPath) => {
      await writeFile(
        path.join(stagingDirectoryPath, "SKILL.md"),
        normalizeMarkdownContent(draft.content),
        "utf8",
      )

      for (const file of draft.files) {
        const targetFilePath = path.join(stagingDirectoryPath, file.originalName)
        await mkdir(path.dirname(targetFilePath), { recursive: true })
        await writeFile(targetFilePath, file.bytes)
      }
    })
  }
}

const editorCopyService = new EditorCopyService()

export { EditorCopyService, editorCopyService }
