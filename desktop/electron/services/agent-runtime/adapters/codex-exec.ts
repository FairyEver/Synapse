import path from "node:path"
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs"
import type { Dirent } from "node:fs"
import { homedir } from "node:os"

import type {
  ControlledProcessResult,
  ControlledProcessRunRequest,
  ControlledProcessSession,
} from "../../../runtime/process"
import type {
  AgentAdapter,
  AgentEvent,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentLiveSession,
  AgentMessage,
  AgentResultMetadata,
} from "../types"
import {
  CodexAppServerLiveSession,
  buildCodexAppServerArgs,
} from "./codex-app-server-session"

export {
  buildCodexAppServerArgs,
  type CodexAppServerArgsOptions,
} from "./codex-app-server-session"

const CODEX_TOOL_NAMES: Record<string, string> = {
  web_search: "WebSearch",
  file_search: "FileSearch",
  code_interpreter: "CodeInterpreter",
  computer_use: "ComputerUse",
  mcp_tool: "MCP",
}

const TOOL_RESULT_MAX_RUNES = 500

export interface CodexProcessRunner {
  run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult>
  start?(request: ControlledProcessRunRequest): Promise<ControlledProcessSession>
}

export interface CodexExecOptions {
  readonly command?: string
  readonly model?: string
  readonly provider?: string
  readonly baseUrl?: string
  readonly effort?: string
  readonly mode?: string
  readonly env?: Record<string, string | undefined>
  readonly envAllowlist?: readonly string[]
  readonly timeoutMs?: number
  readonly backend?: "exec" | "app-server"
}

export interface CodexExecArgsOptions {
  readonly workDir: string
  readonly threadId?: string
  readonly model?: string
  readonly provider?: string
  readonly baseUrl?: string
  readonly effort?: string
  readonly mode?: string
  readonly imagePaths?: readonly string[]
}

export class CodexExecAdapter implements AgentAdapter {
  readonly agentType = "codex"
  readonly startSession?: AgentAdapter["startSession"]

  private readonly runner: CodexProcessRunner
  private readonly options: CodexExecOptions

  constructor(runner: CodexProcessRunner, options: CodexExecOptions = {}) {
    this.runner = runner
    this.options = options
    if (options.backend === "app-server") {
      this.startSession = (context) => this.startAppServerSession(context)
    }
  }

  async execute(
    message: AgentMessage,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    // Compatibility path for one-shot Codex JSONL runs. Feishu/live sessions use app-server.
    const env = mergeEnv(this.options.env, context.sessionEnv)
    const envAllowlist = mergeEnvAllowlist(this.options.envAllowlist, context.sessionEnv)
    const parser = new CodexJsonLineParser(context.threadId, context.onEvent, {
      model: this.options.model,
      effort: this.options.effort,
      workDir: context.workDir,
      codexHome: stringValue(env?.CODEX_HOME),
    })
    const args = buildCodexExecArgs({
      workDir: context.workDir,
      threadId: context.threadId,
      model: this.options.model,
      provider: this.options.provider,
      baseUrl: this.options.baseUrl,
      effort: this.options.effort,
      mode: message.modeOverride ?? this.options.mode,
    })

    const result = await this.runner.run({
      actor: context.actor,
      action: "agent.spawn",
      command: this.options.command ?? "codex",
      args,
      cwd: context.workDir,
      stdin: message.content,
      env,
      envAllowlist,
      isolation: mergeProcessIsolation(
        context.processIsolation,
        envAllowlist,
      ),
      timeoutMs: this.options.timeoutMs,
      output: { stdout: "json-lines", stderr: "buffer" },
      onStdoutLine: (line) => parser.pushLine(line),
      metadata: {
        adapter: this.agentType,
        projectId: context.projectId,
        sessionKey: message.sessionKey,
        platform: message.platform,
      },
    })

    if (result.stdout && parser.lineCount === 0) {
      parser.pushText(result.stdout)
    }
    if (result.exitCode !== 0) {
      parser.pushError(
        trimmedOrDefault(result.stderr, `codex exited with code ${String(result.exitCode)}`),
      )
    }
    if (result.error) {
      parser.pushError(result.error)
    }

    return parser.finalize()
  }

