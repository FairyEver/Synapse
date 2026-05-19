import os from "node:os"
import path from "node:path"
import { USAGE_ANALYSIS_CHANNELS } from "./channels"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { getUsageAnalysisDb, CcUsageAnalysisService, CodexUsageAnalysisService } from "../services/usage-analysis"
import type { UsageDetailInput, UsageRangeInput } from "../services/usage-analysis"

let registered = false

function normalizeRange(range: UsageRangeInput | undefined): UsageRangeInput {
  if (range?.preset === "7d" || range?.preset === "30d" || range?.preset === "90d" || range?.preset === "all") {
    return range
  }
  return { preset: "30d" }
}

function normalizeDetailsRange(range: UsageDetailInput | undefined): UsageDetailInput {
  const normalized = normalizeRange(range)
  const limit = Number(range?.limit)
  const offset = Number(range?.offset)
  return {
    ...normalized,
    limit: Number.isFinite(limit) ? limit : 200,
    offset: Number.isFinite(offset) ? offset : 0,
  }
}

export function registerUsageAnalysisHandlers(): void {
  if (registered) return
  const db = getUsageAnalysisDb()
  const home = os.homedir()
  const cc = new CcUsageAnalysisService({
    db,
    roots: [path.join(home, ".claude", "projects")],
  })
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex")
  const codex = new CodexUsageAnalysisService({
    db,
    roots: [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")],
  })

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccRefresh, async () => cc.refresh())
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccOverview, async (_event, range?: UsageRangeInput) => cc.getOverview(normalizeRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTime, async (_event, range?: UsageRangeInput) => cc.getTime(normalizeRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccModels, async (_event, range?: UsageRangeInput) => cc.getModels(normalizeRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccProjects, async (_event, range?: UsageRangeInput) => cc.getProjects(normalizeRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTools, async (_event, range?: UsageRangeInput) => cc.getTools(normalizeRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccDetails, async (_event, range?: UsageDetailInput) => cc.getDetails(normalizeDetailsRange(range)))

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexRefresh, async () => codex.refresh())
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexOverview, async (_event, range?: UsageRangeInput) => codex.getOverview(normalizeRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexTime, async (_event, range?: UsageRangeInput) => codex.getTime(normalizeRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexModels, async (_event, range?: UsageRangeInput) => codex.getModels(normalizeRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexProjects, async (_event, range?: UsageRangeInput) => codex.getProjects(normalizeRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexTools, async (_event, range?: UsageRangeInput) => codex.getTools(normalizeRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexDetails, async (_event, range?: UsageDetailInput) => codex.getDetails(normalizeDetailsRange(range)))

  registered = true
}
