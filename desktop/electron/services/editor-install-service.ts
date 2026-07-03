import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import type {
  SynapseContentInstallResult,
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
  SynapseReadEditorInstallFormValuesPayload,
  SynapseReadEditorInstallFormValuesResult,
  SynapseResolveEditorTargetPayload,
} from "../../src/types/editor"
import type { SynapseInstallSourceToEditorPayload } from "../../src/types/installers"
import type { SynapseContentDetail } from "../../src/types/content"
import { configStore } from "./config-store"
import { editorAdapterService } from "./editor-adapter-service"
import { editorInstallStrategyById } from "./definitions/generated/main-registry"
import { readExistingTextFile } from "./editor-file-write-utils"
import { EditorInstallCore } from "./editor-install-core"
import {
  assertTrustedInstallFormTarget,
  isSameEditorPath,
} from "./editor-install-target-security"
import type { EditorWriteSecurityDeps } from "./editor-write-security"
import { installerSourceService } from "./installer-source-service"

type EditorReadSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

export type PreparedContentInstallSourceProvider = {
  hasPreparedSource?(sourceId: string, contentId: string): boolean
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

type EditorInstallServiceDeps = {
  readonly preparedSourceProvider?: PreparedContentInstallSourceProvider
}

const unavailablePreparedSourceProvider: PreparedContentInstallSourceProvider = {
  hasPreparedSource() {
    return false
  },
  async readPreparedRule() {
    throw new Error("安装源尚未初始化。")
  },
  async readPreparedSkill() {
    throw new Error("安装源尚未初始化。")
  },
  async beginPreparedInstall() {
    throw new Error("安装源尚未初始化。")
  },
  async endPreparedInstall() {
    throw new Error("安装源尚未初始化。")
  },
  async copyPreparedSkillAttachment() {
    throw new Error("安装源尚未初始化。")
  },
  async markPreparedInstalled() {
    throw new Error("安装源尚未初始化。")
  },
}

const UNTRUSTED_PROJECT_PATH_ERROR = "项目路径不在已配置项目中。"

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

async function assertConfiguredProjectPath(
  payload: SynapseResolveEditorTargetPayload,
): Promise<void> {
  if (payload.scope !== "project") return
  if (!payload.projectPath?.trim()) {
    throw new Error("项目路径为空，无法解析项目安装位置。")
  }

  const config = await configStore.load()
  const isConfigured = config.global.projects.some((project) => isSameEditorPath(project.path, payload.projectPath ?? ""))
  if (!isConfigured) {
    throw new Error(UNTRUSTED_PROJECT_PATH_ERROR)
  }
}

function createCompositePreparedSourceProvider(
  providers: readonly PreparedContentInstallSourceProvider[],
): PreparedContentInstallSourceProvider {
  function resolve(sourceId: string, contentId: string): PreparedContentInstallSourceProvider {
    const provider = providers.find((candidate) => candidate.hasPreparedSource?.(sourceId, contentId))
    if (provider) return provider
    return providers[providers.length - 1] ?? unavailablePreparedSourceProvider
  }

  return {
    hasPreparedSource(sourceId, contentId) {
      return providers.some((provider) => provider.hasPreparedSource?.(sourceId, contentId))
    },
    readPreparedRule(sourceId, contentId) {
      return resolve(sourceId, contentId).readPreparedRule(sourceId, contentId)
    },
    readPreparedSkill(sourceId, contentId) {
      return resolve(sourceId, contentId).readPreparedSkill(sourceId, contentId)
    },
    beginPreparedInstall(sourceId, contentId) {
      return resolve(sourceId, contentId).beginPreparedInstall(sourceId, contentId)
    },
    endPreparedInstall(sourceId, contentId) {
      return resolve(sourceId, contentId).endPreparedInstall(sourceId, contentId)
    },
    copyPreparedSkillAttachment(sourceId, contentId, relativePath, targetPath) {
      return resolve(sourceId, contentId).copyPreparedSkillAttachment(sourceId, contentId, relativePath, targetPath)
    },
    markPreparedInstalled(sourceId, contentId) {
      return resolve(sourceId, contentId).markPreparedInstalled(sourceId, contentId)
    },
  }
}

export class EditorInstallService {
  private preparedSourceProvider: PreparedContentInstallSourceProvider
  private readonly preparedSourceProviders: PreparedContentInstallSourceProvider[] = []

  constructor(deps: EditorInstallServiceDeps = {}) {
    this.preparedSourceProvider = deps.preparedSourceProvider ?? unavailablePreparedSourceProvider
  }

  setPreparedSourceProvider(provider: PreparedContentInstallSourceProvider): void {
    this.preparedSourceProvider = provider
    this.preparedSourceProviders.splice(0, this.preparedSourceProviders.length, provider)
  }

  addPreparedSourceProvider(provider: PreparedContentInstallSourceProvider): void {
    if (!this.preparedSourceProviders.includes(provider)) {
      this.preparedSourceProviders.push(provider)
    }
    this.preparedSourceProvider = createCompositePreparedSourceProvider(this.preparedSourceProviders)
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
    const core = new EditorInstallCore({
      installerSourceProvider: installerSourceService,
      preparedSourceProvider: this.preparedSourceProvider,
      resolveEditorInstallTarget: (nextPayload) => this.resolveEditorInstallTarget(nextPayload),
    })
    return core.installToEditor(payload, security)
  }

  async installSourceToEditor(
    payload: SynapseInstallSourceToEditorPayload,
    security?: EditorWriteSecurityDeps,
  ): Promise<SynapseContentInstallResult> {
    const core = new EditorInstallCore({
      installerSourceProvider: installerSourceService,
      preparedSourceProvider: this.preparedSourceProvider,
      resolveEditorInstallTarget: (nextPayload) => this.resolveEditorInstallTarget(nextPayload),
    })
    return core.installSourceToEditor(payload, security)
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

export const editorInstallService = new EditorInstallService()