  private async startAppServerSession(context: AgentExecutionContext): Promise<AgentLiveSession> {
    if (!this.runner.start) {
      throw new Error("Codex app-server live session requires a process runner with start support")
    }

    const env = mergeEnv(this.options.env, context.sessionEnv)
    const envAllowlist = mergeEnvAllowlist(this.options.envAllowlist, context.sessionEnv)
    const bufferedLines: string[] = []
    const liveSessionRef: { current?: CodexAppServerLiveSession } = {}
    const processSession = await this.runner.start({
      actor: context.actor,
      action: "agent.spawn",
      command: this.options.command ?? "codex",
      args: buildCodexAppServerArgs({
        provider: this.options.provider,
        baseUrl: this.options.baseUrl,
        effort: this.options.effort,
      }),
      cwd: context.workDir,
      env,
      envAllowlist,
      isolation: mergeProcessIsolation(
        context.processIsolation,
        envAllowlist,
      ),
      timeoutMs: this.options.timeoutMs,
      output: { stdout: "json-lines", stderr: "buffer" },
      onStdoutLine: (line) => {
        if (liveSessionRef.current) liveSessionRef.current.handleLine(line)
        else bufferedLines.push(line)
      },
      metadata: {
        adapter: this.agentType,
        projectId: context.projectId,
        appServer: true,
      },
    })

    const liveSession = new CodexAppServerLiveSession(processSession, this.agentType, {
      model: this.options.model,
      provider: this.options.provider,
      effort: this.options.effort,
      mode: this.options.mode,
      workDir: context.workDir,
      threadId: context.agentSessionId ?? context.threadId,
      codexHome: stringValue(env?.CODEX_HOME),
    }, bufferedLines)
    liveSessionRef.current = liveSession
    await liveSession.initialize()
    return liveSession
  }
}

function mergeProcessIsolation(
  isolation: AgentExecutionContext["processIsolation"],
  envAllowlist: readonly string[] | undefined,
): AgentExecutionContext["processIsolation"] {
  if (!isolation) return undefined
  return {
    ...isolation,
    envAllowlist: mergeStringLists(isolation.envAllowlist, envAllowlist),
  }
}

