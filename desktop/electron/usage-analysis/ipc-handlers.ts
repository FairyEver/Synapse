import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { app } from "electron"
import { USAGE_ANALYSIS_CHANNELS } from "./channels"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import {
  getUsageAnalysisDb,
  getUsageAnalysisDbPath,
  CcConversationService,
  CcUsageAnalysisService,
  CodexUsageAnalysisService,
  refreshUsageInWorker,
} from "../services/usage-analysis"
import type { UsageDetailInput, UsageModelPriceRuleInput, UsageRangeInput } from "../services/usage-analysis"
import { ccConversationWindowService } from "../services/usage-analysis/cc-conversation-window-service"
import type {
  CcConversationFocus,
  CcConversationListInput,
  CcConversationWindowRequest,
} from "../../src/types/usage-analysis-conversations"

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

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function normalizeConversationListInput(input: CcConversationListInput | undefined): CcConversationListInput {
  const range = normalizeUsageRangeForIpc(input)
  const limit = Number(input?.limit)
  const offset = Number(input?.offset)

  return {
    ...range,
    query: optionalString(input?.query),
    rawText: input?.rawText === true,
    project: optionalString(input?.project),
    model: optionalString(input?.model),
    tool: optionalString(input?.tool),
    eventType: optionalString(input?.eventType),
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
    cursor: optionalString(input?.cursor),
  }
}

export function normalizeConversationFocus(focus: CcConversationFocus | undefined): CcConversationFocus | undefined {
  if (!focus) return undefined
  const timestampMs = Number(focus.timestampMs)
  const normalized: CcConversationFocus = {
    eventId: optionalString(focus.eventId),
    usageEventId: optionalString(focus.usageEventId),
    toolEventId: optionalString(focus.toolEventId),
    timestampMs: Number.isFinite(timestampMs) ? Math.trunc(timestampMs) : undefined,
  }

  if (!normalized.eventId && !normalized.usageEventId && !normalized.toolEventId && normalized.timestampMs === undefined) {
    return undefined
  }

  return normalized
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
  const userDataPath = app.getPath("userData")
  const db = getUsageAnalysisDb(userDataPath)
  const dbPath = getUsageAnalysisDbPath(userDataPath)
  const home = os.homedir()
  const ccRoots = resolveClaudeUsageRoots({ home })
  const cc = new CcUsageAnalysisService({
    db,
    roots: ccRoots,
  })
  const ccConversations = new CcConversationService({ db })
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex")
  const codexRoots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")]
  const codex = new CodexUsageAnalysisService({
    db,
    roots: codexRoots,
  })

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccRefresh, async () => {
    return refreshUsageInWorker({
      dbPath,
      prefix: "cc",
      roots: ccRoots,
    })
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccOverview, async (_event, range?: UsageRangeInput) => cc.getOverview(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTime, async (_event, range?: UsageRangeInput) => cc.getTime(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccModels, async (_event, range?: UsageRangeInput) => cc.getModels(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccProjects, async (_event, range?: UsageRangeInput) => cc.getProjects(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTools, async (_event, range?: UsageRangeInput) => cc.getTools(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccDetails, async (_event, range?: UsageDetailInput) => cc.getDetails(normalizeDetailsRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationsList, async (_event, input?: CcConversationListInput) => {
    return ccConversations.listConversations(normalizeConversationListInput(input))
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationGet, async (_event, payload?: { sessionId?: string; focus?: CcConversationFocus }) => {
    const sessionId = optionalString(payload?.sessionId)
    if (!sessionId) throw new Error("sessionId is required")
    return ccConversations.getConversation(sessionId)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationSearchText, async (_event, input?: CcConversationListInput) => {
    return ccConversations.searchConversationText({ ...normalizeConversationListInput(input), rawText: true })
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationWindowOpen, async (_event, request?: CcConversationWindowRequest) => {
    const sessionId = optionalString(request?.sessionId)
    if (!sessionId) throw new Error("sessionId is required")
    await ccConversationWindowService.openConversationWindow({
      sessionId,
      title: optionalString(request?.title),
      focus: normalizeConversationFocus(request?.focus),
    })
  })

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexRefresh, async () => refreshUsageInWorker({
    dbPath,
    prefix: "cx",
    roots: codexRoots,
  }))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexOverview, async (_event, range?: UsageRangeInput) => codex.getOverview(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexTime, async (_event, range?: UsageRangeInput) => codex.getTime(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexModels, async (_event, range?: UsageRangeInput) => codex.getModels(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexProjects, async (_event, range?: UsageRangeInput) => codex.getProjects(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexTools, async (_event, range?: UsageRangeInput) => codex.getTools(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexDetails, async (_event, range?: UsageDetailInput) => codex.getDetails(normalizeDetailsRange(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.pricingRulesGet, async () => cc.getPricingRules())
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.pricingRulesSave, async (_event, rules?: readonly UsageModelPriceRuleInput[]) => cc.savePricingRules(Array.isArray(rules) ? rules : []))

  registered = true
}
