import type { SynapseInboundAttachment, SynapseInboundMessage } from "../../src/types/connector"
import type { SynapseConnectorSessionTurn } from "../../src/types/agent-session"
import {
  AgentEngineService,
  type AgentEngineTurnResult,
} from "./agent-engine-service"
import {
  AgentSessionsRepository,
  type AgentSessionRecord,
} from "./sessions-repository-service"
import type { SynapseAgentEvent } from "./session-event-service"

export type AgentSessionConnectInput = {
  inbound: SynapseInboundMessage
  events: SynapseAgentEvent[]
  repository: AgentSessionsRepository
  engine?: AgentEngineService
  agentType?: string
  now?: () => Date
}

export type AgentSessionConnectResult = {
  turn: SynapseConnectorSessionTurn
  session: AgentSessionRecord
  engineResult: AgentEngineTurnResult
  outbound:
    | {
        kind: "reply"
        content: string
        replyContext?: unknown
      }
    | {
        kind: "pending"
        reason: "permission"
        replyContext?: unknown
      }
    | {
        kind: "error"
        content: string
        replyContext?: unknown
      }
}

function attachmentLine(attachment: SynapseInboundAttachment): string {
  const label = attachment.name ?? attachment.ref ?? attachment.url ?? attachment.kind
  return `- ${attachment.kind}: ${label}`
}

export function buildConnectorSessionPrompt(inbound: SynapseInboundMessage): string {
  const sections = [inbound.content.trim()].filter(Boolean)

  if (inbound.extraContent?.trim()) {
    sections.push(inbound.extraContent.trim())
  }

  if (inbound.location) {
    const label = inbound.location.label ? ` (${inbound.location.label})` : ""
    sections.push(`Location: ${inbound.location.latitude}, ${inbound.location.longitude}${label}`)
  }

  if (inbound.attachments.length > 0) {
    sections.push(`Attachments:\n${inbound.attachments.map(attachmentLine).join("\n")}`)
  }

  return sections.join("\n\n")
}

function resultOutbound(
  result: AgentEngineTurnResult,
  replyContext: unknown,
): AgentSessionConnectResult["outbound"] {
  if (result.status === "waiting_permission") {
    return {
      kind: "pending",
      reason: "permission",
      ...(replyContext !== undefined ? { replyContext } : undefined),
    }
  }

  if (result.status === "error" || result.status === "timed_out") {
    return {
      kind: "error",
      content: result.error ?? "agent session failed",
      ...(replyContext !== undefined ? { replyContext } : undefined),
    }
  }

  return {
    kind: "reply",
    content: result.response,
    ...(replyContext !== undefined ? { replyContext } : undefined),
  }
}

export class AgentSessionConnectService {
  connect(input: AgentSessionConnectInput): AgentSessionConnectResult {
    const now = input.now ?? (() => new Date())
    const engine = input.engine ?? new AgentEngineService({ now })
    const session = input.repository.getOrCreateActive(input.inbound.sessionKey)
    const prompt = buildConnectorSessionPrompt(input.inbound)

    input.repository.setUserMeta(input.inbound.sessionKey, {
      ...(input.inbound.userName ? { userName: input.inbound.userName } : undefined),
      ...(input.inbound.chatName ? { chatName: input.inbound.chatName } : undefined),
    })

    const engineResult = engine.processTurn({
      sessionId: session.id,
      sessionKey: input.inbound.sessionKey,
      prompt,
      events: input.events,
      repository: input.repository,
      now,
    })

    if (input.agentType && engineResult.agentSessionId) {
      input.repository.setAgentInfo(session.id, input.agentType, engineResult.agentSessionId)
    } else if (engineResult.agentSessionId) {
      input.repository.setAgentSessionId(session.id, engineResult.agentSessionId)
    }

    const updatedSession = input.repository.findById(session.id) ?? session

    return {
      turn: {
        inbound: input.inbound,
        sessionId: session.id,
        prompt,
        ...(input.inbound.replyContext !== undefined ? { replyContext: input.inbound.replyContext } : undefined),
      },
      session: updatedSession,
      engineResult,
      outbound: resultOutbound(engineResult, input.inbound.replyContext),
    }
  }
}
