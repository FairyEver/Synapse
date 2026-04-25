import type { SynapseAgentEvent } from "./session-event-service"

export type RelayBinding = {
  platform: string
  chatId: string
  bots: Record<string, string>
}

export type RelayRequest = {
  from: string
  to: string
  sessionKey: string
  message: string
}

export type RelayResponse = {
  response: string
  timedOut: boolean
  groupMessages: string[]
}

export type RelayTurnInput = {
  fromProject: string
  toProject: string
  chatId: string
  message: string
  events: SynapseAgentEvent[]
  eventGapsMs?: number[]
  timeoutMs?: number
}

export type RelayTurnResult =
  | { status: "completed"; response: string; textParts: string[]; autoApprovedRequestIds: string[] }
  | { status: "partial_timeout"; response: string; textParts: string[]; autoApprovedRequestIds: string[] }
  | { status: "timeout"; error: string; textParts: string[]; autoApprovedRequestIds: string[] }
  | { status: "error"; error: string; textParts: string[]; autoApprovedRequestIds: string[] }

export type RelayHandler = (input: RelayTurnInput) => RelayTurnResult

export const DEFAULT_RELAY_TIMEOUT_MS = 120_000

export function parseRelaySessionKey(sessionKey: string): { platform: string; chatId: string } {
  const parts = sessionKey.split(":")
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`invalid session key format: ${JSON.stringify(sessionKey)}`)
  }
  if (parts[0] === "relay" && parts.length >= 3) {
    return { platform: "relay", chatId: parts.slice(2).join(":") }
  }
  return { platform: parts[0], chatId: parts[1] }
}

export function truncateRelayResponse(value: string, maxLength: number): string {
  const chars = Array.from(value)
  if (chars.length <= maxLength) {
    return value
  }
  return `${chars.slice(0, maxLength).join("")}...`
}

function eventText(event: SynapseAgentEvent): string {
  return event.content ?? event.toolResult ?? ""
}

export function processRelayTurn(input: RelayTurnInput): RelayTurnResult {
  const timeoutMs = input.timeoutMs ?? DEFAULT_RELAY_TIMEOUT_MS
  const textParts: string[] = []
  const autoApprovedRequestIds: string[] = []

  for (let index = 0; index < input.events.length; index += 1) {
    const gap = input.eventGapsMs?.[index] ?? 0
    if (timeoutMs > 0 && gap > timeoutMs) {
      if (textParts.length > 0) {
        return {
          status: "partial_timeout",
          response: textParts.join(""),
          textParts,
          autoApprovedRequestIds,
        }
      }
      return {
        status: "timeout",
        error: "relay response timed out",
        textParts,
        autoApprovedRequestIds,
      }
    }

    const event = input.events[index]
    if (!event) {
      continue
    }

    if (event.type === "text" && event.content) {
      textParts.push(event.content)
    } else if (event.type === "tool_result") {
      const content = eventText(event).trim()
      if (content) {
        textParts.push(`${event.toolName?.trim() || "tool"}: ${content}\n\n`)
      }
    } else if (event.type === "permission_request") {
      if (event.requestId) {
        autoApprovedRequestIds.push(event.requestId)
      }
    } else if (event.type === "result") {
      const response = event.content || textParts.join("") || "(empty response)"
      return {
        status: "completed",
        response,
        textParts,
        autoApprovedRequestIds,
      }
    } else if (event.type === "error") {
      return {
        status: "error",
        error: event.error ?? event.content ?? "agent error",
        textParts,
        autoApprovedRequestIds,
      }
    }
  }

  if (textParts.length > 0) {
    return {
      status: "completed",
      response: textParts.join(""),
      textParts,
      autoApprovedRequestIds,
    }
  }

  return {
    status: "error",
    error: "relay: agent process exited without response",
    textParts,
    autoApprovedRequestIds,
  }
}

export class RelayService {
  private readonly bindings = new Map<string, RelayBinding>()
  private readonly handlers = new Map<string, RelayHandler>()
  private timeoutMs = DEFAULT_RELAY_TIMEOUT_MS

  setTimeoutMs(timeoutMs: number): void {
    this.timeoutMs = Math.max(0, timeoutMs)
  }

  registerHandler(projectName: string, handler: RelayHandler): void {
    this.handlers.set(projectName, handler)
  }

  bind(platform: string, chatId: string, bots: Record<string, string>): RelayBinding {
    const binding = {
      platform,
      chatId,
      bots: { ...bots },
    }
    this.bindings.set(chatId, binding)
    return { ...binding, bots: { ...binding.bots } }
  }

  addToBind(platform: string, chatId: string, projectName: string): RelayBinding {
    const binding = this.bindings.get(chatId) ?? { platform, chatId, bots: {} }
    binding.bots[projectName] = projectName
    this.bindings.set(chatId, binding)
    return { ...binding, bots: { ...binding.bots } }
  }

  removeFromBind(chatId: string, projectName: string): boolean {
    const binding = this.bindings.get(chatId)
    if (!binding || !(projectName in binding.bots)) {
      return false
    }
    delete binding.bots[projectName]
    if (Object.keys(binding.bots).length === 0) {
      this.bindings.delete(chatId)
    }
    return true
  }

  listBoundBots(chatId: string, selfProject: string): Record<string, string> {
    const binding = this.bindings.get(chatId)
    if (!binding) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(binding.bots).filter(([project]) => project !== selfProject),
    )
  }

  send(request: RelayRequest): RelayResponse {
    const { platform, chatId } = parseRelaySessionKey(request.sessionKey)
    const binding = this.bindings.get(chatId)
    if (!binding) {
      throw new Error("relay: no binding for this chat. Use /bind <project> first")
    }
    if (!(request.to in binding.bots)) {
      const availableTargets = Object.keys(binding.bots)
        .filter((project) => project !== request.from)
        .join(", ")
      throw new Error(`relay: project ${JSON.stringify(request.to)} is not bound in this chat. Available targets: ${availableTargets} (use the exact name)`)
    }

    const handler = this.handlers.get(request.to)
    if (!handler) {
      throw new Error(`relay: target engine ${JSON.stringify(request.to)} not found (is the project running?)`)
    }

    const fromName = binding.bots[request.from] || request.from
    const toName = binding.bots[request.to] || request.to
    const groupMessages = [`[${fromName} -> ${toName}] ${request.message}`]
    const turn = handler({
      fromProject: request.from,
      toProject: request.to,
      chatId,
      message: request.message,
      events: [],
      timeoutMs: this.timeoutMs,
    })

    if (turn.status === "error" || turn.status === "timeout") {
      throw new Error(turn.error)
    }

    groupMessages.push(`[${toName}] ${truncateRelayResponse(turn.response, 2000)}`)
    return {
      response: turn.response,
      timedOut: turn.status === "partial_timeout",
      groupMessages: platform === "relay" ? groupMessages.map((message) => `[relay] ${message}`) : groupMessages,
    }
  }
}
