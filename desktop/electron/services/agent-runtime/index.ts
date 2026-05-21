import type {
  AgentCommandEntryV1,
  AgentCompressStateEntryV1,
  AgentEventEntryV1,
  ConversationEntryV1,
  DataRepository,
  OutboxEntryV1,
} from "../../runtime/data-repo"
import type { ProjectScopedService } from "../../runtime/project-container"
import {
  createControlledProcessRunner,
} from "../../runtime/process"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { ServiceNotFoundError } from "../../runtime/service-registry"
import type { ProcessIsolationResolver } from "../execution-isolation"
import { configStore } from "../config-store"
import { createKnowledgeBaseAgentContribution } from "../knowledge-base/agent-contribution"
import {
  createProviderServiceFromDataRepository,
} from "../provider"
import { ReplyOutboxService } from "../reply-target"
import { AgentRuntimeService, type AgentRuntimeServiceDeps } from "./agent-runtime-service"
import { CustomCommandRegistry } from "./command-registry"
import { mergeAgentProjectContributions } from "./project-contributions"
import { SkillRegistry } from "./skill-registry"
import { AGENT_RUNTIME_SERVICE_ID } from "./types"

export {
  AgentRuntimeService,
  conversationId,
  type AgentRuntimeStatus,
  type AgentRuntimeServiceDeps,
} from "./agent-runtime-service"
export {
  AgentCommandRouter,
  modesForAgent,
  parseCommand,
  parseModelSwitchArgs,
  resolveModelTarget,
  type AgentCommandRouterResult,
  type AgentCommandRouterDeps,
  type AgentPromptCommandRoute,
  type RegisteredPromptCommand,
  type RegisteredPromptCommandSource,
} from "./command-router"
export {
  BUILTIN_COMMANDS,
  CustomCommandRegistry,
  commandAllowedOnPlatform,
  expandCustomCommandPrompt,
  normalizeCommandName,
  type PublishedAgentCommand,
} from "./command-registry"
export {
  AgentGovernanceService,
  MessageDedupe,
  OutgoingTokenBucketLimiter,
  RolePolicyManager,
  SlidingWindowRateLimiter,
  type AgentGovernanceConfig,
  type AgentGovernanceDecision,
  type RateLimitConfig,
  type RolePolicyInput,
  type TokenBucketConfig,
} from "./governance"
export {
  AgentSessionRepository,
  type AgentSessionRepositoryOptions,
  type CreateAgentSessionInput,
  type SaveAgentSessionInput,
} from "./session-repository"
export {
  SessionManager,
  type AgentLiveSessionHandle,
  type AgentLiveSessionFactory,
  type CreateAgentLiveSessionInput,
} from "./session-manager"
export {
  ConversationRouter,
  type ConversationRouterDeps,
} from "./conversation-router"
export {
  SkillRegistry,
  buildSkillInvocationPrompt,
  type AgentSkill,
} from "./skill-registry"
export {
  mergeAgentProjectContributions,
  type AgentProjectContribution,
  type AgentProjectMessageContext,
} from "./project-contributions"
export {
  AGENT_RUNTIME_SERVICE_ID,
  type AgentAttachment,
  type AgentEvent,
  type AgentLiveSession,
  type AgentMessage,
  type AgentPendingPermission,
  type AgentPermissionDecision,
  type AgentPermissionRequestEvent,
  type AgentPermissionResponseRequest,
  type AgentRuntimeTurnResult,
  type AgentRuntimeRelayResult,
  type AgentUserQuestion,
  type AgentUserQuestionOption,
  type AgentResultMetadata,
  type AgentThinkingEvent,
  type AgentToolUseEvent,
} from "./types"

export function createAgentRuntimeProjectService(): ProjectScopedService<AgentRuntimeService> {
  return {
    id: AGENT_RUNTIME_SERVICE_ID,
    async create(ctx) {
      const permissionGuard = ctx.globalRegistry.get<PermissionGuard>("core.permission-guard")
      const auditSink = ctx.globalRegistry.get<AuditSink>("core.audit-sink")
      const dataRepository = ctx.globalRegistry.get<DataRepository>("core.data-repository")
      const runner = createControlledProcessRunner({ permissionGuard, auditSink })
      const outbox = new ReplyOutboxService({
        projectId: ctx.projectId,
        outbox: ctx.dataRepo.namespace<OutboxEntryV1>("outbox"),
        logger: ctx.logger,
      })
      const providerService = createProviderServiceFromDataRepository({
        dataRepository,
        permissionGuard,
        auditSink,
      })
      const replyTargets = optionalService<NonNullable<AgentRuntimeServiceDeps["replyTargets"]>>(
        ctx.globalRegistry,
        "core.side-channel",
      )
      const executionIsolation = optionalService<ProcessIsolationResolver>(
        ctx.globalRegistry,
        "core.execution-isolation",
      )
      const customCommands = new CustomCommandRegistry({
        projectId: ctx.projectId,
        commands: ctx.dataRepo.namespace<AgentCommandEntryV1>("agent.commands"),
        workspacePath: ctx.projectMeta.workspacePath,
        logger: ctx.logger,
      })
      const skills = new SkillRegistry({
        projectId: ctx.projectId,
        workspacePath: ctx.projectMeta.workspacePath,
        logger: ctx.logger,
      })
      const service = new AgentRuntimeService({
        projectId: ctx.projectId,
        workDir: ctx.projectMeta.workspacePath,
        conversations: ctx.dataRepo.namespace<ConversationEntryV1>("conversations"),
        compressState: ctx.dataRepo.namespace<AgentCompressStateEntryV1>("agent.compress_state"),
        agentEvents: ctx.dataRepo.namespace<AgentEventEntryV1>("agent.events"),
        providerService,
        agentType: "claude-code",
        eventBus: ctx.eventBus,
        logger: ctx.logger,
        permissionGuard,
        auditSink,
        outbox,
        replyTargets,
        executionIsolation,
        customCommands,
        skills,
        commandRunner: runner,
        registeredPromptCommands: async () =>
          (await resolveAgentProjectContribution(ctx.projectId)).commands,
        prepareMessage: async (message, context) => {
          const contribution = await resolveAgentProjectContribution(ctx.projectId)
          return contribution.prepareMessage?.(message, context) ?? message
        },
      })
      service.startIdleReclaim()
      return service
    },
    stop(instance) {
      instance.stopIdleReclaim()
    },
  }
}

async function resolveAgentProjectContribution(projectId: string) {
  const appConfig = await configStore.load()
  const project = appConfig.global.projects.find((item) => item.id === projectId)
  const contributions = [
    project ? await createKnowledgeBaseAgentContribution({ project }) : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null)
  return mergeAgentProjectContributions(contributions)
}

function optionalService<T>(registry: { get<U>(id: string): U }, id: string): T | undefined {
  try {
    return registry.get<T>(id)
  } catch (error) {
    if (!(error instanceof ServiceNotFoundError)) {
      throw error
    }
    return undefined
  }
}
