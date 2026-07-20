import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseContentDetail,
  SynapseContentDownloadResult,
  SynapseContentFile,
  SynapseContentMeta,
  SynapseContentMutationResult,
  SynapseOpenContentCreateWindowPayload,
  SynapseOpenContentEditWindowPayload,
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
  SynapseReadEditorInstallFormValuesPayload,
  SynapseReadEditorInstallFormValuesResult,
  SynapseResolveEditorTargetPayload,
} from "@/types/editor"

const DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的内容桥接。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

type RendererContentBridge = NonNullable<Window["synapse"]>["resourceRepository"]

function getContentBridge(): RendererContentBridge | undefined {
  return getSynapseBridge()?.resourceRepository
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
  return requireContentBridge().item.list({ contentType })
}

async function readContent(
  contentType: SynapseContentType,
  id: string,
): Promise<SynapseTextContentFile> {
  return requireContentBridge().operation.getContent({ contentType, id })
}

async function readDetail(
  contentType: SynapseContentType,
  id: string,
): Promise<SynapseContentDetail> {
  return requireContentBridge().operation.getDetail({ contentType, id })
}

async function readAttachmentFile(args: {
  contentType: SynapseContentType
  historyDirname: string
  id: string
  originalName: string
}): Promise<SynapseContentFile | null> {
  return requireContentBridge().operation.getAttachmentFile(args)
}

async function createContent<T extends SynapseContentType>(
  contentType: T,
  payload: SynapseCreateContentPayload<T>,
): Promise<SynapseContentMutationResult> {
  return requireContentBridge().item.create({
    contentType,
    payload,
  } as SynapseCreateContentRequest<T>)
}

async function updateContent<T extends SynapseContentType>(
  contentType: T,
  payload: SynapseUpdateContentPayload<T>,
): Promise<SynapseContentMutationResult> {
  return requireContentBridge().item.update({
    contentType,
    payload,
  } as SynapseUpdateContentRequest<T>)
}

async function deleteContent(payload: SynapseDeleteContentPayload): Promise<SynapseContentMutationResult> {
  return requireContentBridge().operation.deleteContent(payload)
}

async function listDeletedContent<T extends SynapseContentType>(
  contentType: T,
): Promise<SynapseContentMeta<T>[]> {
  return requireContentBridge().operation.listDeleted({ contentType })
}

async function restoreContent(payload: SynapseRestoreContentPayload): Promise<SynapseContentMutationResult> {
  return requireContentBridge().item.restore(payload)
}

async function purgeContent(payload: SynapsePurgeContentPayload): Promise<SynapseContentMutationResult> {
  return requireContentBridge().item.purge(payload)
}

async function downloadContent(
  contentType: SynapseContentType,
  id: string,
): Promise<SynapseContentDownloadResult> {
  return requireContentBridge().item.download({ contentType, id })
}

async function openContentDetailWindow(payload: SynapseOpenContentWindowPayload): Promise<void> {
  return requireContentBridge().operation.openDetailWindow(payload)
}

async function openContentCreateWindow(payload: SynapseOpenContentCreateWindowPayload): Promise<void> {
  return requireContentBridge().operation.openCreateWindow(payload)
}

async function openContentEditWindow(payload: SynapseOpenContentEditWindowPayload): Promise<void> {
  return requireContentBridge().operation.openEditWindow(payload)
}

async function readContentEditorInitPayload(
  requestId: string,
): Promise<SynapseOpenContentCreateWindowPayload | SynapseOpenContentEditWindowPayload | null> {
  return requireContentBridge().operation.readEditorInitPayload({ requestId })
}

async function getEditorAdapters(): Promise<SynapseEditorAdapterSummary[]> {
  return requireContentBridge().operation.getEditorAdapters()
}

async function installToEditor(
  payload: SynapseInstallToEditorPayload,
): Promise<SynapseContentInstallResult> {
  return requireContentBridge().operation.installToEditor(payload)
}

async function resolveEditorInstallTarget(
  payload: SynapseResolveEditorTargetPayload,
): Promise<SynapseEditorResolvedTarget> {
  return requireContentBridge().operation.resolveEditorInstallTarget(payload)
}

async function readEditorInstallFormValues(
  payload: SynapseReadEditorInstallFormValuesPayload,
): Promise<SynapseReadEditorInstallFormValuesResult> {
  return requireContentBridge().operation.readEditorInstallFormValues(payload)
}

const createRule = (payload: SynapseCreateRulePayload) => createContent("rule", payload)
const createSkill = (payload: SynapseCreateSkillPayload) => createContent("skill", payload)
const updateRule = (payload: SynapseUpdateRulePayload) => updateContent("rule", payload)
const updateSkill = (payload: SynapseUpdateSkillPayload) => updateContent("skill", payload)

async function getIconPromptTemplate(
  contentType: SynapseContentType,
  id: string,
): Promise<string | null> {
  return requireContentBridge().operation.getIconPromptTemplate({ contentType, id })
}

const readRules = () => listContent("rule")
const readSkills = () => listContent("skill")
const readRuleContent = (ruleId: string) => readContent("rule", ruleId)
const readSkillContent = (skillId: string) => readContent("skill", skillId)
const readRuleDetail = (ruleId: string) => readDetail("rule", ruleId)
const readSkillDetail = (skillId: string) => readDetail("skill", skillId)
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
  getIconPromptTemplate,
  hasContentBridge,
  installToEditor,
  listContent,
  listDeletedContent,
  openContentCreateWindow,
  openContentDetailWindow,
  openContentEditWindow,
  readEditorInstallFormValues,
  purgeContent,
  readContent,
  readContentEditorInitPayload,
  readAttachmentFile,
  readDetail,
  readRuleContent,
  readRuleDetail,
  readRules,
  readSkillContent,
  readSkillDetail,
  readSkills,
  resolveEditorInstallTarget,
  restoreContent,
  updateContent,
  updateRule,
  updateSkill,
}
