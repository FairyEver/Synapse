import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseContentWriteResult,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseContentFile,
  SynapseRuleMeta,
  SynapseSkillMeta,
  SynapseTextContentFile,
} from "@/types/content"

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

export {
  createRule,
  createSkill,
  hasContentBridge,
  readRuleContent,
  readRules,
  readSkillContent,
  readSkillFiles,
  readSkills,
}
