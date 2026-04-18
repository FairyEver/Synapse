import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseContentDetail,
  SynapseContentDownloadResult,
  SynapseContentHistoryEntry,
  SynapseContentHistoryVersion,
  SynapseContentMutationResult,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseDeleteContentPayload,
  SynapseRuleMeta,
  SynapseSkillMeta,
  SynapseTextContentFile,
  SynapseUpdateRulePayload,
  SynapseUpdateSkillPayload,
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

function createRule(payload: SynapseCreateRulePayload): Promise<SynapseContentMutationResult> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.createRule(payload)
}

function createSkill(payload: SynapseCreateSkillPayload): Promise<SynapseContentMutationResult> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.createSkill(payload)
}

function updateRule(payload: SynapseUpdateRulePayload): Promise<SynapseContentMutationResult> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.updateRule(payload)
}

function updateSkill(payload: SynapseUpdateSkillPayload): Promise<SynapseContentMutationResult> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.updateSkill(payload)
}

function deleteContent(payload: SynapseDeleteContentPayload): Promise<SynapseContentMutationResult> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.deleteContent(payload)
}

function readRules(): Promise<SynapseRuleMeta[]> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getRules()
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

function readRuleDetail(ruleId: string): Promise<SynapseContentDetail> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getRuleDetail(ruleId)
}

function readSkillDetail(skillId: string): Promise<SynapseContentDetail> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getSkillDetail(skillId)
}

function readRuleHistory(ruleId: string): Promise<SynapseContentHistoryEntry[]> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getRuleHistory(ruleId)
}

function readSkillHistory(skillId: string): Promise<SynapseContentHistoryEntry[]> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getSkillHistory(skillId)
}

function readRuleHistoryVersion(
  ruleId: string,
  historyDirname: string,
): Promise<SynapseContentHistoryVersion> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getRuleHistoryVersion(ruleId, historyDirname)
}

function readSkillHistoryVersion(
  skillId: string,
  historyDirname: string,
): Promise<SynapseContentHistoryVersion> {
  const bridge = getContentBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getSkillHistoryVersion(skillId, historyDirname)
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
  deleteContent,
  downloadRule,
  downloadSkill,
  getEditorAdapters,
  hasContentBridge,
  installToEditor,
  readRuleContent,
  readRuleDetail,
  readRuleHistory,
  readRuleHistoryVersion,
  readRules,
  readSkillContent,
  readSkillDetail,
  readSkillHistory,
  readSkillHistoryVersion,
  readSkills,
  resolveEditorInstallTarget,
  updateRule,
  updateSkill,
}
