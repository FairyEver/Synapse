import type {
  SynapseEditorInstallStatusEntry,
  SynapseEditorInstallStatusResult,
  SynapseEditorInstallStatusValue,
  SynapseResolveEditorInstallStatusPayload,
} from "../../src/types/editor-install-status"
import type {
  SynapseEditorId,
  SynapseEditorInstallScope,
  SynapseEditorResolvedTarget,
} from "../../src/types/editor"
import type {
  EditorScanGlobalResult,
  EditorScanProjectEntry,
  EditorScanResult,
  EditorScanRuleItem,
  EditorScanSkillItem,
} from "../../src/types/editor-scan"
import { editorAdapterService } from "./editor-adapter-service"
import { editorAdapters } from "./editor-adapters"
import { areSkillContentIdsEquivalent } from "./editor-adapters/skill-identity"
import { scanAll, scanSkillDirectories } from "./editor-scan-service"

function normalizeRuleContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim()
}

function findByContentIdOrName<T extends { synapseContentId: string | null; name: string }>(
  items: T[],
  payload: SynapseResolveEditorInstallStatusPayload,
): T | null {
  return (
    items.find((item) => item.synapseContentId === payload.contentId)
    ?? (payload.contentName ? items.find((item) => item.name === payload.contentName) : undefined)
    ?? null
  )
}

function statusFromRule(
  item: EditorScanRuleItem | null,
  payload: SynapseResolveEditorInstallStatusPayload,
): SynapseEditorInstallStatusValue | null {
  if (!item) return null
  if (item.synapseContentId === null) return "external_same_name"

  if (
    payload.content
    && item.content
    && normalizeRuleContent(payload.content) !== normalizeRuleContent(item.content)
  ) {
    return "needs_update"
  }

  return "installed"
}

function isSynapseSkillContentId(contentId: string | null | undefined): boolean {
  return contentId === "synapse-skill" || contentId === "builtin__skill__synapse-skill"
}

function statusFromSkill(
  item: EditorScanSkillItem | null,
  payload: SynapseResolveEditorInstallStatusPayload,
): SynapseEditorInstallStatusValue | null {
  if (!item) return null
  if (!areSkillContentIdsEquivalent(item.synapseContentId, payload.contentId)) return "external_same_name"

  if (
    payload.sourceFingerprint
    && item.sourceFingerprint
    && item.sourceFingerprint !== payload.sourceFingerprint
  ) {
    return "needs_update"
  }

  if (
    payload.sourceFingerprint
    && !item.sourceFingerprint
    && isSynapseSkillContentId(payload.contentId)
    && isSynapseSkillContentId(item.synapseContentId)
  ) {
    return "needs_update"
  }

  if (
    payload.repositoryVersion
    && item.repositoryVersion
    && item.repositoryVersion !== payload.repositoryVersion
  ) {
    return "needs_update"
  }

  return "installed"
}

function statusFromTarget(target: SynapseEditorResolvedTarget): SynapseEditorInstallStatusValue | null {
  return target.status === "ready" ? null : target.status
}

function targetPathFromTarget(target: SynapseEditorResolvedTarget): string | null {
  return target.status === "unsupported" || target.status === "unavailable" ? null : target.targetPath
}

function findGlobalScan(
  scan: EditorScanResult,
  editorId: SynapseEditorId,
): EditorScanGlobalResult | null {
  return scan.global.find((entry) => entry.editorId === editorId) ?? null
}

function findProjectScan(
  scan: EditorScanResult,
  projectPath: string,
  editorId: SynapseEditorId,
): EditorScanProjectEntry | null {
  const project = scan.projects.find((entry) => entry.projectPath === projectPath)
  return project?.editors.find((entry) => entry.editorId === editorId) ?? null
}

function statusFromScanEntry(
  entry: Pick<EditorScanProjectEntry, "rules" | "skills"> | null,
  payload: SynapseResolveEditorInstallStatusPayload,
): SynapseEditorInstallStatusValue | null {
  if (!entry) return null

  if (payload.contentType === "rule") {
    return statusFromRule(findByContentIdOrName(entry.rules, payload), payload)
  }

  return statusFromSkill(findByContentIdOrName(entry.skills, payload), payload)
}

