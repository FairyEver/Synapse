export type SynapseSessionEventType =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "permission_request"
  | "permission_response"
  | "result"
  | "error"

export type SynapseAgentEvent = {
  type: SynapseSessionEventType | string
  content?: string
  toolName?: string
  toolInput?: string
  toolInputRaw?: Record<string, unknown>
  toolResult?: string
  toolStatus?: string
  toolExitCode?: number
  toolSuccess?: boolean
  sessionId?: string
  requestId?: string
  questions?: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiSelect?: boolean
  }>
  permissionDecision?: "allow" | "deny"
  permissionMessage?: string
  done?: boolean
  error?: string
  inputTokens?: number
  outputTokens?: number
}

export type SynapseSessionEventRecord = {
  sessionId: string
  seq: number
  type: SynapseSessionEventType
  timestamp: string
  payload: Record<string, unknown>
}

export type SessionEventPublisher = (record: SynapseSessionEventRecord) => void

function normalizeEventType(type: string): SynapseSessionEventType {
  switch (type) {
    case "text":
    case "thinking":
    case "tool_use":
    case "tool_result":
    case "permission_request":
    case "permission_response":
    case "result":
    case "error":
      return type
    default:
      return "error"
  }
}

export function mapAgentEventPayload(event: SynapseAgentEvent): Record<string, unknown> {
  const type = normalizeEventType(event.type)

  if (type === "tool_use") {
    return {
      toolName: event.toolName ?? "",
      toolInput: event.toolInput ?? "",
    }
  }

  if (type === "tool_result") {
    return {
      toolName: event.toolName ?? "",
      toolResult: event.toolResult ?? event.content ?? "",
      ...(event.toolStatus ? { toolStatus: event.toolStatus } : undefined),
      ...(typeof event.toolExitCode === "number" ? { toolExitCode: event.toolExitCode } : undefined),
      ...(typeof event.toolSuccess === "boolean" ? { toolSuccess: event.toolSuccess } : undefined),
    }
  }

  if (type === "permission_request") {
    return {
      requestId: event.requestId ?? "",
      toolName: event.toolName ?? "",
      toolInput: event.toolInput ?? "",
      toolInputRaw: event.toolInputRaw ?? {},
      questions: event.questions ?? [],
    }
  }

  if (type === "permission_response") {
    return {
      requestId: event.requestId ?? "",
      decision: event.permissionDecision ?? "deny",
      ...(event.permissionMessage ? { message: event.permissionMessage } : undefined),
    }
  }

  if (type === "result") {
    return {
      content: event.content ?? "",
      done: event.done ?? true,
      ...(event.sessionId ? { agentSessionId: event.sessionId } : undefined),
      ...(typeof event.inputTokens === "number" ? { inputTokens: event.inputTokens } : undefined),
      ...(typeof event.outputTokens === "number" ? { outputTokens: event.outputTokens } : undefined),
    }
  }

  if (type === "error") {
    return {
      error: event.error ?? event.content ?? "unknown event",
      ...(event.type !== "error" ? { originalType: event.type } : undefined),
    }
  }

  return {
    content: event.content ?? "",
    ...(event.sessionId ? { agentSessionId: event.sessionId } : undefined),
  }
}

export class SessionEventLog {
  private readonly eventsBySession = new Map<string, SynapseSessionEventRecord[]>()
  private readonly publisher?: SessionEventPublisher
  private readonly now: () => Date

  constructor(options: { now?: () => Date; publisher?: SessionEventPublisher } = {}) {
    this.now = options.now ?? (() => new Date())
    this.publisher = options.publisher
  }

  append(sessionId: string, event: SynapseAgentEvent): SynapseSessionEventRecord {
    const current = this.eventsBySession.get(sessionId) ?? []
    const record: SynapseSessionEventRecord = {
      sessionId,
      seq: current.length + 1,
      type: normalizeEventType(event.type),
      timestamp: this.now().toISOString(),
      payload: mapAgentEventPayload(event),
    }

    this.eventsBySession.set(sessionId, [...current, record])
    this.publisher?.(record)
    return record
  }

  list(sessionId: string): SynapseSessionEventRecord[] {
    return (this.eventsBySession.get(sessionId) ?? []).map((event) => ({
      ...event,
      payload: { ...event.payload },
    }))
  }
}
