import type { SynapseEditorId } from "../../src/types/editor"
import type { InstallStatusMap } from "../../src/types/install-status"
import type { EditorScanGlobalResult } from "../../src/types/editor-scan"
import { scanAll } from "./editor-scan-service"
import { trashScanItem } from "./editor-scan-service"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("install-status-cache")

let cache: Map<string, SynapseEditorId[]> = new Map()

async function buildCache(): Promise<void> {
  const scan = await scanAll()
  const next = new Map<string, SynapseEditorId[]>()

  for (const globalEntry of scan.global) {
    if (globalEntry.status !== "detected") continue

    for (const skill of globalEntry.skills) {
      if (!skill.synapseContentId) continue
      const existing = next.get(skill.synapseContentId) ?? []
      existing.push(globalEntry.editorId as SynapseEditorId)
      next.set(skill.synapseContentId, existing)
    }

    for (const rule of globalEntry.rules) {
      if (!rule.synapseContentId) continue
      const existing = next.get(rule.synapseContentId) ?? []
      existing.push(globalEntry.editorId as SynapseEditorId)
      next.set(rule.synapseContentId, existing)
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

function getForContent(contentId: string): SynapseEditorId[] {
  return cache.get(contentId) ?? []
}

async function refresh(contentId: string): Promise<SynapseEditorId[]> {
  const scan = await scanAll()
  const editors: SynapseEditorId[] = []

  for (const globalEntry of scan.global) {
    if (globalEntry.status !== "detected") continue

    const foundSkill = globalEntry.skills.find((s) => s.synapseContentId === contentId)
    const foundRule = globalEntry.rules.find((r) => r.synapseContentId === contentId)

    if (foundSkill || foundRule) {
      editors.push(globalEntry.editorId as SynapseEditorId)
    }
  }

  if (editors.length > 0) {
    cache.set(contentId, editors)
  } else {
    cache.delete(contentId)
  }

  return editors
}

export const installStatusCacheService = {
  buildCache,
  getAll,
  getForContent,
  refresh,
}
