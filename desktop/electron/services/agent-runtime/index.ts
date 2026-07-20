import type {
  AgentArtifactEntryV1,
  AgentCommandEntryV1,
  AgentCompressStateEntryV1,
  AgentEventEntryV1,
  AgentUsageEntryV1,
  ConversationEntryV1,
  DataRepository,
  OutboxEntryV1,
} from "../../runtime/data-repo"
import { app } from "electron"
import path from "node:path"
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
import { KnowledgeBaseIngestCoordinator } from "../knowledge-base/ingest-finalizer"
import {
  AGENT_CONVERSATION_WINDOW_SERVICE_ID,
  type AgentConversationWindowService,
} from "../agent-conversation-window-service"
import { AgentRuntimeService, type AgentRuntimeServiceDeps } from "./agent-runtime-service"
import { AgentArtifactStore } from "./artifact-store"
import type { AgentPersonaService } from "../../../app-capabilities/agent-personas/main/service"
import { CustomCommandRegistry } from "./command-registry"
import { createAgentPersonaRuntimeResolver } from "./persona-runtime"
import { validateWorkspaceDirectory } from "./session-manager"
import { SkillRegistry } from "./skill-registry"
import { AGENT_RUNTIME_SERVICE_ID } from "./types"
import type { AgentMessage } from "./types"
import {
  MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS,
  MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_PUBLISHED_COMMANDS,
} from "./knowledge-base-native-commands"

export {
  MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS,
  MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMAND_NAMES,
  MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_PUBLISHED_COMMANDS,
} from "./knowledge-base-native-commands"

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
  AgentArtifactStore,
} from "./artifact-store"
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
  createAgentPersonaRuntimeResolver,
  sdkAgentNameForPersona,
  type ResolvedPersonaSdkConfig,
} from "./persona-runtime"
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
  type AgentUserQuestionResolution,
  type AgentUserQuestionResolutionAnswer,
  type AgentUserQuestionResolutionStatus,
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
      const agentPersonas = optionalService<AgentPersonaService>(
        ctx.globalRegistry,
        "core.agent-personas",
      )
      const personaRuntimeResolver = agentPersonas
        ? createAgentPersonaRuntimeResolver({
          listPersonas: async () => (await agentPersonas.list()).items,
        })
        : undefined
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
      const agentArtifactStore = new AgentArtifactStore({
        rootDirectory: path.join(app.getPath("userData"), "agent-artifacts"),
        artifacts: ctx.dataRepo.namespace<AgentArtifactEntryV1>("agent.artifacts"),
      })
      const hasManagedKnowledgeBaseWorkspace =
        isManagedKnowledgeBase
        && typeof ctx.projectMeta.workspacePath === "string"
        && ctx.projectMeta.workspacePath.length > 0
      const isManagedKnowledgeBaseRuntimeMessage = (message: AgentMessage) =>
        hasManagedKnowledgeBaseWorkspace
        && (message.platform === "local-renderer" || message.platform === "workflow")
      const knowledgeBaseIngest = isManagedKnowledgeBase && typeof ctx.projectMeta.workspacePath === "string"
        ? new KnowledgeBaseIngestCoordinator({
          projectId: ctx.projectId,
          projectPath: ctx.projectMeta.workspacePath,
        })
        : undefined
      const service = new AgentRuntimeService({
        projectId: ctx.projectId,
        workDir: ctx.projectMeta.workspacePath,
        managedKnowledgeBase: isManagedKnowledgeBase,
        validateWorkspacePath: validateWorkspaceDirectory,
        conversations: ctx.dataRepo.namespace<ConversationEntryV1>("conversations"),
        compressState: ctx.dataRepo.namespace<AgentCompressStateEntryV1>("agent.compress_state"),
        agentEvents: ctx.dataRepo.namespace<AgentEventEntryV1>("agent.events"),
        agentUsage: ctx.dataRepo.namespace<AgentUsageEntryV1>("agent.usage"),
        agentArtifactStore,
        getUsagePriceRules: () => listModelPriceRules(getUsageAnalysisDb()),
        providerService,
        agentType: "claude-code",
        eventBus: ctx.eventBus,
        onConversationRenamed: (conversation) =>
          ctx.globalRegistry.get<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
            .renameConversationWindow({
              projectId: conversation.projectId,
              conversationId: conversation.id,
            }, conversation.name ?? ""),
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
        publishedProjectCommands: async () => isManagedKnowledgeBase
          ? MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_PUBLISHED_COMMANDS
          : [],
        sdkPlugins: async (message) => isManagedKnowledgeBaseRuntimeMessage(message)
          ? [{ type: "local", path: ctx.projectMeta.workspacePath as string }]
          : [],
        allowPluginHooks: async (message) => isManagedKnowledgeBaseRuntimeMessage(message),
        allowAgentNativeSlash: (name, message) =>
          isManagedKnowledgeBaseRuntimeMessage(message)
          && MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS.has(name),
        prepareMessage: (message, context) =>
          isManagedKnowledgeBaseRuntimeMessage(message) && knowledgeBaseIngest
            ? knowledgeBaseIngest.prepareTurn(message, context)
            : message,
        afterTurn: (input) =>
          isManagedKnowledgeBaseRuntimeMessage(input.message) && knowledgeBaseIngest
            ? knowledgeBaseIngest.finalizeTurn(input)
            : undefined,
        sdkPersonaConfig: personaRuntimeResolver
          ? (_message, conversation) => personaRuntimeResolver.resolve(conversation)
          : undefined,
        resolvePersonaForSessionCreate: personaRuntimeResolver
          ? (personaId) => personaRuntimeResolver.resolve({
            agentConfig: { activeMainThreadPersonaId: personaId },
          })
          : undefined,
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
