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
import { evaluateKnowledgeBaseWorkerToolPolicy } from "../knowledge-base/ingest-worker-policy"
import { KnowledgeBaseWorkerSessionRunner } from "../knowledge-base/ingest-worker-session-runner"
import { KnowledgeBaseParallelIngestRunner } from "../knowledge-base/parallel-ingest-runner"
import { createKnowledgeBaseAgentContribution } from "../knowledge-base/agent-contribution"
import {
  KnowledgeBaseIngestTurnStore,
  type KnowledgeBaseIngestTurnStoreEntry,
} from "../knowledge-base/ingest-turn-store"
import {
  createProviderServiceFromDataRepository,
} from "../provider"
import { ReplyOutboxService } from "../reply-target"
import { AgentRuntimeService, type AgentRuntimeServiceDeps } from "./agent-runtime-service"
import { CustomCommandRegistry } from "./command-registry"
import { mergeAgentProjectContributions, type AgentProjectContribution } from "./project-contributions"
import { SkillRegistry } from "./skill-registry"
import { ClaudeSDKSession } from "./claude-sdk-session"
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
      const resolveProjectContributionForService = createCachedAgentProjectContributionResolver(
        ctx.projectId,
        ctx.dataRepo,
        ctx.logger,
        providerService,
      )
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
          (await resolveProjectContributionForService()).commands,
        publishedProjectCommands: async () =>
          (await resolveProjectContributionForService()).publishedCommands ?? [],
        sdkPlugins: async (message) =>
          (await resolveProjectContributionForService()).sdkPlugins?.(message) ?? [],
        sdkAgents: async (message) =>
          (await resolveProjectContributionForService()).sdkAgents?.(message) ?? {},
        sdkSubagentToolPolicies: async (message) =>
          (await resolveProjectContributionForService()).sdkSubagentToolPolicies?.(message) ?? {},
        prepareMessage: async (message, context) => {
          const contribution = await resolveProjectContributionForService()
          return contribution.prepareMessage?.(message, context) ?? message
        },
        afterTurn: async (input) => {
          const contribution = await resolveProjectContributionForService()
          return contribution.afterTurn?.(input)
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

async function resolveAgentProjectContribution(
  projectId: string,
  dataRepository: Pick<DataRepository, "namespace">,
  logger?: Parameters<typeof createKnowledgeBaseAgentContribution>[0]["logger"],
  providerService?: ReturnType<typeof createProviderServiceFromDataRepository>,
) {
  const appConfig = await configStore.load()
  const project = appConfig.global.projects.find((item) => item.id === projectId)
  const parallelIngestRunner = providerService
    ? createKnowledgeBaseParallelIngestRunner(projectId, providerService, logger)
    : undefined
  const contributions = [
        project ? await createKnowledgeBaseAgentContribution({
          project,
          ingestTurnStore: new KnowledgeBaseIngestTurnStore({
            namespace: dataRepository.namespace<KnowledgeBaseIngestTurnStoreEntry>("knowledge-base.ingest-turns"),
          }),
          parallelIngestRunner,
          logger,
        }) : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null)
  return mergeAgentProjectContributions(contributions)
}

export function createCachedAgentProjectContributionResolver(
  projectId: string,
  dataRepository: Pick<DataRepository, "namespace">,
  logger?: Parameters<typeof createKnowledgeBaseAgentContribution>[0]["logger"],
  providerService?: ReturnType<typeof createProviderServiceFromDataRepository>,
): () => Promise<AgentProjectContribution> {
  let projectContributionPromise: Promise<AgentProjectContribution> | null = null
  return () => {
    projectContributionPromise ??= resolveAgentProjectContribution(projectId, dataRepository, logger, providerService)
    return projectContributionPromise
  }
}

function createKnowledgeBaseParallelIngestRunner(
  projectId: string,
  providerService: ReturnType<typeof createProviderServiceFromDataRepository>,
  logger?: Parameters<typeof createKnowledgeBaseAgentContribution>[0]["logger"],
): KnowledgeBaseParallelIngestRunner {
  const workerSessionRunner = new KnowledgeBaseWorkerSessionRunner({
    createSession: (input) => new ClaudeSDKSession({
      projectId: input.projectId,
      conversationId: `${input.conversationId}:kb-worker:${input.targetPage}`,
      providerId: input.providerId,
      cwd: input.cwd,
      env: input.env,
      model: input.model,
      mode: input.mode,
      maxTurns: 8,
      logger,
      toolPolicy: (toolName, toolInput) => evaluateKnowledgeBaseWorkerToolPolicy(toolName, toolInput, {
        targetPage: input.targetPage,
      }),
    }),
  })
  return new KnowledgeBaseParallelIngestRunner({
    getProviderEnv: async (input) => {
      const provider = await providerService.getActiveProvider()
      if (!provider) {
        throw new Error("Provider is required")
      }
      const env = await providerService.buildEnv(provider.id, {
        actor: { kind: "user", id: input.userId },
        projectId,
      })
      return {
        providerId: provider.id,
        env,
        model: env.ANTHROPIC_MODEL,
      }
    },
    runWorker: (input) => workerSessionRunner.run(input),
  })
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
