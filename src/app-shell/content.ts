import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseContentDownloadResult,
  SynapseContentWriteResult,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseContentFile,
  SynapseRuleMeta,
  SynapseSkillMeta,
  SynapseTextContentFile,
} from "@/types/content"
import type {
  SynapseEditorAdapterSummary,
  SynapseContentInstallResult,
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
  SynapseResolveEditorTargetPayload,
} from "@/types/editor"

const DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的内容桥接。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

type RendererContentBridge = NonNullable<Window["synapse"]>["content"]

function getContentBridge(): RendererContentBridge | undefined {
  return getSynapseBridge()?.content
}

function hasContentBridge(): boolean {
  return Boolean(getContentBridge())
}

function readRules(): Promise<SynapseRuleMeta[]> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getRules()
}

function createRule(payload: SynapseCreateRulePayload): Promise<SynapseContentWriteResult> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.createRule(payload)
}

function createSkill(payload: SynapseCreateSkillPayload): Promise<SynapseContentWriteResult> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.createSkill(payload)
}

function downloadRule(ruleId: string): Promise<SynapseContentDownloadResult> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.downloadRule(ruleId)
}

function downloadSkill(skillId: string): Promise<SynapseContentDownloadResult> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.downloadSkill(skillId)
}

function getEditorAdapters(): Promise<SynapseEditorAdapterSummary[]> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getEditorAdapters()
}

function readSkills(): Promise<SynapseSkillMeta[]> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getSkills()
}

function readRuleContent(ruleId: string): Promise<SynapseTextContentFile> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getRuleContent(ruleId)
}

function readSkillContent(skillId: string): Promise<SynapseTextContentFile> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getSkillContent(skillId)
}

function readSkillFiles(skillId: string): Promise<SynapseContentFile[]> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getSkillFiles(skillId)
}

function installToEditor(
  payload: SynapseInstallToEditorPayload,
): Promise<SynapseContentInstallResult> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.installToEditor(payload)
}

function resolveEditorInstallTarget(
  payload: SynapseResolveEditorTargetPayload,
): Promise<SynapseEditorResolvedTarget> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.resolveEditorInstallTarget(payload)
}

export {
  createRule,
  createSkill,
  downloadRule,
  downloadSkill,
  getEditorAdapters,
  hasContentBridge,
  installToEditor,
  readRuleContent,
  readRules,
  readSkillContent,
  readSkillFiles,
  readSkills,
  resolveEditorInstallTarget,
}
