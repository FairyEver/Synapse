import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseContentDetail,
  SynapseContentDownloadResult,
  SynapseContentHistoryEntry,
  SynapseContentHistoryVersion,
  SynapseContentMeta,
  SynapseContentMutationResult,
  SynapseOpenContentWindowPayload,
  SynapseContentType,
  SynapseCreateContentRequest,
  SynapseCreateContentPayload,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseDeleteContentPayload,
  SynapsePurgeContentPayload,
  SynapseRestoreContentPayload,
  SynapseTextContentFile,
  SynapseUpdateContentRequest,
  SynapseUpdateContentPayload,
  SynapseUpdateRulePayload,
  SynapseUpdateSkillPayload,
} from "@/types/content"
import type {
  SynapseEditorAdapterSummary,
  SynapseContentInstallResult,
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
  SynapsePeekClaudeCodeFrontmatterPayload,
  SynapsePeekClaudeCodeFrontmatterResult,
  SynapsePeekCursorFrontmatterPayload,
  SynapsePeekCursorFrontmatterResult,
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

function requireContentBridge(): RendererContentBridge {
  const bridge = getContentBridge()

  if (!bridge) {
    throw createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE)
  }

  return bridge
}

async function listContent<T extends SynapseContentType>(
  contentType: T,
): Promise<SynapseContentMeta<T>[]> {
  return requireContentBridge().list({ contentType })
}

async function readContent(
  contentType: SynapseContentType,
  id: string,
): Promise<SynapseTextContentFile> {
  return requireContentBridge().getContent({ contentType, id })
}

async function readDetail(
  contentType: SynapseContentType,
  id: string,
): Promise<SynapseContentDetail> {
  return requireContentBridge().getDetail({ contentType, id })
}

async function readHistory(
  contentType: SynapseContentType,
  id: string,
): Promise<SynapseContentHistoryEntry[]> {
  return requireContentBridge().getHistory({ contentType, id })
}

async function readHistoryVersion(
  contentType: SynapseContentType,
  id: string,
  historyDirname: string,
): Promise<SynapseContentHistoryVersion> {
  return requireContentBridge().getHistoryVersion({ contentType, id, historyDirname })
}

async function createContent<T extends SynapseContentType>(
  contentType: T,
  payload: SynapseCreateContentPayload<T>,
): Promise<SynapseContentMutationResult> {
  return requireContentBridge().create({
    contentType,
    payload,
  } as SynapseCreateContentRequest<T>)
}

async function updateContent<T extends SynapseContentType>(
  contentType: T,
  payload: SynapseUpdateContentPayload<T>,
): Promise<SynapseContentMutationResult> {
  return requireContentBridge().update({
    contentType,
    payload,
  } as SynapseUpdateContentRequest<T>)
}

async function deleteContent(payload: SynapseDeleteContentPayload): Promise<SynapseContentMutationResult> {
  return requireContentBridge().deleteContent(payload)
}

async function listDeletedContent<T extends SynapseContentType>(
  contentType: T,
): Promise<SynapseContentMeta<T>[]> {
  return requireContentBridge().listDeleted({ contentType })
}

async function restoreContent(payload: SynapseRestoreContentPayload): Promise<SynapseContentMutationResult> {
  return requireContentBridge().restore(payload)
}

async function purgeContent(payload: SynapsePurgeContentPayload): Promise<SynapseContentMutationResult> {
  return requireContentBridge().purge(payload)
}

async function downloadContent(
  contentType: SynapseContentType,
  id: string,
): Promise<SynapseContentDownloadResult> {
  return requireContentBridge().download({ contentType, id })
}

async function openContentDetailWindow(payload: SynapseOpenContentWindowPayload): Promise<void> {
  return requireContentBridge().openDetailWindow(payload)
}

async function getEditorAdapters(): Promise<SynapseEditorAdapterSummary[]> {
  return requireContentBridge().getEditorAdapters()
}

async function installToEditor(
  payload: SynapseInstallToEditorPayload,
): Promise<SynapseContentInstallResult> {
  return requireContentBridge().installToEditor(payload)
}

async function resolveEditorInstallTarget(
  payload: SynapseResolveEditorTargetPayload,
): Promise<SynapseEditorResolvedTarget> {
  return requireContentBridge().resolveEditorInstallTarget(payload)
}

async function peekCursorFrontmatter(
  payload: SynapsePeekCursorFrontmatterPayload,
): Promise<SynapsePeekCursorFrontmatterResult> {
  return requireContentBridge().peekCursorFrontmatter(payload)
}

async function peekClaudeCodeFrontmatter(
  payload: SynapsePeekClaudeCodeFrontmatterPayload,
): Promise<SynapsePeekClaudeCodeFrontmatterResult> {
  return requireContentBridge().peekClaudeCodeFrontmatter(payload)
}

const createRule = (payload: SynapseCreateRulePayload) => createContent("rule", payload)
const createSkill = (payload: SynapseCreateSkillPayload) => createContent("skill", payload)
const updateRule = (payload: SynapseUpdateRulePayload) => updateContent("rule", payload)
const updateSkill = (payload: SynapseUpdateSkillPayload) => updateContent("skill", payload)
const readRules = () => listContent("rule")
const readSkills = () => listContent("skill")
const readRuleContent = (ruleId: string) => readContent("rule", ruleId)
const readSkillContent = (skillId: string) => readContent("skill", skillId)
const readRuleDetail = (ruleId: string) => readDetail("rule", ruleId)
const readSkillDetail = (skillId: string) => readDetail("skill", skillId)
const readRuleHistory = (ruleId: string) => readHistory("rule", ruleId)
const readSkillHistory = (skillId: string) => readHistory("skill", skillId)
const readRuleHistoryVersion = (ruleId: string, historyDirname: string) =>
  readHistoryVersion("rule", ruleId, historyDirname)
const readSkillHistoryVersion = (skillId: string, historyDirname: string) =>
  readHistoryVersion("skill", skillId, historyDirname)
const downloadRule = (ruleId: string) => downloadContent("rule", ruleId)
const downloadSkill = (skillId: string) => downloadContent("skill", skillId)

export {
  createContent,
  createRule,
  createSkill,
  deleteContent,
  downloadContent,
  downloadRule,
  downloadSkill,
  getEditorAdapters,
  hasContentBridge,
  installToEditor,
  listContent,
  listDeletedContent,
  openContentDetailWindow,
  peekClaudeCodeFrontmatter,
  peekCursorFrontmatter,
  purgeContent,
  readContent,
  readDetail,
  readHistory,
  readHistoryVersion,
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
  restoreContent,
  updateContent,
  updateRule,
  updateSkill,
}