function mergeStringLists(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined {
  const values = new Set([...(left ?? []), ...(right ?? [])])
  return values.size > 0 ? [...values] : undefined
}

function mergeEnv(
  base: Record<string, string | undefined> | undefined,
  sessionEnv: Record<string, string> | undefined,
): Record<string, string | undefined> | undefined {
  if (!base && !sessionEnv) return undefined
  return { ...(base ?? {}), ...(sessionEnv ?? {}) }
}

function mergeEnvAllowlist(
  base: readonly string[] | undefined,
  sessionEnv: Record<string, string> | undefined,
): readonly string[] | undefined {
  const values = new Set(base ?? [])
  for (const key of Object.keys(sessionEnv ?? {})) values.add(key)
  return values.size > 0 ? [...values] : undefined
}

export function buildCodexExecArgs(options: CodexExecArgsOptions): string[] {
  const isResume = Boolean(options.threadId)
  const args = isResume
    ? ["exec", "resume", "--skip-git-repo-check"]
    : ["exec", "--skip-git-repo-check"]

  switch (options.mode) {
    case "auto-edit":
    case "full-auto":
      args.push("--full-auto")
      break
    case "yolo":
      args.push("--dangerously-bypass-approvals-and-sandbox")
      break
    default:
      break
  }

  if (options.model) {
    args.push("--model", options.model)
  }
  if (options.provider) {
    args.push("-c", `model_provider=${JSON.stringify(options.provider)}`)
  }
  if (options.baseUrl) {
    args.push("-c", `openai_base_url=${JSON.stringify(options.baseUrl)}`)
  }
  if (options.effort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(options.effort)}`)
  }

  for (const imagePath of options.imagePaths ?? []) {
    args.push("--image", imagePath)
  }

  if (isResume) {
    args.push(options.threadId as string, "--json", "-")
  } else {
    args.push("--json", "--cd", options.workDir, "-")
  }
  return args
}

export interface CodexParseResult extends AgentExecutionResult {
  readonly lineCount: number
}

interface CodexParserOptions {
  readonly model?: string
  readonly effort?: string
  readonly workDir?: string
  readonly codexHome?: string
}

export class CodexJsonLineParser {
  private readonly events: AgentEvent[] = []
  private readonly textParts: string[] = []
  private readonly pendingMessages: string[] = []
  private readonly onEvent: ((event: AgentEvent) => void) | undefined
  private readonly options: CodexParserOptions
  private currentThreadId: string | undefined
  private currentError: string | undefined
  private lines = 0

  constructor(
    initialThreadId?: string,
    onEvent?: (event: AgentEvent) => void,
    options: CodexParserOptions = {},
  ) {
    this.currentThreadId = initialThreadId
    this.onEvent = onEvent
    this.options = options
  }

  get lineCount(): number {
    return this.lines
  }

  pushText(text: string): void {
    for (const line of text.split(/\r?\n/)) {
      this.pushLine(line)
    }
  }

  pushLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    this.lines += 1

    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch {
      return
    }
    const event = asRecord(raw)
    if (!event) return
    this.handleEvent(event)
  }

  pushError(message: string): void {
    const clean = message.trim()
    if (!clean) return
    this.currentError = clean
    this.emit({ type: "error", message: clean })
  }

  finalize(): CodexParseResult {
    return {
      events: this.events.slice(),
      resultText: this.textParts.join(""),
      agentSessionId: this.currentThreadId,
      threadId: this.currentThreadId,
      error: this.currentError,
      lineCount: this.lines,
    }
  }

  private handleEvent(raw: Record<string, unknown>): void {
    const eventType = stringValue(raw.type)
    switch (eventType) {
      case "thread.started":
        this.currentThreadId = stringValue(raw.thread_id) ?? this.currentThreadId
        break
      case "turn.started":
        this.pendingMessages.length = 0
        break
      case "item.started":
        this.handleItemStarted(asRecord(raw.item))
        break
      case "item.completed":
        this.handleItemCompleted(asRecord(raw.item))
        break
      case "turn.completed":
        this.flushPendingAsText()
        this.emit({
          type: "result",
          content: this.textParts.join(""),
          done: true,
          metadata: this.resultMetadata(),
        })
        break
      case "turn.failed":
        this.pushError(extractTurnError(raw))
        break
      case "error":
        this.pushError(stringValue(raw.message) ?? "codex error")
        break
      default:
        break
    }
  }

  private resultMetadata(): AgentResultMetadata | undefined {
    const contextRemainingPercent = resolveContextRemainingPercent(
      this.options.codexHome,
      this.currentThreadId,
    )
    const metadata: AgentResultMetadata = {
      model: this.options.model,
      effort: this.options.effort,
      contextRemainingPercent,
      workDir: this.options.workDir,
    }
    return Object.values(metadata).some((value) => value !== undefined && value !== "")
      ? metadata
      : undefined
  }

  private handleItemStarted(item: Record<string, unknown> | null): void {
    if (!item) return
    const itemType = normalizeCodexItemType(item.type)
    if (itemType === "agent_message" || itemType === "message" || itemType === "reasoning") {
      return
    }

    this.flushPendingAsThinking()

    if (itemType === "command_execution") {
      this.emit({
        type: "toolUse",
        toolName: "Bash",
        toolInput: stringValue(item.command) ?? "",
      })
      return
    }
    if (itemType === "function_call") {
      this.emit({
        type: "toolUse",
        toolName: stringValue(item.name) ?? "",
        toolInput: stringFromUnknown(item.arguments),
      })
      return
    }
    if (itemType === "mcp_tool_call" || itemType === "dynamic_tool_call") {
      this.emit({
        type: "toolUse",
        toolName: codexToolCallName(item),
        toolInput: stringFromUnknown(item.arguments),
      })
      return
    }
    if (itemType === "file_change") {
      this.emit({
        type: "toolUse",
        toolName: "FileChange",
        toolInput: stringFromUnknown(item.changes),
      })
    }
  }

  private handleItemCompleted(item: Record<string, unknown> | null): void {
    if (!item) return
    const itemType = normalizeCodexItemType(item.type)

    switch (itemType) {
      case "reasoning": {
        const text = extractItemText(item, "summary", "summary_text")
        if (text) this.emit({ type: "thinking", content: text })
        break
      }
      case "agent_message":
      case "message": {
        const text = extractItemText(item, "content", "output_text")
        if (text) this.pendingMessages.push(text)
        break
      }
      case "command_execution": {
        const status = stringValue(item.status) ?? ""
        const exitCode = numberValue(item.exit_code) ?? numberValue(item.exitCode)
        this.emit({
          type: "toolResult",
          toolName: "Bash",
          content: truncate(
            (stringValue(item.aggregated_output) ?? stringValue(item.aggregatedOutput) ?? "").trim(),
            TOOL_RESULT_MAX_RUNES,
          ),
          status: status.trim(),
          exitCode,
          success: booleanValue(item.success) ?? codexToolSuccess(status, exitCode),
        })
        break
      }
      case "function_call": {
        const status = stringValue(item.status) ?? ""
        this.emit({
          type: "toolResult",
          toolName: stringValue(item.name) ?? "",
          content: truncate((stringValue(item.output) ?? "").trim(), TOOL_RESULT_MAX_RUNES),
          status: status.trim(),
          success: codexToolSuccess(status),
        })
        break
      }
      case "mcp_tool_call":
      case "dynamic_tool_call": {
        const status = stringValue(item.status) ?? ""
        this.emit({
          type: "toolResult",
          toolName: codexToolCallName(item),
          content: truncate(codexToolResultContent(item), TOOL_RESULT_MAX_RUNES),
          status: status.trim(),
          success: booleanValue(item.success) ?? codexToolSuccess(status),
        })
        break
      }
      case "file_change":
        this.emit({
          type: "toolUse",
          toolName: "FileChange",
          toolInput: stringFromUnknown(item.changes),
        })
        break
      case "function_call_output":
        break
      case "error": {
        const message = stringValue(item.message)
        if (message && !message.includes("Falling back")) {
          this.pushError(message)
        }
        break
      }
      default: {
        const toolName = itemType ? CODEX_TOOL_NAMES[itemType] : undefined
        if (toolName) {
          this.emit({
            type: "toolUse",
            toolName,
            toolInput: codexExtractToolInput(item),
          })
        }
      }
    }
  }

  private flushPendingAsThinking(): void {
    for (const content of this.pendingMessages.splice(0)) {
      this.emit({ type: "thinking", content })
    }
  }

  private flushPendingAsText(): void {
    for (const content of this.pendingMessages.splice(0)) {
      this.textParts.push(content)
      this.emit({ type: "text", content })
    }
  }

  private emit(event: AgentEvent): void {
    const threadId = this.currentThreadId
    let emitted: AgentEvent
    if (threadId) {
      emitted = {
        ...event,
        agentSessionId: threadId,
        threadId,
      } as AgentEvent
    } else {
      emitted = event
    }
    this.events.push(emitted)
    this.onEvent?.(emitted)
  }
}

export function parseCodexJsonLines(text: string, initialThreadId?: string): CodexParseResult {
  const parser = new CodexJsonLineParser(initialThreadId)
  parser.pushText(text)
  return parser.finalize()
}

function extractTurnError(raw: Record<string, unknown>): string {
  const nested = asRecord(raw.error)
  return stringValue(nested?.message)
    ?? stringValue(raw.message)
    ?? "turn failed (no details)"
}

function extractItemText(
  item: Record<string, unknown>,
  arrayField: string,
  elementType: string,
): string {
  const values = item[arrayField]
  if (Array.isArray(values)) {
    const parts: string[] = []
    for (const value of values) {
      const record = asRecord(value)
      if (!record) continue
      if (elementType && stringValue(record.type) !== elementType) continue
      const text = stringValue(record.text)
      if (text) parts.push(text)
    }
    if (parts.length > 0) return parts.join("\n")
  }
  return stringValue(item.text) ?? ""
}

function codexExtractToolInput(item: Record<string, unknown>): string {
  const action = asRecord(item.action)
  const queries = action?.queries
  if (Array.isArray(queries)) {
    const parts = queries.filter((query): query is string => typeof query === "string" && query !== "")
    if (parts.length > 0) return parts.join("\n")
  }
  return stringValue(action?.query)
    ?? stringValue(item.query)
    ?? stringValue(item.name)
    ?? ""
}

function codexToolSuccess(status: string, exitCode?: number): boolean {
  if (exitCode !== undefined) return exitCode === 0
  const normalized = status.trim().toLowerCase()
  return ["completed", "success", "succeeded", "ok"].includes(normalized)
}

function normalizeCodexItemType(value: unknown): string {
  switch (stringValue(value)) {
    case "commandExecution":
      return "command_execution"
    case "agentMessage":
      return "agent_message"
    case "mcpToolCall":
      return "mcp_tool_call"
    case "dynamicToolCall":
      return "dynamic_tool_call"
    case "fileChange":
      return "file_change"
    default:
      return stringValue(value) ?? ""
  }
}

function codexToolCallName(item: Record<string, unknown>): string {
  const server = stringValue(item.server)
  const namespace = stringValue(item.namespace)
  const tool = stringValue(item.tool) ?? stringValue(item.name)
  if (server && tool) return `${server}.${tool}`
  if (namespace && tool) return `${namespace}.${tool}`
  return tool ?? server ?? namespace ?? ""
}

function codexToolResultContent(item: Record<string, unknown>): string {
  const contentItems = item.contentItems
  if (Array.isArray(contentItems)) {
    const parts = contentItems.flatMap((value): string[] => {
      const record = asRecord(value)
      const text = stringValue(record?.text)
      return text ? [text] : []
    })
    if (parts.length > 0) return parts.join("\n")
  }
  return stringValue(item.output)
    ?? stringValue(item.result)
    ?? stringFromUnknown(item.result)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function truncate(value: string, maxRunes: number): string {
  const runes = [...value]
  if (runes.length <= maxRunes) return value
  return `${runes.slice(0, maxRunes).join("")}...`
}

const CODEX_CONTEXT_BASELINE_TOKENS = 12000
const CODEX_ROLLOUT_TAIL_BYTES = 1024 * 1024
const CODEX_SESSION_SCAN_LIMIT = 5000

interface CodexContextUsage {
  readonly contextWindow: number
  readonly usedTokens: number
  readonly baselineTokens: number
}

function resolveContextRemainingPercent(
  codexHome: string | undefined,
  threadId: string | undefined,
): number | undefined {
  const sessionFile = findCodexSessionFile(resolveCodexHome(codexHome), threadId)
  if (!sessionFile) return undefined
  const usage = readLatestContextUsage(sessionFile)
  if (!usage) return undefined
  return contextRemainingPercent(usage)
}

function resolveCodexHome(codexHome: string | undefined): string {
  const trimmed = codexHome?.trim()
  return trimmed ? trimmed : path.join(homedir(), ".codex")
}

function findCodexSessionFile(
  codexHome: string,
  threadId: string | undefined,
): string | undefined {
  if (!threadId) return undefined
  const roots = [
    path.join(codexHome, "sessions"),
    path.join(codexHome, "archived_sessions"),
  ]
  let scanned = 0
  let match: { filePath: string; mtimeMs: number } | undefined

  for (const root of roots) {
    if (!existsSync(root)) continue
    const stack = [root]
    while (stack.length > 0 && scanned < CODEX_SESSION_SCAN_LIMIT) {
      const current = stack.pop()
      if (!current) continue
      let entries: Dirent[]
      try {
        entries = readdirSync(current, { withFileTypes: true })
      } catch (_error) {
        continue
      }
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name)
        if (entry.isDirectory()) {
          stack.push(entryPath)
          continue
        }
        scanned += 1
        if (!entry.isFile() || !entry.name.endsWith(".jsonl") || !entry.name.includes(threadId)) {
          continue
        }
        const mtimeMs = statMtimeMs(entryPath)
        if (!match || mtimeMs > match.mtimeMs) {
          match = { filePath: entryPath, mtimeMs }
        }
      }
    }
  }
  return match?.filePath
}

function statMtimeMs(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch (_error) {
    return 0
  }
}

function readLatestContextUsage(filePath: string): CodexContextUsage | undefined {
  const tail = readFileTail(filePath, CODEX_ROLLOUT_TAIL_BYTES)
  if (!tail) return undefined
  const lines = tail.split(/\r?\n/).reverse()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch (_error) {
      continue
    }
    const usage = contextUsageFromRecord(asRecord(raw))
    if (usage) return usage
  }
  return undefined
}

function readFileTail(filePath: string, maxBytes: number): string | undefined {
  let file: ReturnType<typeof openSync> | undefined
  try {
    const size = statSync(filePath).size
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    const buffer = Buffer.alloc(length)
    file = openSync(filePath, "r")
    readSync(file, buffer, 0, length, start)
    return buffer.toString("utf8")
  } catch (_error) {
    return undefined
  } finally {
    if (file !== undefined) closeSync(file)
  }
}

function contextUsageFromRecord(raw: Record<string, unknown> | null): CodexContextUsage | undefined {
  if (!raw) return undefined
  const payload = asRecord(raw.payload)
  const eventType = stringValue(payload?.type) ?? stringValue(raw.type)
  if (eventType !== "token_count") return undefined
  const info = asRecord(payload?.info) ?? asRecord(raw.info)
  if (!info) return undefined
  const totalUsage = asRecord(info.total_token_usage) ?? asRecord(info.totalTokenUsage)
  const lastUsage = asRecord(info.last_token_usage) ?? asRecord(info.lastTokenUsage)
  const contextWindow = numberValue(info.model_context_window)
    ?? numberValue(info.context_window)
    ?? numberValue(info.modelContextWindow)
    ?? numberValue(info.contextWindow)
  if (!contextWindow || contextWindow <= 0) return undefined

  const usedTokens = numberValue(info.used_tokens)
    ?? numberValue(info.usedTokens)
    ?? numberValue(totalUsage?.total_tokens)
    ?? numberValue(totalUsage?.totalTokens)
    ?? sumTokenUsage(totalUsage)
    ?? sumTokenUsage(lastUsage)
  if (!usedTokens || usedTokens <= 0) return undefined
  return {
    contextWindow,
    usedTokens,
    baselineTokens: numberValue(info.baseline_tokens)
      ?? numberValue(info.baselineTokens)
      ?? CODEX_CONTEXT_BASELINE_TOKENS,
  }
}

function sumTokenUsage(usage: Record<string, unknown> | null): number | undefined {
  if (!usage) return undefined
  const input = numberValue(usage.input_tokens) ?? numberValue(usage.inputTokens) ?? 0
  const output = numberValue(usage.output_tokens) ?? numberValue(usage.outputTokens) ?? 0
  const total = input + output
  return total > 0 ? total : undefined
}

function contextRemainingPercent(usage: CodexContextUsage): number | undefined {
  const baseline = Math.max(0, usage.baselineTokens)
  if (usage.contextWindow <= baseline) return 0
  const effectiveWindow = usage.contextWindow - baseline
  const effectiveUsed = Math.max(0, usage.usedTokens - baseline)
  const remaining = Math.max(0, effectiveWindow - effectiveUsed)
  return Math.max(0, Math.min(100, Math.round((remaining / effectiveWindow) * 100)))
}

function trimmedOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}
