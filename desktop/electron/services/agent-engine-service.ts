import type { AgentSessionsRepository, SessionHistoryEntry } from "./sessions-repository-service"
import { SessionEventLog, type SynapseAgentEvent, type SynapseSessionEventRecord } from "./session-event-service"

export type AgentEngineStatus =
  | "idle"
  | "running"
  | "waiting_permission"
  | "completed"
  | "error"
  | "stopped"
  | "timed_out"

export type AgentEngineTurnInput = {
  sessionId: string
  sessionKey?: string
  prompt: string
  events: SynapseAgentEvent[]
  eventGapsMs?: number[]
  idleTimeoutMs?: number
  autoApprovePermissions?: boolean
  stopAfterEvents?: number
  now?: () => Date
  repository?: AgentSessionsRepository
}

export type AgentEngineTurnResult = {
  status: AgentEngineStatus
  response: string
  textSegments: string[]
  toolCount: number
  pendingPermission: SynapseAgentEvent | null
  agentSessionId: string | null
  history: SessionHistoryEntry[]
  records: SynapseSessionEventRecord[]
  error: string | null
}

export type BusyMessage = {
  content: string
  replyContext?: unknown
  images?: unknown[]
  files?: unknown[]
}

export const MAX_QUEUED_MESSAGES = 5

function resultContent(event: SynapseAgentEvent, textSegments: readonly string[]): string {
  const content = event.content?.trim()
  if (content) {
    return event.content ?? ""
  }

  const joined = textSegments.join("")
  return joined || ""
}

function appendHistory(
  repository: AgentSessionsRepository | undefined,
  sessionId: string,
  entry: Omit<SessionHistoryEntry, "timestamp">,
  now: () => Date,
): SessionHistoryEntry {
  const historyEntry = {
    ...entry,
    timestamp: now().toISOString(),
  }

  repository?.appendHistory(sessionId, historyEntry)
  return historyEntry
}

export class AgentEngineService {
  private readonly eventLog: SessionEventLog
  private readonly now: () => Date

  constructor(options: { eventLog?: SessionEventLog; now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date())
    this.eventLog = options.eventLog ?? new SessionEventLog({ now: this.now })
  }

  processTurn(input: AgentEngineTurnInput): AgentEngineTurnResult {
    const now = input.now ?? this.now
    const history: SessionHistoryEntry[] = []
    const records: SynapseSessionEventRecord[] = []
    const textSegments: string[] = []
    let status: AgentEngineStatus = "running"
    let response = ""
    let toolCount = 0
    let pendingPermission: SynapseAgentEvent | null = null
    let agentSessionId: string | null = null
    let error: string | null = null

    history.push(appendHistory(input.repository, input.sessionId, {
      role: "user",
      content: input.prompt,
    }, now))

    for (let index = 0; index < input.events.length; index += 1) {
      if (typeof input.stopAfterEvents === "number" && index >= input.stopAfterEvents) {
        status = "stopped"
        break
      }

      const gap = input.eventGapsMs?.[index] ?? 0
      if (input.idleTimeoutMs && gap > input.idleTimeoutMs) {
        status = "timed_out"
        error = "agent session timed out (no response)"
        records.push(this.eventLog.append(input.sessionId, { type: "error", error }))
        break
      }

      const event = input.events[index]
      if (!event) {
        continue
      }
      records.push(this.eventLog.append(input.sessionId, event))

      switch (event.type) {
        case "text":
          if (event.content) {
            textSegments.push(event.content)
          }
          if (event.sessionId) {
            agentSessionId = event.sessionId
          }
          break
        case "tool_use":
          toolCount += 1
          break
        case "permission_request":
          if (!input.autoApprovePermissions) {
            status = "waiting_permission"
            pendingPermission = event
            return {
              status,
              response,
              textSegments,
              toolCount,
              pendingPermission,
              agentSessionId,
              history,
              records,
              error,
            }
          }
          break
        case "result":
          if (event.sessionId) {
            agentSessionId = event.sessionId
          }
          response = resultContent(event, textSegments)
          status = "completed"
          history.push(appendHistory(input.repository, input.sessionId, {
            role: "assistant",
            content: response,
          }, now))
          return {
            status,
            response,
            textSegments,
            toolCount,
            pendingPermission,
            agentSessionId,
            history,
            records,
            error,
          }
        case "error":
          status = "error"
          error = event.error ?? event.content ?? "agent error"
          return {
            status,
            response,
            textSegments,
            toolCount,
            pendingPermission,
            agentSessionId,
            history,
            records,
            error,
          }
      }
    }

    return {
      status,
      response,
      textSegments,
      toolCount,
      pendingPermission,
      agentSessionId,
      history,
      records,
      error,
    }
  }
}

export function queueBusyMessage(queue: readonly BusyMessage[], message: BusyMessage, max = MAX_QUEUED_MESSAGES): BusyMessage[] | null {
  if (queue.length >= max) {
    return null
  }

  return [...queue, message]
}

export function dequeueBusyMessage(queue: readonly BusyMessage[]): { message: BusyMessage | null; remaining: BusyMessage[] } {
  const [message, ...remaining] = queue
  return {
    message: message ?? null,
    remaining,
  }
}
