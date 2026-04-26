import type {
  ControlledProcessResult,
  ControlledProcessRunRequest,
} from "../../../runtime/process"
import type {
  AgentAdapter,
  AgentEvent,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentMessage,
} from "../types"

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

  private readonly runner: CodexProcessRunner
  private readonly options: CodexExecOptions

  constructor(runner: CodexProcessRunner, options: CodexExecOptions = {}) {
    this.runner = runner
    this.options = options
  }

  async execute(
    message: AgentMessage,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const parser = new CodexJsonLineParser(context.threadId, context.onEvent)
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
      env: mergeEnv(this.options.env, context.sessionEnv),
      envAllowlist: mergeEnvAllowlist(this.options.envAllowlist, context.sessionEnv),
      isolation: mergeProcessIsolation(
        context.processIsolation,
        mergeEnvAllowlist(this.options.envAllowlist, context.sessionEnv),
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

export class CodexJsonLineParser {
  private readonly events: AgentEvent[] = []
  private readonly textParts: string[] = []
  private readonly pendingMessages: string[] = []
  private readonly onEvent: ((event: AgentEvent) => void) | undefined
  private currentThreadId: string | undefined
  private currentError: string | undefined
  private lines = 0

  constructor(initialThreadId?: string, onEvent?: (event: AgentEvent) => void) {
    this.currentThreadId = initialThreadId
    this.onEvent = onEvent
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

  private handleItemStarted(item: Record<string, unknown> | null): void {
    if (!item) return
    const itemType = stringValue(item.type)
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
    }
  }

  private handleItemCompleted(item: Record<string, unknown> | null): void {
    if (!item) return
    const itemType = stringValue(item.type)

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
        const exitCode = numberValue(item.exit_code)
        this.emit({
          type: "toolResult",
          toolName: "Bash",
          content: truncate((stringValue(item.aggregated_output) ?? "").trim(), TOOL_RESULT_MAX_RUNES),
          status: status.trim(),
          exitCode,
          success: codexToolSuccess(status, exitCode),
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

function truncate(value: string, maxRunes: number): string {
  const runes = [...value]
  if (runes.length <= maxRunes) return value
  return `${runes.slice(0, maxRunes).join("")}...`
}

function trimmedOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}
