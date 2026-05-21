import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { USAGE_ANALYSIS_CHANNELS } from "./channels"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { getUsageAnalysisDb, CcUsageAnalysisService, CodexUsageAnalysisService } from "../services/usage-analysis"
import type { UsageDetailInput, UsageRangeInput } from "../services/usage-analysis"

let registered = false

type UsageRangeIpcPayload = {
  readonly preset?: unknown
  readonly bucket?: unknown
}

export function normalizeUsageRangeForIpc(range: UsageRangeIpcPayload | undefined): UsageRangeInput {
  const preset = range?.preset
  if (preset === "today" || preset === "7d" || preset === "30d" || preset === "90d" || preset === "all") {
    const bucket = range?.bucket
    if (bucket === "day" || bucket === "hour") {
      return { preset, bucket }
    }
    return { preset }
  }
  return { preset: "30d" }
}

function normalizeDetailsRange(range: UsageDetailInput | undefined): UsageDetailInput {
  const normalized = normalizeUsageRangeForIpc(range)
  const limit = Number(range?.limit)
  const offset = Number(range?.offset)
  return {
    ...normalized,
    limit: Number.isFinite(limit) ? limit : 200,
    offset: Number.isFinite(offset) ? offset : 0,
  }
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)]
}

function splitPathList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function collectProjectsDirs(root: string, maxDepth = 5): string[] {
  if (maxDepth < 0) return []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }

  const roots: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const fullPath = path.join(root, entry.name)
    if (entry.name === "projects") {
      roots.push(fullPath)
      continue
    }
    roots.push(...collectProjectsDirs(fullPath, maxDepth - 1))
  }
  return roots
}

function claudeDesktopDataRoots(home: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const targetPath = pathForPlatform(platform)
  if (platform === "darwin") {
    const appData = targetPath.join(home, "Library", "Application Support", "Claude")
    return [
      targetPath.join(appData, "local-agent-mode-sessions"),
      targetPath.join(appData, "claude-code-sessions"),
    ]
  }
  if (platform === "win32") {
    const appData = env.APPDATA || targetPath.join(home, "AppData", "Roaming")
    return [
      targetPath.join(appData, "Claude", "local-agent-mode-sessions"),
      targetPath.join(appData, "Claude", "claude-code-sessions"),
    ]
  }
  const configHome = env.XDG_CONFIG_HOME || targetPath.join(home, ".config")
  return [
    targetPath.join(configHome, "Claude", "local-agent-mode-sessions"),
    targetPath.join(configHome, "Claude", "claude-code-sessions"),
  ]
}

export function resolveClaudeUsageRoots({
  home,
  env = process.env,
  platform = process.platform,
}: {
  readonly home: string
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
}): string[] {
  const targetPath = pathForPlatform(platform)
  const configRoots = splitPathList(env.CLAUDE_CONFIG_DIR).map((root) => targetPath.join(root, "projects"))
  const cliRoots = [targetPath.join(home, ".claude", "projects"), ...configRoots]
  const desktopRoots = claudeDesktopDataRoots(home, env, platform).flatMap((root) => collectProjectsDirs(root))
  return uniquePaths([...cliRoots, ...desktopRoots])
}

function pathForPlatform(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix
}

export function registerUsageAnalysisHandlers(): void {
  if (registered) return
  const db = getUsageAnalysisDb()
  const home = os.homedir()
  const cc = new CcUsageAnalysisService({
    db,
    roots: resolveClaudeUsageRoots({ home }),
  })
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex")
  const codex = new CodexUsageAnalysisService({
    db,
    roots: [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")],
  })

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccRefresh, async () => {
    return new CcUsageAnalysisService({
      db,
      roots: resolveClaudeUsageRoots({ home }),
    }).refresh()
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccOverview, async (_event, range?: UsageRangeInput) => cc.getOverview(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTime, async (_event, range?: UsageRangeInput) => cc.getTime(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccModels, async (_event, range?: UsageRangeInput) => cc.getModels(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccProjects, async (_event, range?: UsageRangeInput) => cc.getProjects(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTools, async (_event, range?: UsageRangeInput) => cc.getTools(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccDetails, async (_event, range?: UsageDetailInput) => cc.getDetails(normalizeDetailsRange(range)))

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexRefresh, async () => codex.refresh())
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexOverview, async (_event, range?: UsageRangeInput) => codex.getOverview(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexTime, async (_event, range?: UsageRangeInput) => codex.getTime(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexModels, async (_event, range?: UsageRangeInput) => codex.getModels(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexProjects, async (_event, range?: UsageRangeInput) => codex.getProjects(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexTools, async (_event, range?: UsageRangeInput) => codex.getTools(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexDetails, async (_event, range?: UsageDetailInput) => codex.getDetails(normalizeDetailsRange(range)))

  registered = true
}
