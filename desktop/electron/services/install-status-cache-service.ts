import type { SynapseEditorId } from "../../src/types/editor"
import type { InstallStatusEntry, InstallStatusMap } from "../../src/types/install-status"
import type {
  EditorScanGlobalResult,
  EditorScanProjectEntry,
  EditorScanProjectResult,
} from "../../src/types/editor-scan"
import { scanAll } from "./editor-scan-service"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("install-status-cache")

let cache: Map<string, InstallStatusEntry[]> = new Map()

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
): void {
  if (globalEntry.status !== "detected") return
  const entry: InstallStatusEntry = {
    editorId: globalEntry.editorId as SynapseEditorId,
    scope: "global",
  }

  for (const skill of globalEntry.skills) {
    appendEntry(next, skill.synapseContentId, entry)
  }

  for (const rule of globalEntry.rules) {
    appendEntry(next, rule.synapseContentId, entry)
  }
}

function collectProjectEntry(
  next: Map<string, InstallStatusEntry[]>,
  project: EditorScanProjectResult,
  editorEntry: EditorScanProjectEntry,
): void {
  const entry: InstallStatusEntry = {
    editorId: editorEntry.editorId as SynapseEditorId,
    projectName: project.projectName,
    projectPath: project.projectPath,
    scope: "project",
  }

  for (const skill of editorEntry.skills) {
    appendEntry(next, skill.synapseContentId, entry)
  }

  for (const rule of editorEntry.rules) {
    appendEntry(next, rule.synapseContentId, entry)
  }
}

async function buildCache(): Promise<void> {
  const scan = await scanAll()
  const next = new Map<string, InstallStatusEntry[]>()

  for (const globalEntry of scan.global) {
    collectGlobalEntry(next, globalEntry)
  }

  for (const project of scan.projects) {
    if (!project.pathExists) continue
    for (const editorEntry of project.editors) {
      collectProjectEntry(next, project, editorEntry)
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

async function refresh(contentId: string): Promise<InstallStatusEntry[]> {
  const scan = await scanAll()
  const next = new Map<string, InstallStatusEntry[]>()

  for (const globalEntry of scan.global) {
    collectGlobalEntry(next, globalEntry)
  }

  for (const project of scan.projects) {
    if (!project.pathExists) continue
    for (const editorEntry of project.editors) {
      collectProjectEntry(next, project, editorEntry)
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
  refresh,
}
