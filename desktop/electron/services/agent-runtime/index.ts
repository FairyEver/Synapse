import type {
  AgentCommandEntryV1,
  AgentCompressStateEntryV1,
  AgentEventEntryV1,
  AgentUsageEntryV1,
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
import {
  createProviderServiceFromDataRepository,
} from "../provider"
import { getUsageAnalysisDb } from "../usage-analysis"
import { listModelPriceRules } from "../model-price"
import { ReplyOutboxService } from "../reply-target"
import { AgentRuntimeService, type AgentRuntimeServiceDeps } from "./agent-runtime-service"
import { CustomCommandRegistry } from "./command-registry"
import { validateWorkspaceDirectory } from "./session-manager"
import { SkillRegistry } from "./skill-registry"
import { AGENT_RUNTIME_SERVICE_ID } from "./types"
import type { AgentMessage } from "./types"

export const MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS = new Set([
  "autoresearch",
  "canvas",
  "defuddle",
  "obsidian-bases",
  "obsidian-markdown",
  "save",
  "wiki",
  "wiki-fold",
  "wiki-ingest",
  "wiki-lint",
  "wiki-query",
])

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
  validateWorkspaceDirectory,
  WorkspacePathUnavailableError,
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
  type ScheduledAgentSourcePlatform,
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
      const isManagedKnowledgeBase = ctx.projectMeta.managedKnowledgeBase === true
      const isManagedKnowledgeBaseRendererMessage = (message: AgentMessage) =>
        isManagedKnowledgeBase
        && message.platform === "local-renderer"
        && typeof ctx.projectMeta.workspacePath === "string"
        && ctx.projectMeta.workspacePath.length > 0
      const service = new AgentRuntimeService({
        projectId: ctx.projectId,
        workDir: ctx.projectMeta.workspacePath,
        validateWorkspacePath: validateWorkspaceDirectory,
        conversations: ctx.dataRepo.namespace<ConversationEntryV1>("conversations"),
        compressState: ctx.dataRepo.namespace<AgentCompressStateEntryV1>("agent.compress_state"),
        agentEvents: ctx.dataRepo.namespace<AgentEventEntryV1>("agent.events"),
        agentUsage: ctx.dataRepo.namespace<AgentUsageEntryV1>("agent.usage"),
        getUsagePriceRules: () => listModelPriceRules(getUsageAnalysisDb()),
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
        registeredPromptCommands: async () => [],
        publishedProjectCommands: async () => [],
        sdkPlugins: async (message) => isManagedKnowledgeBaseRendererMessage(message)
          ? [{ type: "local", path: ctx.projectMeta.workspacePath as string }]
          : [],
        allowPluginHooks: async (message) => isManagedKnowledgeBaseRendererMessage(message),
        allowAgentNativeSlash: (name, message) =>
          isManagedKnowledgeBaseRendererMessage(message)
          && MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS.has(name),
        sdkAgents: async () => ({}),
        sdkSubagentToolPolicies: async () => ({}),
      })
      service.startIdleReclaim()
      return service
    },
    async stop(instance) {
      await instance.shutdown()
    },
  }
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
