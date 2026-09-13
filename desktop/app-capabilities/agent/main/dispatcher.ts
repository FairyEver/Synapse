import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import {
  AGENT_CONVERSATION_CAPABILITY_CATALOG,
  AGENT_CONVERSATION_OPEN_CAPABILITY_ID,
} from "../shared/capability"
import {
  AgentConversationCapabilityError,
  AgentConversationNavigationError,
  serializeAgentConversationCapabilityError,
  serializeAgentConversationNavigationError,
} from "../shared/errors"
import { agentConversationInputSchemaForCapability } from "../shared/mcp-tools"
import type {
  AgentConversationOpenInput,
} from "../shared/schema"
import { resolveAgentConversationTargetInput } from "../shared/schema"
import type { AgentConversationControlService } from "./control-service"
import type { AgentConversationNavigationService } from "./service"

const READ_RATE_LIMIT = 60
const WRITE_RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000

const permissionActionByCapability: Readonly<Record<string, PermissionAction>> = {
  "app.agent.group.list": "agent.conversation.read",
  "app.agent.provider.list": "agent.conversation.read",
  "app.agent.conversation.create": "agent.conversation.control",
  "app.agent.conversation.inspect": "agent.conversation.read",
  "app.agent.conversation.observe": "agent.conversation.read",
  "app.agent.message.send": "agent.conversation.control",
  "app.agent.turn.steer": "agent.conversation.control",
  "app.agent.turn.stop": "agent.conversation.stop",
  "app.agent.turn.force_stop": "agent.conversation.forceStop",
  "app.agent.permission.respond": "agent.permission.respond",
}

export function createAgentConversationCapabilityDispatcher(deps: {
  readonly service: AgentConversationNavigationService
  readonly controlService?: AgentConversationControlService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
}) {
  const rateWindows = new Map<string, number[]>()
  return {
    async dispatch(
      action: string,
      params: Record<string, unknown>,
      context: DispatchContext,
    ): Promise<DispatchResult> {
      let audit: { permissionAction: PermissionAction; resource: string; metadata: Record<string, unknown> } | undefined
      try {
        const metadata = AGENT_CONVERSATION_CAPABILITY_CATALOG.find((item) => item.id === action)
        if (!metadata) throw new AgentConversationCapabilityError("invalid_input")
        const schema = agentConversationInputSchemaForCapability(action)
        const parsed = schema?.parse(params) as Record<string, unknown> | undefined
        if (!parsed) throw new AgentConversationCapabilityError("invalid_input")
        if (action === AGENT_CONVERSATION_OPEN_CAPABILITY_ID) {
          const result = await deps.service.open(parsed as AgentConversationOpenInput)
          return { ok: true, data: result, affected: 1 }
        }
        if (!deps.controlService) throw new AgentConversationCapabilityError("operation_failed")
        const actor = context.actor ?? deps.actor
        const clientId = context.clientId?.trim()
        if (!actor || !clientId) throw new AgentConversationCapabilityError("invalid_input")
        enforceRateLimit(rateWindows, clientId, metadata.mutates)
        const permissionAction = permissionActionByCapability[action]
        if (!permissionAction) throw new AgentConversationCapabilityError("invalid_input")
        const groupOperation = action === "app.agent.group.list" || action === "app.agent.provider.list" || action === "app.agent.conversation.create"
        let publicTarget: ReturnType<typeof resolveAgentConversationTargetInput> | undefined
        if (!groupOperation) {
          try {
            publicTarget = resolveAgentConversationTargetInput(parsed as AgentConversationOpenInput)
          } catch {
            throw new AgentConversationCapabilityError("invalid_link")
          }
        }
        const resource = publicTarget ? `agent:conversation:${"conversationId" in publicTarget
          ? publicTarget.conversationId
          : publicTarget.conversationRef}` : action === "app.agent.provider.list" ? "agent:providers" : "agent:groups"
        const auditMetadata = buildAuditMetadata(action, { ...parsed, ...publicTarget })
        if (deps.permissionGuard) {
          const permission = await deps.permissionGuard.check({
            action: permissionAction,
            actor,
            resource,
            context: auditMetadata,
          })
          if (!permission.allowed) {
            deps.auditSink?.record({
              action: permissionAction,
              actor,
              resource,
              outcome: "denied",
              metadata: { ...auditMetadata, reason: permission.reason, policyId: permission.policyId },
            })
            throw new AgentConversationCapabilityError("operation_failed")
          }
        }
        audit = { permissionAction, resource, metadata: auditMetadata }
        const normalized: Record<string, unknown> = { ...parsed }
        if (publicTarget) {
          const target = await deps.controlService.resolveTarget(publicTarget)
          Object.assign(normalized, target)
          delete normalized["deepLink"]
          delete normalized["conversationRef"]
        }
        const result = await dispatchControl(deps.controlService, action, normalized, clientId, actor, context.abortSignal)
        if (action === "app.agent.conversation.create") {
          auditMetadata.projectId = result.projectId
          auditMetadata.conversationRef = result.conversationRef
        }
        deps.auditSink?.record({
          action: permissionAction,
          actor,
          resource,
          outcome: "allowed",
          metadata: { ...auditMetadata, result: "success" },
        })
        return { ok: true, data: result, affected: 1 }
      } catch (error) {
        if (audit) {
          const actor = context.actor ?? deps.actor
          if (actor) {
            deps.auditSink?.record({
              action: audit.permissionAction,
              actor,
              resource: audit.resource,
              outcome: "failed",
              metadata: { ...audit.metadata, result: "failed" },
            })
          }
        }
        if (action === AGENT_CONVERSATION_OPEN_CAPABILITY_ID) {
          const serialized = serializeAgentConversationNavigationError(
            isZodError(error) ? new AgentConversationNavigationError("invalid_input") : error,
          )
          return { ok: false, code: serialized.code, error: serialized.message }
        }
        const serialized = serializeAgentConversationCapabilityError(
          isZodError(error) ? new AgentConversationCapabilityError("invalid_input") : error,
        )
        return {
          ok: false,
          code: serialized.code,
          error: serialized.message,
          ...(serialized.data ? { data: serialized.data } : {}),
        }
      }
    },
  }
}