function createResolvePayload(
  payload: SynapseResolveEditorInstallStatusPayload,
  editorId: SynapseEditorId,
  scope: SynapseEditorInstallScope,
  projectPath?: string,
) {
  return {
    editorId,
    scope,
    contentType: payload.contentType,
    contentId: payload.contentId,
    projectPath,
    skillName: payload.contentType === "skill" ? payload.contentName : undefined,
    skillTitle: payload.contentType === "skill" ? payload.title : undefined,
    ruleName: payload.contentType === "rule" ? payload.contentName : undefined,
  }
}

function createEntry(params: {
  editorId: SynapseEditorId
  editorLabel: string
  scope: SynapseEditorInstallScope
  target: SynapseEditorResolvedTarget
  scanStatus: SynapseEditorInstallStatusValue | null
  projectId?: string
  projectName?: string
}): SynapseEditorInstallStatusEntry {
  return {
    editorId: params.editorId,
    editorLabel: params.editorLabel,
    scope: params.scope,
    projectId: params.projectId,
    projectName: params.projectName,
    status: statusFromTarget(params.target) ?? params.scanStatus ?? "not_installed",
    targetPath: targetPathFromTarget(params.target),
    message: params.target.message,
  }
}

export class EditorInstallStatusService {
  async resolveGlobalSkillInstallations(
    payload: SynapseResolveEditorInstallStatusPayload,
  ): Promise<SynapseEditorInstallStatusResult> {
    if (payload.contentType !== "skill") {
      throw new Error("全局 Skill 安装检测只支持 Skill。")
    }

    const adapters = editorAdapters.filter(
      (adapter) => adapter.supportsGlobal && adapter.supportedContentTypes.includes("skill"),
    )
    const entries = await Promise.all(adapters.map(async (adapter) => {
      const config = adapter.getScanPathConfig()
      const globalSkillPaths = config.globalSkillPaths
        ?? (config.globalSkillsPath ? [config.globalSkillsPath] : [])
      const [target, scan] = await Promise.all([
        editorAdapterService.resolveTarget(createResolvePayload(payload, adapter.id, "global")),
        scanSkillDirectories(globalSkillPaths),
      ])
      if (scan.skillScanError) {
        throw new Error(`${adapter.label} 全局 Skill 检测失败：${scan.skillScanError}`)
      }

      return createEntry({
        editorId: adapter.id,
        editorLabel: adapter.label,
        scope: "global",
        target,
        scanStatus: statusFromSkill(findByContentIdOrName(scan.skills, payload), payload),
      })
    }))

    return { entries }
  }

  async resolveForContent(
    payload: SynapseResolveEditorInstallStatusPayload,
  ): Promise<SynapseEditorInstallStatusResult> {
    const scan = await scanAll()
    const entries: SynapseEditorInstallStatusEntry[] = []

    for (const adapter of editorAdapters) {
      const globalTarget = await editorAdapterService.resolveTarget(
        createResolvePayload(payload, adapter.id, "global"),
      )
      const globalScan = findGlobalScan(scan, adapter.id)

      entries.push(createEntry({
        editorId: adapter.id,
        editorLabel: adapter.label,
        scope: "global",
        target: globalTarget,
        scanStatus: statusFromScanEntry(globalScan, payload),
      }))

      for (const project of payload.projects) {
        const projectTarget = await editorAdapterService.resolveTarget(
          createResolvePayload(payload, adapter.id, "project", project.path),
        )
        const projectScan = findProjectScan(scan, project.path, adapter.id)

        entries.push(createEntry({
          editorId: adapter.id,
          editorLabel: adapter.label,
          scope: "project",
          projectId: project.id,
          projectName: project.name,
          target: projectTarget,
          scanStatus: statusFromScanEntry(projectScan, payload),
        }))
      }
    }

    return { entries }
  }
}

export const editorInstallStatusService = new EditorInstallStatusService()
