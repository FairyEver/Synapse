import type {
  AgentCommandEntryV1,
  AgentCompressStateEntryV1,
  ConversationEntryV1,
  DataRepository,
  OutboxEntryV1,
} from "../../runtime/data-repo"
import type { ProjectScopedService } from "../../runtime/project-container"
import {
  createControlledProcessRunner,
} from "../../runtime/process"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { ProcessIsolationResolver } from "../execution-isolation"
import {
  createProviderConfigServiceFromDataRepository,
  type ProviderRuntimeView,
} from "../provider-config"
import {
  agentRuntimeDefinitionById,
} from "../definitions/generated/main-registry"
import type {
  AgentRuntimeDefinition,
  AgentRuntimeProcessRunner,
} from "../../../src/definitions/main-types"
import { ReplyOutboxService } from "../reply-target"
import type { AgentAdapter } from "./types"
import { AgentRuntimeService, type AgentRuntimeServiceDeps } from "./agent-runtime-service"
import { CustomCommandRegistry } from "./command-registry"
import { SkillRegistry } from "./skill-registry"
import { AGENT_RUNTIME_SERVICE_ID } from "./types"

const agentRuntimeDefinitionsByStringId: ReadonlyMap<string, AgentRuntimeDefinition> = new Map(
  agentRuntimeDefinitionById,
)

export {
  AgentRuntimeService,
  conversationId,
  type AgentAdapterFactory,
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
  SkillRegistry,
  buildSkillInvocationPrompt,
  type AgentSkill,
} from "./skill-registry"
export {
  CodexExecAdapter,
  CodexJsonLineParser,
  buildCodexExecArgs,
  parseCodexJsonLines,
  type CodexExecArgsOptions,
  type CodexExecOptions,
  type CodexParseResult,
  type CodexProcessRunner,
} from "./adapters/codex-exec"
export {
  ClaudeCodeAdapter,
  buildClaudeCodeArgs,
  type ClaudeCodeArgsOptions,
  type ClaudeCodeOptions,
  type ClaudeProcessRunner,
} from "./adapters/claude-code"
export {
  AGENT_RUNTIME_SERVICE_ID,
  type AgentAdapter,
  type AgentAttachment,
  type AgentEvent,
  type AgentExecutionContext,
  type AgentExecutionResult,
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
    create(ctx) {
      const permissionGuard = ctx.globalRegistry.get<PermissionGuard>("core.permission-guard")
      const auditSink = ctx.globalRegistry.get<AuditSink>("core.audit-sink")
      const dataRepository = ctx.globalRegistry.get<DataRepository>("core.data-repository")
      const runner = createControlledProcessRunner({ permissionGuard, auditSink })
      const outbox = new ReplyOutboxService({
        projectId: ctx.projectId,
        outbox: ctx.dataRepo.namespace<OutboxEntryV1>("outbox"),
        logger: ctx.logger,
      })
      const providerConfig = createProviderConfigServiceFromDataRepository({
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
      })
      const skills = new SkillRegistry({
        workspacePath: ctx.projectMeta.workspacePath,
      })
      return new AgentRuntimeService({
        projectId: ctx.projectId,
        workDir: ctx.projectMeta.workspacePath,
        conversations: ctx.dataRepo.namespace<ConversationEntryV1>("conversations"),
        compressState: ctx.dataRepo.namespace<AgentCompressStateEntryV1>("agent.compress_state"),
        adapter: createAdapterFromRuntimeDefinition({
          projectId: ctx.projectId,
          agentType: "codex",
          providers: [],
          env: {},
          envAllowlist: [],
        }, runner),
        agentType: "codex",
        adapterFactory: (view) => createAdapterFromRuntimeDefinition(view, runner),
        eventBus: ctx.eventBus,
        logger: ctx.logger,
        permissionGuard,
        auditSink,
        outbox,
        providerConfig,
        replyTargets,
        executionIsolation,
        customCommands,
        skills,
        commandRunner: runner,
      })
    },
  }
}

export function createAdapterFromRuntimeDefinition(
  view: ProviderRuntimeView,
  runner: AgentRuntimeProcessRunner,
): AgentAdapter {
  const definition = agentRuntimeDefinitionsByStringId.get(view.agentType)
  if (!definition) {
    throw new Error(`Unknown agent runtime: ${view.agentType}`)
  }
  return definition.createAdapter(view, runner)
}

function optionalService<T>(registry: { get<U>(id: string): U }, id: string): T | undefined {
  try {
    return registry.get<T>(id)
  } catch {
    return undefined
  }
}
