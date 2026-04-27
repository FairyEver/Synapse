import type {
  ControlledProcessSession,
} from "../../../runtime/process"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
} from "../types"
import { CodexJsonLineParser } from "./codex-exec"
import {
  codexAppServerModeSettings,
  permissionEventForCodexServerRequest,
  permissionResponseForCodexServerRequest,
} from "./codex-app-server-protocol"

export interface CodexAppServerArgsOptions {
  readonly provider?: string
  readonly baseUrl?: string
  readonly effort?: string
}

export function buildCodexAppServerArgs(options: CodexAppServerArgsOptions = {}): string[] {
  const args = ["app-server", "--listen", "stdio://"]
  if (options.provider) {
    args.push("-c", `model_provider=${JSON.stringify(options.provider)}`)
  }
  if (options.baseUrl) {
    args.push("-c", `openai_base_url=${JSON.stringify(options.baseUrl)}`)
  }
  if (options.effort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(options.effort)}`)
  }
  return args
}

export interface CodexAppServerLiveOptions {
  readonly model?: string
  readonly provider?: string
  readonly effort?: string
  readonly mode?: string
  readonly workDir: string
  readonly threadId?: string
  readonly codexHome?: string
}

interface JsonRpcError {
  readonly code?: number
  readonly message?: string
}

interface PendingJsonRpc {
  resolve(value: unknown): void
  reject(error: Error): void
}

interface PendingServerRequest {
  readonly id: unknown
  readonly method: string
  readonly params: Record<string, unknown>
}

export class CodexAppServerLiveSession implements AgentLiveSession {
  readonly agentType: string

  private readonly processSession: ControlledProcessSession
  private readonly options: CodexAppServerLiveOptions
  private readonly queue = new AsyncEventQueue()
  private readonly pendingRpc = new Map<string, PendingJsonRpc>()
  private readonly pendingServerRequests = new Map<string, PendingServerRequest>()
  private readonly parser: CodexJsonLineParser
  private nextRequestId = 1
  private sessionId: string | undefined
  private currentTurnId: string | undefined

  constructor(
    processSession: ControlledProcessSession,
    agentType: string,
    options: CodexAppServerLiveOptions,
    bufferedLines: readonly string[] = [],
  ) {
    this.processSession = processSession
    this.agentType = agentType
    this.options = options
    this.sessionId = options.threadId
    this.parser = new CodexJsonLineParser(options.threadId, (event) => this.queue.push(event), {
      model: options.model,
      effort: options.effort,
      workDir: options.workDir,
      codexHome: options.codexHome,
    })
    for (const line of bufferedLines) {
      this.handleLine(line)
    }
    void this.waitForExit()
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "synapse-codex-agent",
        title: "Synapse Codex Agent",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [
          "command/exec/outputDelta",
          "item/agentMessage/delta",
          "item/plan/delta",
          "item/fileChange/outputDelta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/textDelta",
        ],
      },
    })
    await this.notify("initialized", null)
    await this.ensureThread()
  }

  async send(message: AgentMessage): Promise<void> {
    if (!this.sessionId) {
      throw new Error("Codex app-server thread id is empty")
    }

    const params: Record<string, unknown> = {
      threadId: this.sessionId,
      input: [
        {
          type: "text",
          text: message.content,
          text_elements: [],
        },
      ],
    }
    if (this.options.model) params.model = this.options.model
    if (this.options.effort) params.effort = this.options.effort
    const mode = codexAppServerModeSettings(message.modeOverride ?? this.options.mode)
    params.approvalPolicy = mode.approvalPolicy
    params.approvalsReviewer = "user"

    const response = asRecord(await this.request("turn/start", params))
    const turn = asRecord(response?.turn)
    this.currentTurnId = stringValue(turn?.id)
  }

  async respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void> {
    const pending = this.pendingServerRequests.get(requestId)
    if (!pending) {
      throw new Error(`Codex app-server permission request "${requestId}" is not pending`)
    }
    this.pendingServerRequests.delete(requestId)

    const result = permissionResponseForCodexServerRequest(pending, decision)
    if (result instanceof Error) {
      await this.writeJsonLine({
        jsonrpc: "2.0",
        id: pending.id,
        error: {
          code: -32000,
          message: result.message,
        },
      })
      return
    }

    await this.writeJsonLine({
      jsonrpc: "2.0",
      id: pending.id,
      result,
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

  handleLine(line: string): void {
    const raw = parseRecord(line)
    if (!raw) return
    const method = stringValue(raw.method)
    const hasId = Object.prototype.hasOwnProperty.call(raw, "id")
    if (method && hasId) {
      this.handleServerRequest(raw, method)
      return
    }
    if (hasId) {
      this.handleClientResponse(raw)
      return
    }
    if (method) {
      this.handleNotification(method, raw.params)
    }
  }

  private async ensureThread(): Promise<void> {
    const mode = codexAppServerModeSettings(this.options.mode)
    const params: Record<string, unknown> = {
      experimentalRawEvents: false,
      persistExtendedHistory: false,
      approvalPolicy: mode.approvalPolicy,
      approvalsReviewer: "user",
      sandbox: mode.sandbox,
    }
    if (this.options.model) params.model = this.options.model
    if (this.options.provider) params.modelProvider = this.options.provider

    const method = this.options.threadId ? "thread/resume" : "thread/start"
    if (this.options.threadId) {
      params.threadId = this.options.threadId
      params.persistExtendedHistory = true
    }

    const response = asRecord(await this.request(method, params))
    const thread = asRecord(response?.thread)
    const threadId = stringValue(thread?.id)
    if (!threadId) {
      throw new Error(`codex app-server ${method} returned empty thread id`)
    }
    this.sessionId = threadId
    this.parser.pushLine(JSON.stringify({ type: "thread.started", thread_id: threadId }))
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextRequestId
    this.nextRequestId += 1
    const key = rpcKey(id)
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRpc.set(key, { resolve, reject })
    })
    void this.writeJsonLine({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
      const pending = this.pendingRpc.get(key)
      this.pendingRpc.delete(key)
      const pendingError = error instanceof Error ? error : new Error(String(error))
      pending?.reject(pendingError)
    })
    return promise
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.writeJsonLine({ jsonrpc: "2.0", method, params })
  }

  private async writeJsonLine(value: unknown): Promise<void> {
    await this.processSession.writeStdin(`${JSON.stringify(value)}\n`)
  }

  private handleClientResponse(raw: Record<string, unknown>): void {
    const key = rpcKey(raw.id)
    const pending = this.pendingRpc.get(key)
    if (!pending) return
    this.pendingRpc.delete(key)

    const error = asRecord(raw.error) as JsonRpcError | null
    if (error) {
      pending.reject(new Error(error.message ?? "codex app-server request failed"))
      return
    }
    pending.resolve(raw.result)
  }

  private handleServerRequest(raw: Record<string, unknown>, method: string): void {
    const requestId = stringFromUnknown(raw.id)
    if (!requestId) return
    const params = asRecord(raw.params) ?? {}
    this.pendingServerRequests.set(requestId, {
      id: raw.id,
      method,
      params,
    })

    const permission = permissionEventForCodexServerRequest(requestId, { method, params })
    if (permission) {
      this.queue.push(this.withSession(permission))
      return
    }

    const result = permissionResponseForCodexServerRequest({ method, params }, { behavior: "deny" })
    const message = result instanceof Error
      ? result.message
      : `Unsupported codex app-server request: ${method}`
    void this.writeJsonLine({
      jsonrpc: "2.0",
      id: raw.id,
      error: {
        code: method === "account/chatgptAuthTokens/refresh" ? -32000 : -32601,
        message,
      },
    })
    this.pendingServerRequests.delete(requestId)
  }

  private handleNotification(method: string, paramsValue: unknown): void {
    const params = asRecord(paramsValue)
    switch (method) {
      case "turn/started": {
        const turn = asRecord(params?.turn)
        this.currentTurnId = stringValue(turn?.id)
        this.parser.pushLine(JSON.stringify({ type: "turn.started" }))
        break
      }
      case "item/started":
        this.parser.pushLine(JSON.stringify({
          type: "item.started",
          item: asRecord(params?.item) ?? undefined,
        }))
        break
      case "item/completed":
        this.parser.pushLine(JSON.stringify({
          type: "item.completed",
          item: asRecord(params?.item) ?? undefined,
        }))
        break
      case "turn/completed":
        this.parser.pushLine(JSON.stringify({ type: "turn.completed" }))
        break
      case "error": {
        const error = asRecord(params?.error)
        this.parser.pushError(stringValue(error?.message) ?? "codex app-server error")
        break
      }
      default:
        break
    }
  }

  private withSession<T extends AgentEvent>(event: T): T {
    if (!this.sessionId) return event
    return {
      ...event,
      agentSessionId: this.sessionId,
      threadId: this.sessionId,
    } as T
  }

  private async waitForExit(): Promise<void> {
    const result = await this.processSession.wait()
    this.rejectPendingRpc(trimmedOrDefault(result.error ?? result.stderr, "codex app-server exited"))
    if (result.error || (result.exitCode !== 0 && result.exitCode !== null)) {
      this.queue.push(this.withSession({
        type: "error",
        message: trimmedOrDefault(
          result.error ?? result.stderr,
          `codex app-server exited with code ${String(result.exitCode)}`,
        ),
      }))
    }
    this.queue.close()
  }

  private rejectPendingRpc(message: string): void {
    const pending = [...this.pendingRpc.values()]
    this.pendingRpc.clear()
    for (const entry of pending) {
      entry.reject(new Error(message))
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

function rpcKey(id: unknown): string {
  return typeof id === "string" || typeof id === "number" ? String(id) : stringFromUnknown(id)
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

function trimmedOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}
