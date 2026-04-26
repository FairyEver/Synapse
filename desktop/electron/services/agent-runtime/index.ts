import type { ConversationEntryV1, DataRepository } from "../../runtime/data-repo"
import type { ProjectScopedService } from "../../runtime/project-container"
import {
  createControlledProcessRunner,
} from "../../runtime/process"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import {
  createProviderConfigServiceFromDataRepository,
  type ProviderRuntimeView,
} from "../provider-config"
import { CodexExecAdapter } from "./adapters/codex-exec"
import { AgentRuntimeService } from "./agent-runtime-service"
import { AGENT_RUNTIME_SERVICE_ID } from "./types"

export {
  AgentRuntimeService,
  conversationId,
  type AgentAdapterFactory,
  type AgentRuntimeServiceDeps,
} from "./agent-runtime-service"
export {
  AgentCommandRouter,
  modesForAgent,
  parseCommand,
  parseModelSwitchArgs,
  resolveModelTarget,
  type AgentCommandRouterDeps,
} from "./command-router"
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
  type AgentUserQuestion,
  type AgentUserQuestionOption,
} from "./types"

export function createAgentRuntimeProjectService(): ProjectScopedService<AgentRuntimeService> {
  return {
    id: AGENT_RUNTIME_SERVICE_ID,
    create(ctx) {
      const permissionGuard = ctx.globalRegistry.get<PermissionGuard>("core.permission-guard")
      const auditSink = ctx.globalRegistry.get<AuditSink>("core.audit-sink")
      const dataRepository = ctx.globalRegistry.get<DataRepository>("core.data-repository")
      const runner = createControlledProcessRunner({ permissionGuard, auditSink })
      const providerConfig = createProviderConfigServiceFromDataRepository({
        dataRepository,
        permissionGuard,
        auditSink,
      })
      return new AgentRuntimeService({
        projectId: ctx.projectId,
        workDir: ctx.projectMeta.workspacePath,
        conversations: ctx.dataRepo.namespace<ConversationEntryV1>("conversations"),
        adapter: new CodexExecAdapter(runner),
        agentType: "codex",
        adapterFactory: (view) => adapterFromRuntimeView(view, runner),
        eventBus: ctx.eventBus,
        logger: ctx.logger,
        permissionGuard,
        auditSink,
        providerConfig,
      })
    },
  }
}

function adapterFromRuntimeView(
  view: ProviderRuntimeView,
  runner: ReturnType<typeof createControlledProcessRunner>,
): CodexExecAdapter {
  return new CodexExecAdapter(runner, {
    model: view.model,
    provider: view.provider?.id,
    baseUrl: view.baseUrl,
    effort: view.provider?.effort,
    mode: view.mode,
    env: {
      ...view.env,
      CODEX_HOME: view.provider?.codex?.codexHome ?? view.env.CODEX_HOME,
    },
    envAllowlist: [
      ...view.envAllowlist,
      ...(view.provider?.codex?.codexHome ? ["CODEX_HOME"] : []),
    ],
  })
}