async function dispatchControl(
  service: AgentConversationControlService,
  action: string,
  parsed: Record<string, unknown>,
  clientId: string,
  actor: ActorIdentity,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  switch (action) {
    case "app.agent.provider.list":
      return service.listProviders(parsed as Parameters<AgentConversationControlService["listProviders"]>[0])
    case "app.agent.group.list":
      return service.listGroups(parsed as Parameters<AgentConversationControlService["listGroups"]>[0])
    case "app.agent.conversation.create":
      return service.create(parsed as Parameters<AgentConversationControlService["create"]>[0], clientId)
    case "app.agent.conversation.inspect":
      return service.inspect(parsed as Parameters<AgentConversationControlService["inspect"]>[0])
    case "app.agent.conversation.observe":
      return service.observe(parsed as Parameters<AgentConversationControlService["observe"]>[0], clientId, signal)
    case "app.agent.message.send":
      return service.send(parsed as Parameters<AgentConversationControlService["send"]>[0], clientId)
    case "app.agent.turn.steer":
      return service.steer(parsed as Parameters<AgentConversationControlService["steer"]>[0])
    case "app.agent.turn.stop":
      return service.stop(parsed as Parameters<AgentConversationControlService["stop"]>[0], clientId)
    case "app.agent.turn.force_stop":
      return service.forceStop(parsed as Parameters<AgentConversationControlService["forceStop"]>[0], clientId)
    case "app.agent.permission.respond":
      return service.respondPermission(
        parsed as Parameters<AgentConversationControlService["respondPermission"]>[0],
        clientId,
        actor,
      )
    default:
      throw new AgentConversationCapabilityError("invalid_input")
  }
}

function enforceRateLimit(windows: Map<string, number[]>, clientId: string, mutates: boolean): void {
  const now = Date.now()
  const key = `${clientId}:${mutates ? "write" : "read"}`
  const limit = mutates ? WRITE_RATE_LIMIT : READ_RATE_LIMIT
  const active = (windows.get(key) ?? []).filter((timestamp) => timestamp > now - RATE_WINDOW_MS)
  if (active.length >= limit) throw new AgentConversationCapabilityError("quota_exceeded")
  active.push(now)
  windows.set(key, active)
}

function buildAuditMetadata(action: string, input: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    source: "agent.conversation.mcp",
    capability: action,
    projectId: input.projectId,
    conversationId: input.conversationId,
  }
  if (typeof input.expectedTurnId === "string") metadata.turnId = input.expectedTurnId
  if (typeof input.requestId === "string") metadata.requestId = input.requestId
  if (typeof input.expectedToolName === "string") metadata.toolName = input.expectedToolName
  if (typeof input.content === "string") metadata.contentLength = Buffer.byteLength(input.content, "utf8")
  if (Array.isArray(input.answers)) metadata.answerCount = input.answers.length
  return metadata
}

function isZodError(error: unknown): boolean {
  return error instanceof Error && error.name === "ZodError"
}
