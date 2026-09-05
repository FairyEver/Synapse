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
  getCcConversationChunkInWorker,
  getCcConversationInWorker,
  listCcRecordDetailsInWorker,
  listCcConversationsInWorker,
  listCcRecordsInWorker,
  refreshUsageInWorker,
  searchCcConversationTextInWorker,
  searchCcRecordsTextInWorker,
} from "../services/usage-analysis"
import type { UsageDetailInput, UsageModelPriceRuleInput, UsageRangeInput, UsageRefreshInput } from "../services/usage-analysis"
import { ccConversationWindowService } from "../services/usage-analysis/cc-conversation-window-service"
import type {
  CcConversationChunkInput,
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

export function normalizeUsageRefreshInput(input: { readonly preset?: unknown } | undefined): UsageRefreshInput | undefined {
  return input?.preset === "today" ? { preset: "today" } : undefined
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

export function normalizeConversationChunkInput(input: Partial<CcConversationChunkInput> | undefined): CcConversationChunkInput {
  const sessionId = optionalString(input?.sessionId)
  if (!sessionId) throw new Error("sessionId is required")
  const limit = Number(input?.limit)
  return {
    sessionId,
    limit: Number.isFinite(limit) ? limit : 200,
    ...(optionalString(input?.cursor) ? { cursor: optionalString(input?.cursor) } : {}),
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

const DEFAULT_DESKTOP_ROOT_DISCOVERY_MAX_ENTRIES = 100_000
const DEFAULT_DESKTOP_ROOT_DISCOVERY_MAX_PROJECT_ROOTS = 2_000

type DesktopRootDiscoveryLimits = {
  readonly maxDirectoryEntries: number
  readonly maxProjectRoots: number
}

type DesktopRootDiscoveryState = {
  visitedEntries: number
  readonly projectRoots: string[]
  truncated: boolean
}

function normalizePositiveLimit(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback
}

function collectProjectsDirs(
  root: string,
  state: DesktopRootDiscoveryState,
  limits: DesktopRootDiscoveryLimits,
  maxDepth = 5,
): void {
  if (maxDepth < 0 || state.truncated || state.projectRoots.length >= limits.maxProjectRoots) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch (error) {
    if (isMissingDirectoryError(error)) return
    throw new Error(`Unable to read Claude usage directory: ${root}`, { cause: error })
  }

  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    state.visitedEntries += 1
    if (state.visitedEntries > limits.maxDirectoryEntries) {
      state.truncated = true
      return
    }
    if (state.projectRoots.length >= limits.maxProjectRoots) return
    if (!entry.isDirectory()) continue
    const fullPath = path.join(root, entry.name)
    if (entry.name === "projects") {
      state.projectRoots.push(fullPath)
      continue
    }
    collectProjectsDirs(fullPath, state, limits, maxDepth - 1)
    if (state.truncated || state.projectRoots.length >= limits.maxProjectRoots) return
  }
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

function resolveClaudeDesktopProjectRoots(
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  limits: DesktopRootDiscoveryLimits,
): string[] {
  const state: DesktopRootDiscoveryState = {
    visitedEntries: 0,
    projectRoots: [],
    truncated: false,
  }
  for (const root of claudeDesktopDataRoots(home, env, platform)) {
    collectProjectsDirs(root, state, limits)
    if (state.truncated || state.projectRoots.length >= limits.maxProjectRoots) break
  }
  return state.projectRoots
}

export function resolveClaudeUsageRoots({
  home,
  env = process.env,
  platform = process.platform,
  includeDesktopRoots = true,
  maxDesktopDirectoryEntries = DEFAULT_DESKTOP_ROOT_DISCOVERY_MAX_ENTRIES,
  maxDesktopProjectRoots = DEFAULT_DESKTOP_ROOT_DISCOVERY_MAX_PROJECT_ROOTS,
}: {
  readonly home: string
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly includeDesktopRoots?: boolean
  readonly maxDesktopDirectoryEntries?: number
  readonly maxDesktopProjectRoots?: number
}): string[] {
  const targetPath = pathForPlatform(platform)
  const configRoots = splitPathList(env.CLAUDE_CONFIG_DIR).map((root) => targetPath.join(root, "projects"))
  const cliRoots = [targetPath.join(home, ".claude", "projects"), ...configRoots]
  const desktopRoots = includeDesktopRoots
    ? resolveClaudeDesktopProjectRoots(home, env, platform, {
      maxDirectoryEntries: normalizePositiveLimit(
        maxDesktopDirectoryEntries,
        DEFAULT_DESKTOP_ROOT_DISCOVERY_MAX_ENTRIES,
      ),
      maxProjectRoots: normalizePositiveLimit(maxDesktopProjectRoots, DEFAULT_DESKTOP_ROOT_DISCOVERY_MAX_PROJECT_ROOTS),
    })
    : []
  return uniquePaths([...cliRoots, ...desktopRoots])
}

function pathForPlatform(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix
}

export function registerUsageAnalysisHandlers(): void {
  if (registered) return
  const logger = createMainLogger("usage-analysis.ipc")
  const userDataPath = app.getPath("userData")
  const dbPath = getUsageAnalysisDbPath(userDataPath)
  const home = os.homedir()
  const ccRoots = resolveClaudeUsageRoots({ home, includeDesktopRoots: false })
  let cc: CcUsageAnalysisService | null = null
  const getCc = () => {
    cc ??= new CcUsageAnalysisService({
      db: getUsageAnalysisDb(userDataPath),
      roots: ccRoots,
    })
    return cc
  }
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex")
  const codexRoots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")]
  let codex: CodexUsageAnalysisService | null = null
  const getCodex = () => {
    codex ??= new CodexUsageAnalysisService({
      db: getUsageAnalysisDb(userDataPath),
      roots: codexRoots,
    })
    return codex
  }

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccRefresh, async (_event, input?: UsageRefreshInput) => {
    const scope = normalizeUsageRefreshInput(input)
    const refreshRoots = resolveClaudeUsageRoots({ home })
    logger.info("Usage Analysis CC refresh requested.", { rootCount: refreshRoots.length })
    return refreshUsageInWorker({
      dbPath,
      prefix: "cc",
      roots: refreshRoots,
      scope,
    })
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccOverview, async (_event, range?: UsageRangeInput) => {
    const normalized = normalizeUsageRangeForIpc(range)
    logger.info("Usage Analysis CC overview requested.", normalized)
    return getCc().getOverview(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTime, async (_event, range?: UsageRangeInput) => {
    const normalized = normalizeUsageRangeForIpc(range)
    logger.info("Usage Analysis CC time series requested.", normalized)
    return getCc().getTime(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccModels, async (_event, range?: UsageRangeInput) => {
    const normalized = normalizeUsageRangeForIpc(range)
    logger.info("Usage Analysis CC models requested.", normalized)
    return getCc().getModels(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccProjects, async (_event, range?: UsageRangeInput) => {
    const normalized = normalizeUsageRangeForIpc(range)
    logger.info("Usage Analysis CC projects requested.", normalized)
    return getCc().getProjects(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTools, async (_event, range?: UsageRangeInput) => {
    const normalized = normalizeUsageRangeForIpc(range)
    logger.info("Usage Analysis CC tools requested.", normalized)
    return getCc().getTools(normalized)
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccDetails, async (_event, range?: UsageDetailInput) => {
    const normalized = normalizeDetailsRange(range)
    logger.info("Usage Analysis CC details requested.", {
      preset: normalized.preset,
      bucket: normalized.bucket,
      limit: normalized.limit,
      offset: normalized.offset,
    })
    return getCc().getDetails(normalized)
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
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationChunkGet, async (_event, input?: CcConversationChunkInput) => {
    const normalized = normalizeConversationChunkInput(input)
    logger.info("Usage Analysis CC conversation chunk get requested.", {
      sessionId: normalized.sessionId,
      hasCursor: Boolean(normalized.cursor),
      limit: normalized.limit,
    })
    return getCcConversationChunkInWorker(dbPath, normalized)
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

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexRefresh, async (_event, input?: UsageRefreshInput) => refreshUsageInWorker({
    dbPath,
    prefix: "cx",
    roots: codexRoots,
    scope: normalizeUsageRefreshInput(input),
  }))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexOverview, async (_event, range?: UsageRangeInput) => getCodex().getOverview(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexTime, async (_event, range?: UsageRangeInput) => getCodex().getTime(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexModels, async (_event, range?: UsageRangeInput) => getCodex().getModels(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexProjects, async (_event, range?: UsageRangeInput) => getCodex().getProjects(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexTools, async (_event, range?: UsageRangeInput) => getCodex().getTools(normalizeUsageRangeForIpc(range)))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexDetails, async (_event, range?: UsageDetailInput) => getCodex().getDetails(normalizeDetailsRange(range)))
  registered = true
}
