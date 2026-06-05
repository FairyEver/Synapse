import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { app } from "electron"
import { USAGE_ANALYSIS_CHANNELS } from "./channels"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { createMainLogger } from "../services/log-store"
import {
  getUsageAnalysisDb,
  getUsageAnalysisDbPath,
  CcUsageAnalysisService,
  CodexUsageAnalysisService,
  getCcConversationInWorker,
  listCcRecordDetailsInWorker,
  listCcConversationsInWorker,
  listCcRecordsInWorker,
  refreshUsageInWorker,
  searchCcConversationTextInWorker,
  searchCcRecordsTextInWorker,
} from "../services/usage-analysis"
import type { UsageDetailInput, UsageModelPriceRuleInput, UsageRangeInput } from "../services/usage-analysis"
import { ccConversationWindowService } from "../services/usage-analysis/cc-conversation-window-service"
import type {
  CcConversationFocus,
  CcConversationListInput,
  CcConversationWindowRequest,
  CcRecordDetailsInput,
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

function conversationListLogSummary(input: CcConversationListInput): Record<string, unknown> {
  return {
    limit: input.limit,
    offset: input.offset,
    filters: {
      preset: input.preset,
      hasQuery: Boolean(input.query),
      queryLength: input.query?.length ?? 0,
      rawText: input.rawText === true,
      hasProject: Boolean(input.project),
      hasModel: Boolean(input.model),
      hasTool: Boolean(input.tool),
      hasEventType: Boolean(input.eventType),
    },
  }
}

export function normalizeRecordDetailsInput(input: CcRecordDetailsInput | undefined): CcRecordDetailsInput {
  const sessionId = optionalString(input?.sessionId)
  if (!sessionId) throw new Error("sessionId is required")
  const limit = Number(input?.limit)
  const offset = Number(input?.offset)
  return {
    sessionId,
    limit: Number.isFinite(limit) ? limit : 200,
    offset: Number.isFinite(offset) ? offset : 0,
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
  } catch (error) {
    if (isMissingDirectoryError(error)) return []
    throw new Error(`Unable to read Claude usage directory: ${root}`, { cause: error })
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

function isMissingDirectoryError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : ""
  return code === "ENOENT" || code === "ENOTDIR"
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
  const logger = createMainLogger("usage-analysis.ipc")
  const userDataPath = app.getPath("userData")
  const db = getUsageAnalysisDb(userDataPath)
  const dbPath = getUsageAnalysisDbPath(userDataPath)
  const home = os.homedir()
  const ccRoots = resolveClaudeUsageRoots({ home })
  const cc = new CcUsageAnalysisService({
    db,
    roots: ccRoots,
  })
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex")
  const codexRoots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")]
  const codex = new CodexUsageAnalysisService({
    db,
    roots: codexRoots,
  })

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccRefresh, async () => {
    logger.info("Usage Analysis CC refresh requested.", { rootCount: ccRoots.length })
    return refreshUsageInWorker({
      dbPath,
      prefix: "cc",
      roots: ccRoots,
    })
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccOverview, async (_event, range?: UsageRangeInput) => {
    const normalized = normalizeUsageRangeForIpc(range)
    logger.info("Usage Analysis CC overview requested.", normalized)
    return cc.getOverview(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTime, async (_event, range?: UsageRangeInput) => {
    const normalized = normalizeUsageRangeForIpc(range)
    logger.info("Usage Analysis CC time series requested.", normalized)
    return cc.getTime(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccModels, async (_event, range?: UsageRangeInput) => {
    const normalized = normalizeUsageRangeForIpc(range)
    logger.info("Usage Analysis CC models requested.", normalized)
    return cc.getModels(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccProjects, async (_event, range?: UsageRangeInput) => {
    const normalized = normalizeUsageRangeForIpc(range)
    logger.info("Usage Analysis CC projects requested.", normalized)
    return cc.getProjects(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTools, async (_event, range?: UsageRangeInput) => {
    const normalized = normalizeUsageRangeForIpc(range)
    logger.info("Usage Analysis CC tools requested.", normalized)
    return cc.getTools(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccDetails, async (_event, range?: UsageDetailInput) => {
    const normalized = normalizeDetailsRange(range)
    logger.info("Usage Analysis CC details requested.", {
      preset: normalized.preset,
      bucket: normalized.bucket,
      limit: normalized.limit,
      offset: normalized.offset,
    })
    return cc.getDetails(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccRecordsList, async (_event, input?: CcConversationListInput) => {
    const normalized = normalizeConversationListInput(input)
    logger.info("Usage Analysis CC records list requested.", conversationListLogSummary(normalized))
    return listCcRecordsInWorker(dbPath, normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccRecordDetailsList, async (_event, input?: CcRecordDetailsInput) => {
    const normalized = normalizeRecordDetailsInput(input)
    logger.info("Usage Analysis CC record details requested.", {
      sessionId: normalized.sessionId,
      limit: normalized.limit,
      offset: normalized.offset,
    })
    return listCcRecordDetailsInWorker(dbPath, normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccRecordsSearchText, async (_event, input?: CcConversationListInput) => {
    const normalized = { ...normalizeConversationListInput(input), rawText: true }
    logger.info("Usage Analysis CC records raw text search requested.", conversationListLogSummary(normalized))
    return searchCcRecordsTextInWorker(dbPath, normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationsList, async (_event, input?: CcConversationListInput) => {
    const normalized = normalizeConversationListInput(input)
    logger.info("Usage Analysis CC conversations list requested.", conversationListLogSummary(normalized))
    return listCcConversationsInWorker(dbPath, normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationGet, async (_event, payload?: { sessionId?: string; focus?: CcConversationFocus }) => {
    const sessionId = optionalString(payload?.sessionId)
    if (!sessionId) throw new Error("sessionId is required")
    logger.info("Usage Analysis CC conversation get requested.", {
      sessionId,
      hasFocus: Boolean(normalizeConversationFocus(payload?.focus)),
    })
    return getCcConversationInWorker(dbPath, sessionId)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationSearchText, async (_event, input?: CcConversationListInput) => {
    const normalized = { ...normalizeConversationListInput(input), rawText: true }
    logger.info("Usage Analysis CC conversation raw text search requested.", conversationListLogSummary(normalized))
    return searchCcConversationTextInWorker(dbPath, normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationWindowOpen, async (_event, request?: CcConversationWindowRequest) => {
    const sessionId = optionalString(request?.sessionId)
    if (!sessionId) throw new Error("sessionId is required")
    logger.info("Usage Analysis CC conversation window open requested.", {
      sessionId,
      hasTitle: Boolean(optionalString(request?.title)),
      hasFocus: Boolean(normalizeConversationFocus(request?.focus)),
    })
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
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.pricingRulesSave, async (_event, rules?: readonly UsageModelPriceRuleInput[]) => {
    const normalizedRules = Array.isArray(rules) ? rules : []
    const savedRules = cc.savePricingRules(normalizedRules)
    logger.info("Usage pricing rules save completed.", {
      requestedRuleCount: normalizedRules.length,
      savedRuleCount: savedRules.length,
    })
    return savedRules
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.pricingRulesReset, async () => cc.resetPricingRules())

  registered = true
}
