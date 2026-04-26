import type {
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
  AgentPermissionDecision,
  AgentUserQuestion,
} from "../types"

export interface ClaudeProcessRunner {
  start(request: ControlledProcessRunRequest): Promise<ControlledProcessSession>
}

export interface ClaudeCodeOptions {
  readonly command?: string
  readonly model?: string
  readonly effort?: string
  readonly mode?: string
  readonly env?: Record<string, string | undefined>
  readonly envAllowlist?: readonly string[]
}

export interface ClaudeCodeArgsOptions {
  readonly sessionId?: string
  readonly model?: string
  readonly effort?: string
  readonly mode?: string
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly agentType = "claude-code"
  readonly compressionCommand = "/compact"

  private readonly runner: ClaudeProcessRunner
  private readonly options: ClaudeCodeOptions

  constructor(runner: ClaudeProcessRunner, options: ClaudeCodeOptions = {}) {
    this.runner = runner
    this.options = options
  }

  async execute(): Promise<AgentExecutionResult> {
    throw new Error("Claude Code adapter requires a live session")
  }

  async startSession(context: AgentExecutionContext): Promise<AgentLiveSession> {
    const bufferedLines: string[] = []
    const liveSessionRef: { current?: ClaudeCodeLiveSession } = {}
    const session = await this.runner.start({
      actor: context.actor,
      action: "agent.spawn",
      command: this.options.command ?? "claude",
      args: buildClaudeCodeArgs({
        sessionId: context.agentSessionId ?? context.threadId,
        model: this.options.model,
        effort: this.options.effort,
        mode: this.options.mode,
      }),
      cwd: context.workDir,
      env: mergeEnv(this.options.env, context.sessionEnv),
      envAllowlist: mergeEnvAllowlist(this.options.envAllowlist, context.sessionEnv),
      isolation: mergeProcessIsolation(
        context.processIsolation,
        mergeEnvAllowlist(this.options.envAllowlist, context.sessionEnv),
      ),
      output: { stdout: "json-lines", stderr: "buffer" },
      metadata: {
        adapter: this.agentType,
        projectId: context.projectId,
      },
      onStdoutLine: (line) => {
        if (liveSessionRef.current) liveSessionRef.current.handleLine(line)
        else bufferedLines.push(line)
      },
    })
    liveSessionRef.current = new ClaudeCodeLiveSession(session, this.agentType, bufferedLines)
    return liveSessionRef.current
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

export function buildClaudeCodeArgs(options: ClaudeCodeArgsOptions = {}): string[] {
  const args = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--permission-prompt-tool",
    "stdio",
  ]
  if (options.mode && options.mode !== "default") {
    args.push("--permission-mode", options.mode)
  }
  if (options.sessionId) {
    args.push("--resume", options.sessionId)
  }
  if (options.effort) {
    args.push("--effort", options.effort)
  }
  if (options.model) {
    args.push("--model", options.model)
  }
  return args
}

class ClaudeCodeLiveSession implements AgentLiveSession {
  readonly agentType: string

  private readonly processSession: ControlledProcessSession
  private readonly queue = new AsyncEventQueue()
  private sessionId: string | undefined

  constructor(
    processSession: ControlledProcessSession,
    agentType: string,
    bufferedLines: readonly string[] = [],
  ) {
    this.processSession = processSession
    this.agentType = agentType
    for (const line of bufferedLines) {
      this.handleLine(line)
    }
    void this.waitForExit()
  }

  async send(message: AgentMessage): Promise<void> {
    await this.writeJsonLine({
      type: "user",
      message: {
        role: "user",
        content: message.content,
      },
    })
  }

  async respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void> {
    const response = decision.behavior === "allow"
      ? {
        behavior: "allow",
        updatedInput: decision.updatedInput ?? {},
      }
      : {
        behavior: "deny",
        message: decision.message
          ?? "The user denied this tool use. Stop and wait for the user's instructions.",
      }

    await this.writeJsonLine({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response,
      },
    })
  }

  nextEvent(): Promise<AgentEvent | null> {
    return this.queue.next()
  }

  currentSessionId(): string | undefined {
    return this.sessionId
  }

  alive(): boolean {
    return this.processSession.alive()
  }

  async close(): Promise<void> {
    await this.processSession.close()
    this.queue.close()
  }

  private async writeJsonLine(value: unknown): Promise<void> {
    await this.processSession.writeStdin(`${JSON.stringify(value)}\n`)
  }

  private async waitForExit(): Promise<void> {
    const result = await this.processSession.wait()
    if (result.error || (result.exitCode !== 0 && result.exitCode !== null)) {
      this.queue.push({
        type: "error",
        message: result.error ?? result.stderr ?? `claude exited with code ${String(result.exitCode)}`,
        agentSessionId: this.sessionId,
        threadId: this.sessionId,
      })
    }
    this.queue.close()
  }

