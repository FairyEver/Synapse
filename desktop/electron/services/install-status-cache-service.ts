import type { SynapseEditorId } from "../../src/types/editor"
import type { InstallStatusEntry, InstallStatusMap } from "../../src/types/install-status"
import type {
  EditorScanGlobalResult,
  EditorScanProjectEntry,
  EditorScanProjectResult,
} from "../../src/types/editor-scan"
import { contentService } from "./content-service"
import { scanAll } from "./editor-scan-service"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("install-status-cache")

let cache: Map<string, InstallStatusEntry[]> = new Map()

type SkillVersionMap = Map<string, string>
type RuleContentMap = Map<string, string>

async function loadSkillVersionMap(): Promise<SkillVersionMap> {
  try {
    const skills = await contentService.listContent("skill")
    return new Map(skills.map((skill) => [skill.id, skill.latestHistoryDirname]))
  } catch (error) {
    logger.warn("Failed to load skill versions for install status.", { error })
    return new Map()
  }
}

async function loadRuleContentMap(): Promise<RuleContentMap> {
  const result: RuleContentMap = new Map()
  try {
    const rules = await contentService.listContent("rule")
    await Promise.all(rules.map(async (rule) => {
      try {
        const detail = await contentService.getDetail("rule", rule.id)
        result.set(rule.id, detail.content)
      } catch (error) {
        logger.warn("Failed to load rule content for install status.", { contentId: rule.id, error })
      }
    }))
  } catch (error) {
    logger.warn("Failed to load rule content list for install status.", { error })
  }
  return result
}

function normalizeRuleContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim()
}

function resolveInstallStatus(
  contentId: string | null,
  repositoryVersion: string | null | undefined,
  skillVersions: SkillVersionMap,
): InstallStatusEntry["status"] {
  if (!contentId || !repositoryVersion) {
    return "installed"
  }

  const currentVersion = skillVersions.get(contentId)
  if (!currentVersion) {
    return "installed"
  }

  return currentVersion === repositoryVersion ? "installed" : "needs_update"
}

function resolveRuleInstallStatus(
  contentId: string | null,
  installedContent: string | undefined,
  ruleContents: RuleContentMap,
): InstallStatusEntry["status"] {
  if (!contentId || !installedContent) {
    return "installed"
  }

  const currentContent = ruleContents.get(contentId)
  if (!currentContent) {
    return "installed"
  }

  return normalizeRuleContent(currentContent) === normalizeRuleContent(installedContent) ? "installed" : "needs_update"
}

function appendEntry(
  next: Map<string, InstallStatusEntry[]>,
  contentId: string | null,
  entry: InstallStatusEntry,
): void {
  if (!contentId) return
  const existing = next.get(contentId) ?? []
  const duplicate = existing.some((item) => (
    item.editorId === entry.editorId
    && item.scope === entry.scope
    && item.projectPath === entry.projectPath
  ))
  if (duplicate) return
  next.set(contentId, [...existing, entry])
}

function collectGlobalEntry(
  next: Map<string, InstallStatusEntry[]>,
  globalEntry: EditorScanGlobalResult,
  skillVersions: SkillVersionMap,
  ruleContents: RuleContentMap,
): void {
  if (globalEntry.status !== "detected") return
  const entry: InstallStatusEntry = {
    editorId: globalEntry.editorId as SynapseEditorId,
    scope: "global",
    status: "installed",
  }

  for (const skill of globalEntry.skills) {
    appendEntry(next, skill.synapseContentId, {
      ...entry,
      status: resolveInstallStatus(skill.synapseContentId, skill.repositoryVersion, skillVersions),
    })
  }

  for (const rule of globalEntry.rules) {
    appendEntry(next, rule.synapseContentId, {
      ...entry,
      status: resolveRuleInstallStatus(rule.synapseContentId, rule.content, ruleContents),
    })
  }
}

function collectProjectEntry(
  next: Map<string, InstallStatusEntry[]>,
  project: EditorScanProjectResult,
  editorEntry: EditorScanProjectEntry,
  skillVersions: SkillVersionMap,
  ruleContents: RuleContentMap,
): void {
  const entry: InstallStatusEntry = {
    editorId: editorEntry.editorId as SynapseEditorId,
    projectName: project.projectName,
    projectPath: project.projectPath,
    scope: "project",
    status: "installed",
  }

  for (const skill of editorEntry.skills) {
    appendEntry(next, skill.synapseContentId, {
      ...entry,
      status: resolveInstallStatus(skill.synapseContentId, skill.repositoryVersion, skillVersions),
    })
  }

  for (const rule of editorEntry.rules) {
    appendEntry(next, rule.synapseContentId, {
      ...entry,
      status: resolveRuleInstallStatus(rule.synapseContentId, rule.content, ruleContents),
    })
  }
}

async function buildCache(): Promise<void> {
  const scan = await scanAll()
  const [skillVersions, ruleContents] = await Promise.all([
    loadSkillVersionMap(),
    loadRuleContentMap(),
  ])
  const next = new Map<string, InstallStatusEntry[]>()

  for (const globalEntry of scan.global) {
    collectGlobalEntry(next, globalEntry, skillVersions, ruleContents)
  }

  for (const project of scan.projects) {
    if (!project.pathExists) continue
    for (const editorEntry of project.editors) {
      collectProjectEntry(next, project, editorEntry, skillVersions, ruleContents)
    }
  }

  cache = next
  logger.info(`Cache built. ${cache.size} content items tracked.`)
}

function getAll(): InstallStatusMap {
  const result: InstallStatusMap = {}
  for (const [contentId, editors] of cache) {
    result[contentId] = editors
  }
  return result
}

function getForContent(contentId: string): InstallStatusEntry[] {
  return cache.get(contentId) ?? []
}

function removeGlobalEntry(contentId: string, editorId: string): InstallStatusEntry[] {
  const entries = (cache.get(contentId) ?? [])
    .filter((entry) => entry.scope !== "global" || entry.editorId !== editorId)
  if (entries.length > 0) {
    cache.set(contentId, entries)
  } else {
    cache.delete(contentId)
  }
  return entries
}

async function refresh(contentId: string): Promise<InstallStatusEntry[]> {
  const scan = await scanAll()
  const [skillVersions, ruleContents] = await Promise.all([
    loadSkillVersionMap(),
    loadRuleContentMap(),
  ])
  const next = new Map<string, InstallStatusEntry[]>()

  for (const globalEntry of scan.global) {
    collectGlobalEntry(next, globalEntry, skillVersions, ruleContents)
  }

  for (const project of scan.projects) {
    if (!project.pathExists) continue
    for (const editorEntry of project.editors) {
      collectProjectEntry(next, project, editorEntry, skillVersions, ruleContents)
    }
  }

  const entries = next.get(contentId) ?? []
  if (entries.length > 0) {
    cache.set(contentId, entries)
  } else {
    cache.delete(contentId)
  }

  return entries
}

export const installStatusCacheService = {
  buildCache,
  getAll,
  getForContent,
  removeGlobalEntry,
  refresh,
}