  handleLine(line: string): void {
    const raw = parseRecord(line)
    if (!raw) return
    const eventType = stringValue(raw.type)
    switch (eventType) {
      case "system":
        this.handleSystem(raw)
        break
      case "assistant":
        this.handleAssistant(raw)
        break
      case "result":
        this.handleResult(raw)
        break
      case "control_request":
        this.handleControlRequest(raw)
        break
      case "control_cancel_request":
      case "user":
      default:
        break
    }
  }

  private handleSystem(raw: Record<string, unknown>): void {
    const sessionId = stringValue(raw.session_id)
    if (!sessionId) return
    this.sessionId = sessionId
    this.queue.push(this.withSession({ type: "text", content: "" }))
  }

  private handleAssistant(raw: Record<string, unknown>): void {
    const message = asRecord(raw.message)
    const content = message?.content
    if (!Array.isArray(content)) return
    for (const itemValue of content) {
      const item = asRecord(itemValue)
      if (!item) continue
      switch (stringValue(item.type)) {
        case "tool_use": {
          const toolName = stringValue(item.name) ?? ""
          if (toolName === "AskUserQuestion") break
          this.queue.push(this.withSession({
            type: "toolUse",
            toolName,
            toolInput: summarizeInput(toolName, item.input),
            toolInputRaw: asRecord(item.input) ?? undefined,
          }))
          break
        }
        case "thinking": {
          const thinking = stringValue(item.thinking)
          if (thinking) this.queue.push(this.withSession({ type: "thinking", content: thinking }))
          break
        }
        case "text": {
          const text = stringValue(item.text)
          if (text) this.queue.push(this.withSession({ type: "text", content: text }))
          break
        }
        default:
          break
      }
    }
  }

  private handleResult(raw: Record<string, unknown>): void {
    const sessionId = stringValue(raw.session_id)
    if (sessionId) this.sessionId = sessionId
    this.queue.push(this.withSession({
      type: "result",
      content: stringValue(raw.result) ?? "",
      done: true,
    }))
  }

  private handleControlRequest(raw: Record<string, unknown>): void {
    const requestId = stringValue(raw.request_id)
    const request = asRecord(raw.request)
    if (!requestId || !request || stringValue(request.subtype) !== "can_use_tool") return
    const toolName = stringValue(request.tool_name) ?? ""
    const input = asRecord(request.input) ?? undefined
    this.queue.push(this.withSession({
      type: "permissionRequest",
      requestId,
      toolName,
      toolInput: summarizeInput(toolName, input),
      toolInputRaw: input,
      questions: toolName === "AskUserQuestion" ? parseUserQuestions(input) : undefined,
    }))
  }

  private withSession<T extends AgentEvent>(event: T): T {
    if (!this.sessionId) return event
    return {
      ...event,
      agentSessionId: this.sessionId,
      threadId: this.sessionId,
    }
  }
}

class AsyncEventQueue {
  private readonly values: AgentEvent[] = []
  private readonly waiters: Array<(value: AgentEvent | null) => void> = []
  private closed = false

  push(event: AgentEvent): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(event)
      return
    }
    this.values.push(event)
  }

  next(): Promise<AgentEvent | null> {
    const value = this.values.shift()
    if (value) return Promise.resolve(value)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter(null)
    }
  }
}

function parseRecord(line: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(line))
  } catch {
    return null
  }
}

function summarizeInput(toolName: string, input: unknown): string {
  const record = asRecord(input)
  if (toolName === "Bash") {
    return stringValue(record?.command) ?? stringFromUnknown(input)
  }
  if (record?.file_path) {
    return stringValue(record.file_path) ?? stringFromUnknown(input)
  }
  return stringFromUnknown(input)
}

function parseUserQuestions(input: Record<string, unknown> | undefined): AgentUserQuestion[] | undefined {
  const questions = input?.questions
  if (!Array.isArray(questions)) return undefined
  return questions.flatMap((value): AgentUserQuestion[] => {
    const record = asRecord(value)
    if (!record) return []
    const question = stringValue(record.question)
    if (!question) return []
    return [{
      question,
      header: stringValue(record.header),
      options: parseQuestionOptions(record.options),
      multiSelect: typeof record.multiSelect === "boolean" ? record.multiSelect : undefined,
    }]
  })
}

function parseQuestionOptions(value: unknown): AgentUserQuestion["options"] {
  if (!Array.isArray(value)) return undefined
  const options = value.flatMap((item): NonNullable<AgentUserQuestion["options"]>[number][] => {
    const record = asRecord(item)
    const label = stringValue(record?.label)
    if (!label) return []
    return [{ label, description: stringValue(record?.description) }]
  })
  return options.length > 0 ? options : undefined
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
