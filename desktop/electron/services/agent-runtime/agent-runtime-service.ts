import type {
  AgentCommandEntryV1,
  AgentCompressStateEntryV1,
  AgentEventEntryV1,
  AgentUsageEntryV1,
  ConversationEntryV1,
  DataNamespace,
} from "../../runtime/data-repo"
import type {
  ControlledProcessResult,
  ControlledProcessRunRequest,
} from "../../runtime/process"
import type { ScopedEventBus } from "../../runtime/project-container"
import type {
  ActorIdentity,
  AuditSink,
  PermissionAction,
  PermissionGuard,
} from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { ReplyOutboxService } from "../reply-target"
import type { ReplyTarget } from "../reply-target"
import type { ProcessIsolationResolver } from "../execution-isolation"
import { resolveEffectiveShell, resolveShellCommand } from "../shell-exec"
import type { ProviderService } from "../provider"
import type { ModelPriceRule } from "../model-price"
import { AgentCommandRouter } from "./command-router"
import {
  AGENT_ABORTED_BEFORE_EXECUTION_MESSAGE,
  AGENT_ASK_USER_QUESTION_ALL_ANSWERS_REQUIRED_MESSAGE,
  AGENT_ASK_USER_QUESTION_ANSWERS_REQUIRED_MESSAGE,
  AGENT_ASK_USER_QUESTION_QUESTIONS_REQUIRED_MESSAGE,
  AGENT_COMMAND_EXEC_BODY_MISSING_MESSAGE,
  AGENT_COMMAND_EXECUTION_UNAVAILABLE_MESSAGE,
  AGENT_COMPRESSION_STATE_UNAVAILABLE_MESSAGE,
  AGENT_PERMISSION_NOT_PENDING_MESSAGE,
  AGENT_PERMISSION_SESSION_MISMATCH_MESSAGE,
  AGENT_PERMISSION_UPDATED_INPUT_UNSUPPORTED_MESSAGE,
  AGENT_PROJECT_WORKSPACE_REQUIRED_MESSAGE,
  AGENT_SCHEDULED_SPAWN_DENIED_MESSAGE,
  AGENT_USER_QUESTION_PERSISTENCE_FAILED_MESSAGE,
  commandExecutionStatusMessage,
  conversationNotFoundMessage,
  isConversationNotFoundMessage,
  scheduledTimeoutMessage,
} from "./agent-error-messages"
import type {
  RegisteredPromptCommandSource,
} from "./command-router"
import { resolveRegisteredPromptCommands } from "./command-router"
import type { CustomCommandRegistry, PublishedAgentCommand } from "./command-registry"
import { BUILTIN_COMMANDS } from "./command-registry"
import type { AgentGovernanceDecision, AgentGovernanceService } from "./governance"
import {
  parseReferenceViewOptions,
  renderReferenceView,
  resolveLocalReference,
} from "./references"
import type {
  AgentProjectAfterTurnInput,
  AgentProjectAfterTurnOutput,
  AgentSdkAgentDefinitions,
  AgentSdkPluginSpec,
  AgentSdkSubagentToolPolicies,
} from "./project-contributions"
import type { ResolvedPersonaSdkConfig } from "./persona-runtime"
import {
  AgentSessionRepository,
  conversationId,
} from "./session-repository"
import { SessionManager, type AgentLiveSessionFactory } from "./session-manager"
import { SessionLifecycleManager } from "./session-lifecycle"
import type {
  RuntimeSessionState,
  PendingPermissionState,
} from "./session-lifecycle"
import { ConversationRouter } from "./conversation-router"
import type { AgentArtifactStore } from "./artifact-store"
import type {
  AgentEvent,
  AgentMessage,
  AgentPendingPermission,
  AgentPermissionDecision,
  AgentPermissionResponseRequest,
  AgentUserQuestionResolution,
  AgentRuntimeRelayResult,
  AgentRuntimeTurnResult,
  CancelTurnResult,
  ScheduledAgentSendInput,
  ScheduledAgentSendResult,
} from "./types"
import type { SkillRegistry } from "./skill-registry"
import { errorLogMeta, sanitizeError } from "../error-sanitize"
import {
  KnowledgeBaseLintPreflightService,
  formatKnowledgeBaseLintPreflightAppendix,
} from "../knowledge-base"
import type { SynapseAgentConversationTarget } from "../../../src/types/agent-navigation"
import {
  sanitizePermissionRawInput,
  sanitizePermissionText,
} from "./permission-sanitize"
import { redactSensitiveText } from "./redaction"
import { markCancelRequested } from "./turn-outcome"
import {
  agentRuntimeErrorMessage,
  agentRuntimeErrorSummary,
  rawAgentRuntimeErrorMessage,
} from "./error-message"

interface CommandExecutionRunner {
  run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult>
}

export interface AgentRuntimeServiceDeps {
  readonly projectId: string
  readonly workDir?: string
  readonly managedKnowledgeBase?: boolean
  readonly conversations: DataNamespace<ConversationEntryV1>
  readonly providerService: ProviderService
  readonly createSession?: AgentLiveSessionFactory
  readonly validateWorkspacePath?: (cwd: string) => void | Promise<void>
  readonly agentType?: string
  readonly sessionRepository?: AgentSessionRepository
  readonly agentEvents?: DataNamespace<AgentEventEntryV1>
  readonly agentUsage?: DataNamespace<AgentUsageEntryV1>
  readonly agentArtifactStore?: AgentArtifactStore
  readonly getUsagePriceRules?: () => readonly ModelPriceRule[]
  readonly eventBus?: ScopedEventBus
  readonly logger?: StructuredLogger
  readonly now?: () => Date
  readonly pendingQueueLimit?: number
  readonly permissionTimeoutMs?: number
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly outbox?: ReplyOutboxService
  readonly governance?: AgentGovernanceService
  readonly compressState?: DataNamespace<AgentCompressStateEntryV1>
  readonly registeredPromptCommands?: RegisteredPromptCommandSource
  readonly publishedProjectCommands?: PublishedProjectCommandSource
  readonly agentNativeSlashAllowlist?: readonly string[]
  allowAgentNativeSlash?(name: string, message: AgentMessage): boolean
  readonly unknownSlashBehavior?: "reject" | "passthrough"
  readonly customCommands?: CustomCommandRegistry
  readonly skills?: SkillRegistry
  readonly knowledgeBaseLintPreflight?: Pick<KnowledgeBaseLintPreflightService, "run">
  readonly commandRunner?: CommandExecutionRunner
  readonly executionIsolation?: ProcessIsolationResolver
  readonly sdkPlugins?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    readonly AgentSdkPluginSpec[] | Promise<readonly AgentSdkPluginSpec[]>
  readonly allowPluginHooks?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    boolean | Promise<boolean>
  readonly sdkAgents?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    AgentSdkAgentDefinitions | Promise<AgentSdkAgentDefinitions>
  readonly sdkPersonaConfig?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    ResolvedPersonaSdkConfig | Promise<ResolvedPersonaSdkConfig>
  readonly sdkSubagentToolPolicies?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    AgentSdkSubagentToolPolicies | Promise<AgentSdkSubagentToolPolicies>
  readonly prepareMessage?: (
    message: AgentMessage,
    context: {
      readonly isNewLiveSession: boolean
      readonly conversationId: string
      readonly turnId: string
    },
  ) => AgentMessage | Promise<AgentMessage>
  readonly afterTurn?: (input: AgentProjectAfterTurnInput) =>
    void | AgentProjectAfterTurnOutput | Promise<void | AgentProjectAfterTurnOutput>
  readonly replyTargets?: {
    rememberReplyTarget(target: ReplyTarget): void
    dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): Promise<void>
    getAgentEnv(projectId: string, sessionKey: string): Record<string, string> | undefined
  }
}

type PublishedProjectCommandSource =
  | readonly PublishedAgentCommand[]
  | ((platform: string) => readonly PublishedAgentCommand[] | Promise<readonly PublishedAgentCommand[]>)

const ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion"
const ASK_USER_QUESTION_EMPTY_ANSWER_MESSAGE = "未收到选择，已停止操作。"

export interface AgentRuntimeStatus {
  readonly projectId: string
  readonly agentType: string
  readonly liveSessions: number
  readonly busySessions: number
  readonly queuedTurns: number
  readonly pendingPermissions: number
}

export class AgentRuntimeService {
  private readonly deps: AgentRuntimeServiceDeps
  private readonly repository: AgentSessionRepository
  private readonly commandRouter: AgentCommandRouter
  private readonly sessionLifecycle: SessionLifecycleManager
  private readonly sessionManager: SessionManager
  private readonly conversationRouter: ConversationRouter
  private readonly states = new Map<string, RuntimeSessionState>()
  private readonly pendingPermissions = new Map<string, PendingPermissionState>()

  constructor(deps: AgentRuntimeServiceDeps) {
    this.deps = deps
    this.repository = deps.sessionRepository ?? new AgentSessionRepository({
      projectId: deps.projectId,
      conversations: deps.conversations,
      agentUsage: deps.agentUsage,
      now: deps.now,
      logger: deps.logger,
    })
    this.sessionManager = new SessionManager({
      projectId: deps.projectId,
      workDir: deps.workDir,
      repository: this.repository,
      providerService: deps.providerService,
      states: this.states,
      pendingPermissions: this.pendingPermissions,
      logger: deps.logger,
      now: deps.now,
      createSession: deps.createSession,
      validateWorkspacePath: deps.validateWorkspacePath,
      getReplyTargetEnv: (projectId, sessionKey) => deps.replyTargets?.getAgentEnv(projectId, sessionKey),
      sdkPlugins: deps.sdkPlugins,
      allowPluginHooks: deps.allowPluginHooks,
      sdkAgents: deps.sdkAgents,
      sdkPersonaConfig: deps.sdkPersonaConfig,
      sdkSubagentToolPolicies: deps.sdkSubagentToolPolicies,
      onConversationTitle: (conversationId, title) =>
        this.applyGeneratedConversationTitle(conversationId, title),
      onConversationUpdated: (conversation) => this.emitConversationUpdated(conversation),
    })
    this.sessionLifecycle = new SessionLifecycleManager({
      projectId: deps.projectId,
      repository: this.repository,
      states: this.states,
      pendingPermissions: this.pendingPermissions,
      sessionManager: this.sessionManager,
      logger: deps.logger,
      getActiveAgentType: () => this.getActiveAgentType(),
    })
    this.commandRouter = new AgentCommandRouter({
      projectId: deps.projectId,
      agentType: this.agentType(),
      resolveAgentType: () => this.getActiveAgentType(),
      providerService: deps.providerService,
      registeredPromptCommands: deps.registeredPromptCommands,
      agentNativeSlashAllowlist: deps.agentNativeSlashAllowlist,
      allowAgentNativeSlash: deps.allowAgentNativeSlash,
      unknownSlashBehavior: deps.unknownSlashBehavior,
      customCommands: deps.customCommands,
      skills: deps.skills,
      logger: deps.logger,
      resetSession: (message) => this.resetMessageSession(message),
      setPermissionMode: (_message, conversation, mode) =>
        this.setPermissionMode({
          conversationId: conversation.id,
          mode,
          actor: { kind: "user" },
        }),
      showReference: (message, args) => this.showReferenceForMessage(message, args),
      listCommands: (message) => this.listPublishedCommands(message.platform),
      runCustomCommand: (command, args, message) =>
        this.runCustomCommand(command, args, message),
      buildSkillPromptAppendix: (input) =>
        this.buildSkillPromptAppendix(input.name),
      compressSession: (message, conversation) =>
        this.conversationRouter.compressSession(message, conversation),
    })
    this.conversationRouter = new ConversationRouter({
      deps: {
        projectId: deps.projectId,
        defaultAgentType: deps.agentType ?? "claude-code",
        workDir: deps.workDir,
        eventBus: deps.eventBus,
        logger: deps.logger,
        governance: deps.governance,
        pendingQueueLimit: deps.pendingQueueLimit,
        permissionTimeoutMs: deps.permissionTimeoutMs,
        outbox: deps.outbox,
        replyTargets: deps.replyTargets,
        agentEvents: deps.agentEvents,
        agentArtifactStore: deps.agentArtifactStore,
        getUsagePriceRules: deps.getUsagePriceRules,
        now: deps.now,
        permissionGuard: deps.permissionGuard,
        auditSink: deps.auditSink,
        prepareMessage: deps.prepareMessage,
        afterTurn: deps.afterTurn,
      },
      repository: this.repository,
      sessionManager: this.sessionManager,
      commandRouter: this.commandRouter,
      pendingPermissions: this.pendingPermissions,
    })
  }

  async send(message: AgentMessage): Promise<AgentRuntimeTurnResult> {
    return this.conversationRouter.send(message)
  }

  async sendToConversation(
    message: AgentMessage,
    conversationId: string,
  ): Promise<AgentRuntimeTurnResult> {
    return this.conversationRouter.sendToConversation(message, conversationId)
  }

  async sendNewSession(
    message: AgentMessage,
    name: string,
    options: {
      readonly abortSignal?: AbortSignal
      readonly liveEventTimeoutMs?: number
      readonly onConversationCreated?: (conversation: ConversationEntryV1) => void
    } = {},
  ): Promise<AgentRuntimeTurnResult> {
    return this.conversationRouter.sendNewSession(message, name, options)
  }

  hasActiveKnowledgeBaseSession(): boolean {
    if (this.deps.managedKnowledgeBase !== true) {
      return false
    }
    return Array.from(this.states.values()).some((state) =>
      state.busy || state.activeTurns > 0 || state.queue.length > 0 || state.liveSession?.alive() === true
    )
  }

  private async buildSkillPromptAppendix(name: string): Promise<string | null> {
    if (this.deps.managedKnowledgeBase !== true || name !== "wiki-lint") {
      return null
    }
    if (!this.deps.workDir) {
      return null
    }
    try {
      const preflight = this.deps.knowledgeBaseLintPreflight ?? new KnowledgeBaseLintPreflightService()
      const result = await preflight.run(this.deps.workDir)
      return formatKnowledgeBaseLintPreflightAppendix(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logger?.warn("Knowledge base lint preflight failed.", {
        boundary: "agent-runtime.knowledge-base-lint-preflight",
        projectId: this.deps.projectId,
        error: sanitizeError(message),
        errorName: error instanceof Error ? error.name : typeof error,
      })
      return [
        "## Synapse 确定性预检",
        "- 状态：预检失败",
        "- 说明：Synapse 未能完成内部预检；不要重新运行 DragonScale 脚本，也不要编造地址或 tiling 结果。",
      ].join("\n")
    }
  }

  async sendSideSessionWithTimeout(
    message: AgentMessage,
    name: string,
    timeoutMs: number,
  ): Promise<AgentRuntimeRelayResult> {
    return this.conversationRouter.sendSideSessionWithTimeout(message, name, timeoutMs)
  }

  async sendScheduled(input: ScheduledAgentSendInput): Promise<ScheduledAgentSendResult> {
    const startMs = Date.now()
    const sourcePlatform = input.sourcePlatform ?? "workflow"
    const sessionKey = `${sourcePlatform}:${input.projectId}:${Date.now()}`
    const message: AgentMessage = {
      projectId: input.projectId,
      sessionKey,
      platform: sourcePlatform,
      content: input.prompt,
      modeOverride: input.mode,
      agentType: input.agentType,
      providerId: input.providerId,
      modelTier: input.modelTier,
      userMeta: input.userMeta,
    }

    const ac = new AbortController()
    const externalSignal = input.abortSignal

    if (externalSignal?.aborted) {
      const durationMs = Date.now() - startMs
      const result: ScheduledAgentSendResult = {
        conversationId: "",
        sessionKey,
        status: "error",
        error: AGENT_ABORTED_BEFORE_EXECUTION_MESSAGE,
        durationMs,
      }
      this.logScheduledAgentFailure(input, message, result)
      return result
    }

    const onExternalAbort = () => ac.abort()
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true })

    const timeoutMs = input.timeoutMs
    const timeout = timeoutMs !== undefined && timeoutMs > 0
      ? setTimeout(() => ac.abort(), timeoutMs)
      : undefined

    try {
      if (this.deps.permissionGuard) {
        const spawnPermission = await this.deps.permissionGuard.check({
          action: "agent.spawn",
          actor: { kind: "system" },
          resource: `${sourcePlatform}:${input.projectId}:${input.agentType}`,
          context: {
            projectId: input.projectId,
            agentType: input.agentType,
            providerId: input.providerId,
            sessionPolicy: input.sessionPolicy,
            sourcePlatform,
          },
        })
        if (!spawnPermission.allowed) {
          this.deps.auditSink?.record({
            action: "agent.spawn",
            actor: { kind: "system" },
            resource: `${sourcePlatform}:${input.projectId}:${input.agentType}`,
            outcome: "denied",
            metadata: {
              projectId: input.projectId,
              agentType: input.agentType,
              sourcePlatform,
              reason: spawnPermission.reason,
              policyId: spawnPermission.policyId,
            },
          })
          return {
            conversationId: "",
            sessionKey,
            status: "error",
            error: AGENT_SCHEDULED_SPAWN_DENIED_MESSAGE,
            durationMs: Date.now() - startMs,
          }
        }
        this.deps.auditSink?.record({
          action: "agent.spawn",
          actor: { kind: "system" },
          resource: `${sourcePlatform}:${input.projectId}:${input.agentType}`,
          outcome: "allowed",
          metadata: {
            projectId: input.projectId,
            agentType: input.agentType,
            sessionPolicy: input.sessionPolicy,
            sourcePlatform,
          },
        })
      }

      let result: AgentRuntimeTurnResult
      let conversationTarget: SynapseAgentConversationTarget | undefined
      const captureConversationTarget = (
        conversation: Pick<ConversationEntryV1, "id" | "projectId" | "sessionKey" | "platform">,
      ) => {
        const target = scheduledConversationTarget(conversation, sourcePlatform)
        if (!target) return
        conversationTarget = target
        input.onConversationCreated?.(target)
      }

      if (input.sessionPolicy === "fresh" || !input.lastConversationId) {
        const name = formatScheduledSessionName(input, this.deps.now?.() ?? new Date())
        result = await this.conversationRouter.sendNewSession(message, name, {
          abortSignal: ac.signal,
          liveEventTimeoutMs: scheduledLiveEventTimeoutMs(timeoutMs),
          onConversationCreated: captureConversationTarget,
        })
      } else {
        try {
          result = await this.conversationRouter.sendToConversation(message, input.lastConversationId, {
            abortSignal: ac.signal,
            liveEventTimeoutMs: scheduledLiveEventTimeoutMs(timeoutMs),
          })
        } catch (resumeError) {
          const isNotFound = resumeError instanceof Error
            && isConversationNotFoundMessage(resumeError.message)
          if (!isNotFound) throw resumeError
          this.logScheduledResumeFallback(input, message, resumeError)
          const name = formatScheduledSessionName(input, this.deps.now?.() ?? new Date())
          result = await this.conversationRouter.sendNewSession(message, name, {
            abortSignal: ac.signal,
            liveEventTimeoutMs: scheduledLiveEventTimeoutMs(timeoutMs),
            onConversationCreated: captureConversationTarget,
          })
        }
      }

      const resultSessionKey = conversationTarget?.sessionKey
        ?? (result.conversationId ? (await this.repository.get(result.conversationId))?.sessionKey : undefined)
        ?? sessionKey
      const timedOut = ac.signal.aborted && !externalSignal?.aborted
      if (timedOut) {
        const scheduledResult: ScheduledAgentSendResult = {
          conversationId: result.conversationId,
          sessionKey: resultSessionKey,
          status: "timeout",
          error: scheduledTimeoutMessage(timeoutMs),
          durationMs: Date.now() - startMs,
          usage: result.usage,
          modelName: result.modelName,
          costUsd: result.costUsd,
          costCny: result.costCny,
          costBreakdownCny: result.costBreakdownCny,
          costCurrency: result.costCurrency,
        }
        this.logScheduledAgentFailure(input, message, scheduledResult, undefined, result.agentSessionId)
        return scheduledResult
      }

      const scheduledResult: ScheduledAgentSendResult = {
        conversationId: result.conversationId,
        sessionKey: resultSessionKey,
        status: result.error ? "error" : "success",
        summary: result.resultText || undefined,
        error: result.error ? sanitizeError(result.error) : undefined,
        durationMs: Date.now() - startMs,
        usage: result.usage,
        modelName: result.modelName,
        costUsd: result.costUsd,
        costCny: result.costCny,
        costBreakdownCny: result.costBreakdownCny,
        costCurrency: result.costCurrency,
      }
      if (scheduledResult.status !== "success") {
        this.logScheduledAgentFailure(input, message, scheduledResult, result.error?.length, result.agentSessionId)
      } else {
        this.logScheduledAgentCompletion(input, message, scheduledResult, result.agentSessionId)
      }
      return scheduledResult
    } catch (error) {
      const isTimeout = ac.signal.aborted && !externalSignal?.aborted
      const errorMessageText = errorMessage(error)
      const errorLength = isTimeout ? undefined : errorMessageText.length
      const scheduledResult: ScheduledAgentSendResult = {
        conversationId: "",
        sessionKey,
        status: isTimeout ? "timeout" : "error",
        error: isTimeout
          ? scheduledTimeoutMessage(timeoutMs)
          : sanitizeError(errorMessageText),
        durationMs: Date.now() - startMs,
      }
      this.logScheduledAgentFailure(input, message, scheduledResult, errorLength)
      return scheduledResult
    } finally {
      if (timeout) clearTimeout(timeout)
      externalSignal?.removeEventListener("abort", onExternalAbort)
    }
  }

  async cancelTurn(conversationId: string): Promise<CancelTurnResult> {
    const state = this.states.get(conversationId)
    if (!state || !state.busy) {
      const result: CancelTurnResult = { status: "no-active-turn" }
      this.logTurnCancellation("cancel", conversationId, state, result)
      return result
    }
    if (state.cancelState) {
      const result: CancelTurnResult = {
        status: state.cancelState.escalationTimer ? "graceful-pending" : "hard-killed",
      }
      this.logTurnCancellation("cancel", conversationId, state, result, { alreadyRequested: true })
      return result
    }

    state.cancelState = { requestedAt: Date.now() }
    if (state.activeLifecycle) {
      markCancelRequested(state.activeLifecycle, {
        mode: "graceful",
        source: "user",
        now: () => this.isoNow(),
      })
    }

    const pendingQuestion = state.pending && isAskUserQuestionTool(state.pending.toolName)
      ? state.pending
      : undefined
    if (pendingQuestion) {
      await this.persistUserQuestionResolution(pendingQuestion, {
        status: "cancelled",
        resolvedAt: this.isoNow(),
      })
    }
    this.sessionManager.settlePending(state)

    if (state.liveSession) {
      const gracefulSent = await this.sessionManager.interrupt(conversationId)
      if (!gracefulSent) {
        if (state.activeLifecycle) {
          markCancelRequested(state.activeLifecycle, {
            mode: "force",
            source: "user",
            now: () => this.isoNow(),
          })
        }
        state.turnAbortController?.abort("user-cancel")
        const result: CancelTurnResult = { status: "hard-killed" }
        this.logTurnCancellation("cancel", conversationId, state, result, { gracefulSent: false })
        await this.sessionManager.closeCurrentTurn(conversationId)
        return result
      }
      const conversation = await this.repository.get(conversationId)
      const sessionKey = conversation?.sessionKey ?? ""
      const escalationTimer = setTimeout(() => {
        if (state.cancelState?.escalationTimer !== escalationTimer || !state.busy) return
        this.emitCancelEscalation(conversationId, sessionKey)
      }, 5000)
      state.cancelState.escalationTimer = escalationTimer
      const result: CancelTurnResult = { status: "graceful-pending" }
      this.logTurnCancellation("cancel", conversationId, state, result, { gracefulSent: true })
      return result
    }

    if (state.turnAbortController) {
      if (state.activeLifecycle) {
        markCancelRequested(state.activeLifecycle, {
          mode: "force",
          source: "user",
          now: () => this.isoNow(),
        })
      }
      state.turnAbortController.abort("user-cancel")
      const result: CancelTurnResult = { status: "hard-killed" }
      this.logTurnCancellation("cancel", conversationId, state, result)
      return result
    }

    const result: CancelTurnResult = { status: "no-active-turn" }
    this.logTurnCancellation("cancel", conversationId, state, result)
    return result
  }

  async forceKillTurn(conversationId: string): Promise<CancelTurnResult> {
    const state = this.states.get(conversationId)
    if (!state || !state.busy) {
      const result: CancelTurnResult = { status: "no-active-turn" }
      this.logTurnCancellation("force-kill", conversationId, state, result)
      return result
    }
    this.conversationRouter.clearCancelState(state)
    if (state.activeLifecycle) {
      markCancelRequested(state.activeLifecycle, {
        mode: "force",
        source: "user",
        now: () => this.isoNow(),
      })
    }
    state.turnAbortController?.abort("force-kill")
    const result: CancelTurnResult = { status: "hard-killed" }
    this.logTurnCancellation("force-kill", conversationId, state, result)
    await this.sessionManager.closeCurrentTurn(conversationId)
    return result
  }

  private logTurnCancellation(
    action: "cancel" | "force-kill",
    conversationId: string,
    state: RuntimeSessionState | undefined,
    result: CancelTurnResult,
    metadata: Record<string, unknown> = {},
  ): void {
    const liveSession = state?.liveSession
    this.deps.logger?.info("Agent turn cancellation updated.", {
      boundary: action === "cancel"
        ? "agent-runtime.turn.cancel"
        : "agent-runtime.turn.force-kill",
      projectId: this.deps.projectId,
      conversationId,
      providerId: state?.providerId,
      mode: state?.modeOverride,
      sdkSessionId: liveSession?.currentSessionId(),
      status: result.status,
      busy: state?.busy ?? false,
      activeTurns: state?.activeTurns ?? 0,
      queuedTurns: state?.queue.length ?? 0,
      hadLiveSession: Boolean(liveSession),
      hadTurnAbortController: Boolean(state?.turnAbortController),
      hadCancelState: Boolean(state?.cancelState),
      ...metadata,
    })
  }

  private emitCancelEscalation(conversationId: string, sessionKey: string): void {
    const timestamp = this.isoNow()
    this.deps.eventBus?.emit({
      domain: "agent",
      type: "phase.update",
      payload: {
        runId: conversationId,
        projectId: this.deps.projectId,
        sessionKey,
        conversationId,
        phase: "cancel_pending",
        status: "in-progress",
        startedAt: timestamp,
      },
      scope: { sessionId: conversationId },
      timestamp,
    })
  }

  listPendingPermissions(): readonly AgentPendingPermission[] {
    return [...this.pendingPermissions.values()].map((pending) => ({
      requestId: pending.requestId,
      projectId: pending.projectId,
      sessionKey: pending.sessionKey,
      workspaceKey: pending.workspaceKey,
      workspacePath: pending.workspacePath,
      conversationId: pending.conversationId,
      toolName: pending.toolName,
      toolInput: sanitizePermissionText(pending.toolInput),
      toolInputRaw: sanitizePermissionRawInput(pending.toolInputRaw),
      questions: pending.questions,
      createdAt: pending.createdAt,
    }))
  }

  getStatus(): AgentRuntimeStatus {
    const states = [...this.states.values()]
    return {
      projectId: this.deps.projectId,
      agentType: this.agentType(),
      liveSessions: states.filter((state) => state.liveSession?.alive()).length,
      busySessions: states.filter((state) => state.busy).length,
      queuedTurns: states.reduce((count, state) => count + state.queue.length, 0),
      pendingPermissions: this.pendingPermissions.size,
    }
  }

  async reclaimIdleSessions(): Promise<void> {
    return this.sessionLifecycle.reclaimIdleSessions()
  }

  startIdleReclaim(): void {
    this.sessionLifecycle.startIdleReclaim()
  }

  stopIdleReclaim(): void {
    this.sessionLifecycle.stopIdleReclaim()
  }

  async shutdown(): Promise<void> {
    this.stopIdleReclaim()
    const conversationIds = [...this.states.keys()]
    for (const conversationId of conversationIds) {
      await this.sessionManager.closeState(conversationId)
    }
  }

  async getActiveAgentType(): Promise<string> {
    return this.agentType()
  }

  async listSessions(): Promise<readonly ConversationEntryV1[]> {
    return this.sessionLifecycle.listSessions()
  }

  async getSession(conversationIdValue: string): Promise<ConversationEntryV1 | null> {
    return this.sessionLifecycle.getSession(conversationIdValue)
  }

  async listPublishedCommands(platform = "local-renderer"): Promise<readonly PublishedAgentCommand[]> {
    const custom = (await this.deps.customCommands?.listPublished() ?? [])
      .filter((command) => !command.allowedPlatforms
        || command.allowedPlatforms.some((allowed) => allowed.toLowerCase() === platform.toLowerCase()))
    const skills = await this.deps.skills?.listPublished() ?? []
    const registeredPromptCommands = await resolveRegisteredPromptCommands(this.deps.registeredPromptCommands)
    const registered = registeredPromptCommands
      .filter((command) => !command.allowedPlatforms
        || command.allowedPlatforms.some((allowed) => allowed.toLowerCase() === platform.toLowerCase()))
      .map((command) => ({
        name: command.name,
        description: command.description,
        source: "custom" as const,
        kind: "prompt" as const,
        adminOnly: false,
        allowedPlatforms: command.allowedPlatforms,
      }))
    const projectPublished = (await resolvePublishedProjectCommands(this.deps.publishedProjectCommands, platform))
      .filter((command) => !command.allowedPlatforms
        || command.allowedPlatforms.some((allowed) => allowed.toLowerCase() === platform.toLowerCase()))
    const native = (this.deps.agentNativeSlashAllowlist ?? []).map((name) => ({
      name,
      source: "agent-native" as const,
      kind: "agent-native" as const,
      adminOnly: false,
      allowedPlatforms: ["local-renderer"],
    }))
    return [...BUILTIN_COMMANDS, ...registered, ...projectPublished, ...custom, ...skills, ...native]
  }

  async getCompressionState(agentType = this.agentType()): Promise<AgentCompressStateEntryV1> {
    return this.getOrCreateCompressionState(agentType)
  }

  async updateCompressionState(input: {
    readonly agentType?: string
    readonly enabled?: boolean
    readonly maxTokens?: number
    readonly minGapMins?: number
  }): Promise<AgentCompressStateEntryV1> {
    const existing = await this.getOrCreateCompressionState(input.agentType ?? this.agentType())
    const next: AgentCompressStateEntryV1 = {
      ...existing,
      enabled: input.enabled ?? existing.enabled,
      maxTokens: input.maxTokens ?? existing.maxTokens,
      minGapMins: input.minGapMins ?? existing.minGapMins,
      updatedAt: this.isoNow(),
    }
    await this.deps.compressState?.upsert(next)
    return next
  }

  async respondPermission(request: AgentPermissionResponseRequest): Promise<void> {
    const pending = this.pendingPermissions.get(request.requestId)
    if (!pending) {
      throw new Error(AGENT_PERMISSION_NOT_PENDING_MESSAGE)
    }
    if (request.sessionKey !== undefined && request.sessionKey !== pending.sessionKey) {
      throw new Error(AGENT_PERMISSION_SESSION_MISMATCH_MESSAGE)
    }

    if (isAskUserQuestionTool(pending.toolName)) {
      if (!this.sessionManager.claimPendingPermissionResolution(pending)) {
        throw new Error(AGENT_PERMISSION_NOT_PENDING_MESSAGE)
      }
      try {
        let updatedInput: Record<string, unknown> | undefined
        try {
          updatedInput = askUserQuestionUpdatedInput(pending, request)
        } catch (error) {
          const resolution: AgentUserQuestionResolution = {
            status: "skipped",
            resolvedAt: this.isoNow(),
          }
          await this.prepareUserQuestionResolution(pending, resolution)
          await this.respondToUserQuestion(pending, {
            behavior: "deny",
            message: ASK_USER_QUESTION_EMPTY_ANSWER_MESSAGE,
          })
          await this.persistUserQuestionResolution(pending, resolution, true)
          this.sessionManager.settlePendingPermission(pending)
          throw error
        }
        const resolution = askUserQuestionResolution(pending, request, this.isoNow())
        await this.prepareUserQuestionResolution(pending, resolution)
        await this.respondToUserQuestion(pending, {
          behavior: request.behavior,
          updatedInput,
          message: askUserQuestionResponseMessage(request),
        })
        await this.persistUserQuestionResolution(pending, resolution, true)
        this.sessionManager.settlePendingPermission(pending)
        return
      } catch (error) {
        if (isPermissionNotPendingResponseError(error)) {
          try {
            await this.persistUserQuestionResolution(pending, {
              status: "cancelled",
              resolvedAt: this.isoNow(),
            }, true)
          } finally {
            this.sessionManager.settlePendingPermission(pending)
          }
        } else {
          this.sessionManager.releasePendingPermissionResolution(pending)
        }
        throw error
      }
    }

    if (request.updatedInput !== undefined) {
      throw new Error(AGENT_PERMISSION_UPDATED_INPUT_UNSUPPORTED_MESSAGE)
    }
    if (!this.sessionManager.claimPendingPermissionResolution(pending)) {
      throw new Error(AGENT_PERMISSION_NOT_PENDING_MESSAGE)
    }

    const action = permissionActionForTool(pending.toolName)
    const resource = pending.toolInput ?? pending.toolName

    try {
      if (request.behavior === "allow") {
        if (request.actor.kind !== "user") {
          const reason = "Only a user actor can allow an agent permission request"
          this.recordPermissionAudit(action, request.actor, resource, "denied", pending, {
            reason: "non-user actors cannot allow agent permission requests",
          })
          await this.denyAndSettlePendingPermission(pending, request, action, resource, reason)
          throw new Error(reason)
        }
        if (this.deps.permissionGuard) {
          const permission = await this.deps.permissionGuard.check({
            action,
            actor: request.actor,
            resource,
            context: {
              projectId: pending.projectId,
              sessionKey: pending.sessionKey,
              requestId: pending.requestId,
              toolName: pending.toolName,
              toolInputRaw: pending.toolInputRaw,
            },
          })
          if (!permission.allowed) {
            this.recordPermissionAudit(action, request.actor, resource, "denied", pending, {
              reason: permission.reason,
              policyId: permission.policyId,
            })
            await this.denyAndSettlePendingPermission(pending, request, action, resource, permission.reason)
            throw new Error(permission.reason)
          }
        }
      }

      try {
        await pending.liveSession.respondPermission(request.requestId, {
          behavior: request.behavior,
          updatedInput: request.updatedInput,
          message: request.message,
        })
        this.recordPermissionAudit(
          action,
          request.actor,
          resource,
          request.behavior === "allow" ? "allowed" : "denied",
          pending,
          { behavior: request.behavior },
        )
        this.sessionManager.settlePendingPermission(pending)
      } catch (error) {
        this.recordPermissionAudit(action, request.actor, resource, "failed", pending, {
          behavior: request.behavior,
          ...summarizePermissionResponseError(error),
        })
        throw error
      }
    } catch (error) {
      this.sessionManager.releasePendingPermissionResolution(pending)
      throw error
    }
  }

  private async denyAndSettlePendingPermission(
    pending: PendingPermissionState,
    request: AgentPermissionResponseRequest,
    action: PermissionAction,
    resource: string,
    message: string,
  ): Promise<void> {
    try {
      await pending.liveSession.respondPermission(request.requestId, {
        behavior: "deny",
        updatedInput: request.updatedInput,
        message,
      })
      this.sessionManager.settlePendingPermission(pending)
    } catch (error) {
      this.recordPermissionAudit(action, request.actor, resource, "failed", pending, {
        behavior: "deny",
        ...summarizePermissionResponseError(error),
      })
    }
  }

  async setPermissionMode(input: {
    readonly conversationId: string
    readonly mode: string
    readonly actor: ActorIdentity
  }): Promise<ConversationEntryV1> {
    const conversation = await this.repository.get(input.conversationId)
    if (!conversation) {
      throw new Error(conversationNotFoundMessage(input.conversationId))
    }

    // Persist first — if it fails, the live session is never switched.
    const updated = await this.repository.savePermissionMode(input.conversationId, input.mode)

    const liveSession = this.states.get(input.conversationId)?.liveSession
    if (liveSession?.alive()) {
      if (!liveSession.setPermissionMode) {
        throw new Error("当前会话不支持切换权限模式")
      }
      await liveSession.setPermissionMode(input.mode)
    }

    this.emitConversationUpdated(updated)
    this.deps.logger?.info("Agent permission mode changed.", {
      boundary: "agent-runtime.permission-mode",
      projectId: this.deps.projectId,
      conversationId: input.conversationId,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      mode: input.mode,
    })
    return updated
  }

  async updateSessionPersona(input: {
    readonly conversationId: string
    readonly personaId: string | null
  }): Promise<ConversationEntryV1> {
    const conversation = await this.sessionLifecycle.getSession(input.conversationId)
    if (!conversation) throw new Error("找不到 Agent 会话。")
    const candidateConversation = {
      ...conversation,
      agentConfig: {
        ...(conversation.agentConfig ?? {}),
        activeMainThreadPersonaId: input.personaId,
      },
    }
    const resolved = await this.deps.sdkPersonaConfig?.({
      projectId: this.deps.projectId,
      sessionKey: conversation.sessionKey,
      platform: conversation.platform ?? "local",
      workspaceKey: conversation.workspaceKey,
      workspacePath: conversation.workspacePath,
      content: "",
    }, candidateConversation)
    const snapshot = input.personaId ? resolved?.snapshot : null
    if (input.personaId && !snapshot) throw new Error("智能体不可用")
    const updated = await this.sessionLifecycle.saveMainThreadPersona(input.conversationId, snapshot ?? null)
    this.emitConversationUpdated(updated)
    return updated
  }

  private async applyGeneratedConversationTitle(
    conversationId: string,
    title: string,
  ): Promise<void> {
    try {
      const updated = await this.repository.renameSessionFromGeneratedTitle(conversationId, title)
      if (updated) this.emitConversationUpdated(updated)
    } catch (error) {
      this.deps.logger?.warn("Agent generated conversation title persistence failed.", {
        boundary: "agent-runtime.conversation-title.generated",
        projectId: this.deps.projectId,
        conversationId,
        ...errorLogMeta(error),
      })
    }
  }

  async clearCurrentAgentSessionId(
    sessionKey: string,
    platform = "local",
    workspaceKey?: string,
  ): Promise<ConversationEntryV1 | null> {
    return this.sessionLifecycle.clearCurrentAgentSessionId(sessionKey, platform, workspaceKey)
  }

  async resetSession(
    sessionKey: string,
    platform = "local",
    workspaceKey?: string,
  ): Promise<ConversationEntryV1 | null> {
    const reset = await this.sessionLifecycle.resetSession(sessionKey, platform, workspaceKey)
    if (reset) {
      this.conversationRouter.forgetSavedSdkSession(reset.id)
    }
    return reset
  }

  async createSession(
    input: {
      readonly sessionKey: string
      readonly platform?: string
      readonly name?: string
      readonly agentType?: string
      readonly workspaceKey?: string
      readonly workspacePath?: string
      readonly providerId?: string
      readonly mode?: string
      readonly modelTier?: string
    },
  ): Promise<ConversationEntryV1> {
    return this.sessionLifecycle.createSession(input)
  }

  async switchSession(
    sessionKey: string,
    conversationIdValue: string,
    platform?: string,
    workspaceKey?: string,
  ): Promise<ConversationEntryV1> {
    return this.sessionLifecycle.switchSession(sessionKey, conversationIdValue, platform, workspaceKey)
  }

  async reapIdleWorkspaceRuntimes(
    idleTimeoutMs: number,
    nowMs = Date.now(),
  ): Promise<readonly string[]> {
    return this.sessionLifecycle.reapIdleWorkspaceRuntimes(idleTimeoutMs, nowMs)
  }

  async renameSession(conversationIdValue: string, name: string): Promise<boolean> {
    return this.sessionLifecycle.renameSession(conversationIdValue, name)
  }

  async deleteSession(conversationIdValue: string): Promise<boolean> {
    const deleted = await this.sessionLifecycle.deleteSession(conversationIdValue)
    if (deleted) {
      this.conversationRouter.forgetSavedSdkSession(conversationIdValue)
    }
    return deleted
  }

  private recordPermissionAudit(
    action: PermissionAction,
    actor: ActorIdentity,
    resource: string,
    outcome: "allowed" | "denied" | "failed",
    pending: AgentPendingPermission,
    metadata: Record<string, unknown>,
  ): void {
    this.deps.auditSink?.record({
      action,
      actor,
      resource: permissionAuditResource(resource, pending.toolName),
      outcome,
      metadata: {
        ...metadata,
          projectId: pending.projectId,
          sessionKey: pending.sessionKey,
          workspaceKey: pending.workspaceKey,
          workspacePath: pending.workspacePath,
          conversationId: pending.conversationId,
        requestId: pending.requestId,
        toolName: pending.toolName,
      },
    })
  }

  private stateForConversation(conversationIdValue: string, message?: AgentMessage): RuntimeSessionState {
    return this.sessionLifecycle.stateForConversation(conversationIdValue, message)
  }

  private async closeIdleStateForConversation(
    sessionKey: string,
    platform?: string,
    workspaceKey?: string,
  ): Promise<void> {
    return this.sessionLifecycle.closeIdleStateForConversation(sessionKey, platform, workspaceKey)
  }

  private resetMessageSession(message: AgentMessage): Promise<ConversationEntryV1 | null> {
    return this.resetSession(message.sessionKey, message.platform, message.workspaceKey)
  }

  private async showReferenceForMessage(
    message: AgentMessage,
    args: readonly string[],
  ): Promise<string> {
    const parsed = parseReferenceViewOptions(args)
    if (!parsed) return "Use /show <path[:line]>."
    const workDir = this.workDirFor(message)
    if (!workDir) throw new Error(AGENT_PROJECT_WORKSPACE_REQUIRED_MESSAGE)
    const reference = resolveLocalReference(parsed.reference, workDir)
    if (!reference) return "Reference is outside the workspace or invalid."
    const actor: ActorIdentity = { kind: "user", id: message.userId }
    const permission = await this.deps.permissionGuard?.check({
      action: "fs.read.outside-userdata",
      actor,
      resource: reference.path,
      context: {
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        workspacePath: workDir,
        command: "/show",
      },
    })
    if (permission && !permission.allowed) {
      this.deps.auditSink?.record({
        action: "fs.read.outside-userdata",
        actor,
        resource: reference.path,
        outcome: "denied",
        metadata: {
          projectId: this.deps.projectId,
          sessionKey: message.sessionKey,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }
    try {
      const content = await renderReferenceView(parsed.reference, workDir, parsed.options)
      this.deps.auditSink?.record({
        action: "fs.read.outside-userdata",
        actor,
        resource: reference.path,
        outcome: "allowed",
        metadata: {
          projectId: this.deps.projectId,
          sessionKey: message.sessionKey,
          command: "/show",
        },
      })
      return content
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      this.deps.auditSink?.record({
        action: "fs.read.outside-userdata",
        actor,
        resource: reference.path,
        outcome: "failed",
        metadata: {
          projectId: this.deps.projectId,
          sessionKey: message.sessionKey,
          command: "/show",
          error: messageText,
        },
      })
      throw error
    }
  }

  private async runCustomCommand(
    command: AgentCommandEntryV1,
    args: readonly string[],
    message: AgentMessage,
  ): Promise<string> {
    if (!this.deps.commandRunner) throw new Error(AGENT_COMMAND_EXECUTION_UNAVAILABLE_MESSAGE)
    if (!command.exec?.trim()) throw new Error(AGENT_COMMAND_EXEC_BODY_MISSING_MESSAGE)
    const workDir = command.workDir ?? this.workDirFor(message)
    if (!workDir) throw new Error(AGENT_PROJECT_WORKSPACE_REQUIRED_MESSAGE)
    const shellOptions = {
      windowsDefault: "powershell" as const,
      posixLogin: false,
    }
    const shellKind = resolveEffectiveShell(command.shell, shellOptions)
    const escapedArgs = args.map((a) => escapeShellArg(a, shellKind)).join(" ")
    const shell = resolveShellCommand(command.shell, `${command.exec} ${escapedArgs}`.trim(), {
      ...shellOptions,
    })
    const sessionEnv = this.replyTargetEnv(message)
    const sessionEnvKeys = Object.keys(sessionEnv ?? {})
    const result = await this.deps.commandRunner.run({
      actor: { kind: "user", id: message.userId },
      action: "shell.exec",
      command: shell.command,
      args: [...shell.args],
      cwd: workDir,
      ...(sessionEnv ? { env: sessionEnv, envAllowlist: sessionEnvKeys } : {}),
      isolation: await this.resolveProcessIsolation(message, sessionEnvKeys),
      timeoutMs: 60_000,
      output: { stdout: "buffer", stderr: "buffer" },
      metadata: {
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        command: `/${command.name}`,
        shell: shell.shell,
        platform: message.platform,
      },
    })
    return formatCommandResult(command.name, result)
  }

  private async getOrCreateCompressionState(
    agentType: string,
  ): Promise<AgentCompressStateEntryV1> {
    if (!this.deps.compressState) throw new Error(AGENT_COMPRESSION_STATE_UNAVAILABLE_MESSAGE)
    const id = compressionStateId(this.deps.projectId, agentType)
    const existing = await this.deps.compressState.get(id)
    if (existing) return existing
    const now = this.isoNow()
    const entry: AgentCompressStateEntryV1 = {
      id,
      schemaVersion: 1,
      projectId: this.deps.projectId,
      agentType,
      enabled: false,
      maxTokens: 60_000,
      minGapMins: 30,
      lastStatus: "idle",
      createdAt: now,
      updatedAt: now,
    }
    await this.deps.compressState.upsert(entry)
    return entry
  }

  private async markCompressionState(
    agentType: string,
    status: AgentCompressStateEntryV1["lastStatus"],
    error?: string,
  ): Promise<void> {
    if (!this.deps.compressState) return
    const existing = await this.getOrCreateCompressionState(agentType)
    const now = this.isoNow()
    await this.deps.compressState.upsert({
      ...existing,
      lastCompressedAt: status === "success" ? now : existing.lastCompressedAt,
      lastStatus: status,
      lastError: error,
      updatedAt: now,
    })
  }

  private workDirFor(message: AgentMessage): string | undefined {
    return message.workspacePath ?? this.deps.workDir
  }

  private async persistUserQuestionResolution(
    pending: PendingPermissionState,
    resolution: AgentUserQuestionResolution,
    required = false,
  ): Promise<void> {
    try {
      const conversation = await this.repository.resolveUserQuestion(
        pending.conversationId,
        pending.requestId,
        resolution,
      )
      if (!conversation && required) {
        throw new Error("AskUserQuestion history entry is unavailable")
      }
      if (conversation) this.emitConversationUpdated(conversation)
    } catch (error) {
      this.deps.logger?.warn("Agent user question resolution persistence failed.", {
        boundary: "agent-runtime.user-question-resolution",
        projectId: pending.projectId,
        conversationId: pending.conversationId,
        requestId: pending.requestId,
        status: resolution.status,
        error: agentRuntimeErrorSummary(error),
      })
      if (required) {
        throw new Error(AGENT_USER_QUESTION_PERSISTENCE_FAILED_MESSAGE, { cause: error })
      }
    }
  }

  private async prepareUserQuestionResolution(
    pending: PendingPermissionState,
    resolution: AgentUserQuestionResolution,
  ): Promise<void> {
    try {
      const conversation = await this.repository.prepareUserQuestionResolution(
        pending.conversationId,
        pending.requestId,
        resolution,
      )
      if (!conversation) throw new Error("AskUserQuestion history entry is unavailable")
      this.emitConversationUpdated(conversation)
    } catch (error) {
      this.deps.logger?.warn("Agent user question response attempt persistence failed.", {
        boundary: "agent-runtime.user-question-response-attempt",
        projectId: pending.projectId,
        conversationId: pending.conversationId,
        requestId: pending.requestId,
        status: resolution.status,
        error: agentRuntimeErrorSummary(error),
      })
      throw new Error(AGENT_USER_QUESTION_PERSISTENCE_FAILED_MESSAGE, { cause: error })
    }
  }

  private async respondToUserQuestion(
    pending: PendingPermissionState,
    decision: AgentPermissionDecision,
  ): Promise<void> {
    try {
      await pending.liveSession.respondPermission(pending.requestId, decision)
    } catch (error) {
      this.deps.logger?.warn("Agent user question SDK response failed.", {
        boundary: "agent-runtime.user-question-sdk-response",
        projectId: pending.projectId,
        conversationId: pending.conversationId,
        requestId: pending.requestId,
        behavior: decision.behavior,
        error: agentRuntimeErrorSummary(error),
      })
      throw error
    }
  }

  private replyTargetEnv(message: AgentMessage): Record<string, string> | undefined {
    return this.deps.replyTargets?.getAgentEnv(this.deps.projectId, message.sessionKey)
  }

  private async resolveProcessIsolation(message: AgentMessage, extraEnvKeys?: readonly string[]) {
    const sessionEnvKeys = extraEnvKeys ?? Object.keys(this.replyTargetEnv(message) ?? {})
    return this.deps.executionIsolation?.resolveProcessIsolation(
      this.deps.projectId,
      sessionEnvKeys,
    )
  }

  private agentType(): string {
    return this.deps.agentType ?? "claude-code"
  }

  private emitConversationUpdated(conversation: ConversationEntryV1): void {
    this.deps.eventBus?.emit({
      domain: "agent",
      type: "conversationUpdated",
      payload: {
        projectId: this.deps.projectId,
        sessionKey: conversation.sessionKey,
        platform: conversation.platform ?? "local",
        conversationId: conversation.id,
      },
      scope: { sessionId: conversation.id },
      timestamp: this.isoNow(),
    })
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  private logScheduledAgentFailure(
    input: ScheduledAgentSendInput,
    message: AgentMessage,
    result: ScheduledAgentSendResult,
    errorLength?: number,
    sdkSessionId?: string,
  ): void {
    this.deps.logger?.warn("Scheduled agent send failed.", {
      boundary: "agent-runtime.scheduled-send",
      source: input.sourcePlatform ?? "workflow",
      sourcePlatform: input.sourcePlatform ?? "workflow",
      projectId: input.projectId,
      sessionKey: message.sessionKey,
      conversationId: result.conversationId || undefined,
      sdkSessionId,
      agentType: input.agentType,
      mode: input.mode,
      sessionPolicy: input.sessionPolicy,
      resumeConversationId: input.lastConversationId,
      status: result.status,
      errorLength: errorLength ?? result.error?.length,
      timeoutMs: input.timeoutMs,
      durationMs: result.durationMs,
      promptLength: input.prompt.length,
    })
  }

  private logScheduledAgentCompletion(
    input: ScheduledAgentSendInput,
    message: AgentMessage,
    result: ScheduledAgentSendResult,
    sdkSessionId: string | undefined,
  ): void {
    this.deps.logger?.info("Scheduled agent send completed.", {
      boundary: "agent-runtime.scheduled-send",
      source: input.sourcePlatform ?? "workflow",
      sourcePlatform: input.sourcePlatform ?? "workflow",
      projectId: input.projectId,
      sessionKey: message.sessionKey,
      conversationId: result.conversationId || undefined,
      sdkSessionId,
      agentType: input.agentType,
      mode: input.mode,
      sessionPolicy: input.sessionPolicy,
      resumeConversationId: input.lastConversationId,
      status: result.status,
      timeoutMs: input.timeoutMs,
      durationMs: result.durationMs,
      promptLength: input.prompt.length,
      summaryLength: result.summary?.length,
    })
  }

  private logScheduledResumeFallback(
    input: ScheduledAgentSendInput,
    message: AgentMessage,
    error: unknown,
  ): void {
    this.deps.logger?.warn("Scheduled agent resume fallback.", {
      boundary: "agent-runtime.scheduled-resume",
      source: input.sourcePlatform ?? "workflow",
      sourcePlatform: input.sourcePlatform ?? "workflow",
      projectId: input.projectId,
      sessionKey: message.sessionKey,
      resumeConversationId: input.lastConversationId,
      agentType: input.agentType,
      mode: input.mode,
      sessionPolicy: input.sessionPolicy,
      fallback: "fresh-session",
      ...summarizeScheduledResumeError(error),
      promptLength: input.prompt.length,
    })
  }
}

export { conversationId }

export function permissionActionForTool(toolName: string): PermissionAction {
  switch (toolName) {
    case "Bash":
    case "Shell":
    case "run_shell_command":
      return "shell.exec"
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "fs.write"
    case "WebFetch":
    case "WebSearch":
      return "network.connect"
    case "Read":
    case "Glob":
    case "Grep":
      return "fs.read.outside-userdata"
    default:
      return "agent.spawn"
  }
}

function permissionAuditResource(resource: string, toolName: string): string {
  return resource === toolName ? toolName : `${toolName} input (${resource.length} chars)`
}

function isAskUserQuestionTool(toolName: string): boolean {
  return toolName === ASK_USER_QUESTION_TOOL_NAME
}

function askUserQuestionUpdatedInput(
  pending: PendingPermissionState,
  request: AgentPermissionResponseRequest,
): Record<string, unknown> | undefined {
  if (request.behavior === "deny") return request.updatedInput
  const answers = recordValue(request.updatedInput?.answers)
  if (!answers || Object.keys(answers).length === 0) {
    throw new Error(AGENT_ASK_USER_QUESTION_ANSWERS_REQUIRED_MESSAGE)
  }
  const questions = pending.questions ?? pending.toolInputRaw?.questions ?? request.updatedInput?.questions
  if (!Array.isArray(questions)) {
    throw new Error(AGENT_ASK_USER_QUESTION_QUESTIONS_REQUIRED_MESSAGE)
  }
  const normalized = normalizeAskUserQuestionResponse(answers, questions)
  return {
    ...omitAskUserQuestionResponseFields(request.updatedInput),
    questions,
    ...(normalized.kind === "answers"
      ? { answers: normalized.answers }
      : { response: normalized.response }),
  }
}

function askUserQuestionResolution(
  pending: PendingPermissionState,
  request: AgentPermissionResponseRequest,
  resolvedAt: string,
): AgentUserQuestionResolution {
  if (request.behavior === "deny") {
    return { status: "skipped", resolvedAt }
  }
  const questions = request.updatedInput?.questions ?? pending.questions ?? pending.toolInputRaw?.questions
  const answers = recordValue(request.updatedInput?.answers)
  if (!Array.isArray(questions) || !answers) {
    return { status: "answered", resolvedAt }
  }
  const questionTextCounts = askUserQuestionTextCounts(questions)
  const resolvedAnswers = questions.flatMap((question, index) => {
    const record = recordValue(question)
    const values = askUserQuestionAnswerValues(answers, record, index, questionTextCounts) ?? []
    return values.length > 0 ? [{ questionIndex: index, values }] : []
  })
  return {
    status: "answered",
    resolvedAt,
    ...(resolvedAnswers.length > 0 ? { answers: resolvedAnswers } : {}),
  }
}

function normalizeAskUserQuestionAnswerValues(value: unknown): string[] {
  if (value === undefined || value === null) return []
  const values = Array.isArray(value) ? value : [value]
  return values
    .map((item) => String(item).trim())
    .filter(Boolean)
}

function normalizeAskUserQuestionResponse(
  answers: Record<string, unknown>,
  questions: readonly unknown[],
): { readonly kind: "answers"; readonly answers: Record<string, unknown> }
  | { readonly kind: "response"; readonly response: string } {
  if (Object.keys(answers).length < questions.length) {
    throw new Error(AGENT_ASK_USER_QUESTION_ALL_ANSWERS_REQUIRED_MESSAGE)
  }
  const questionTextCounts = askUserQuestionTextCounts(questions)
  const normalizedAnswers: Record<string, unknown> = {}
  const responseLines: string[] = []
  let hasDuplicateQuestionText = false

  questions.forEach((question, index) => {
    const record = recordValue(question)
    const textKey = stringRecordValue(record?.question)
    if (!textKey) {
      throw new Error(AGENT_ASK_USER_QUESTION_ALL_ANSWERS_REQUIRED_MESSAGE)
    }
    if ((questionTextCounts.get(textKey) ?? 0) > 1) {
      hasDuplicateQuestionText = true
    }
    const answerValues = askUserQuestionAnswerValues(answers, record, index, questionTextCounts)
    if (!answerValues) {
      throw new Error(AGENT_ASK_USER_QUESTION_ALL_ANSWERS_REQUIRED_MESSAGE)
    }
    const label = askUserQuestionResponseLabel(record, index)
    const formattedAnswer = answerValues.join(", ")
    normalizedAnswers[textKey] = formattedAnswer
    responseLines.push(`${index + 1}. ${label}: ${formattedAnswer}`)
  })

  if (hasDuplicateQuestionText) {
    return { kind: "response", response: responseLines.join("\n") }
  }

  return { kind: "answers", answers: normalizedAnswers }
}

function askUserQuestionTextCounts(questions: readonly unknown[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const question of questions) {
    const text = stringRecordValue(recordValue(question)?.question)
    if (!text) continue
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  return counts
}

function askUserQuestionAnswerValues(
  answers: Record<string, unknown>,
  question: Record<string, unknown> | undefined,
  index: number,
  questionTextCounts: ReadonlyMap<string, number>,
): string[] | undefined {
  for (const key of askUserQuestionAnswerKeys(question, index, questionTextCounts)) {
    const values = normalizeAskUserQuestionAnswerValues(answers[key])
    if (values.length > 0) return values
  }
  return undefined
}

function askUserQuestionAnswerKeys(
  question: Record<string, unknown> | undefined,
  index: number,
  questionTextCounts: ReadonlyMap<string, number>,
): readonly string[] {
  const keys: string[] = []
  const textKey = stringRecordValue(question?.question)
  if (textKey && (questionTextCounts.get(textKey) ?? 0) <= 1) {
    keys.push(textKey)
  }
  const idKey = stringRecordValue(question?.id)
  if (idKey) keys.push(idKey)
  const stableKey = stringRecordValue(question?.key)
  if (stableKey) keys.push(stableKey)
  keys.push(`question-${index}`)
  return [...new Set(keys)]
}

function askUserQuestionResponseLabel(question: Record<string, unknown> | undefined, index: number): string {
  const text = stringRecordValue(question?.question) ?? `Question ${index + 1}`
  const header = stringRecordValue(question?.header)
  return header ? `${header}: ${text}` : text
}

function omitAskUserQuestionResponseFields(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const output = { ...(input ?? {}) }
  delete output.questions
  delete output.answers
  delete output.response
  return output
}

function stringRecordValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function askUserQuestionResponseMessage(request: AgentPermissionResponseRequest): string | undefined {
  if (request.behavior !== "deny") return request.message
  const answers = recordValue(request.updatedInput?.answers)
  return answers && Object.keys(answers).length > 0
    ? request.message
    : ASK_USER_QUESTION_EMPTY_ANSWER_MESSAGE
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function compressionStateId(projectId: string, agentType: string): string {
  return `compress:${projectId}:${agentType}`
}

function formatCommandResult(name: string, result: ControlledProcessResult): string {
  const output = [result.stdout, result.stderr]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n")
  const status = commandExecutionStatusMessage({
    name,
    timedOut: result.timedOut,
    exitCode: result.exitCode,
    signal: result.signal,
  })
  return output ? `${status}\n\n${truncateRunes(redactSensitiveText(output), 4000)}` : status
}

function summarizePermissionResponseError(error: unknown): { errorName: string; errorLength: number } {
  if (error instanceof Error) {
    return {
      errorName: error.name || "Error",
      errorLength: error.message.length,
    }
  }
  const message = String(error)
  return {
    errorName: typeof error,
    errorLength: message.length,
  }
}

function isPermissionNotPendingResponseError(error: unknown): boolean {
  return error instanceof Error && error.message === AGENT_PERMISSION_NOT_PENDING_MESSAGE
}

function summarizeScheduledResumeError(error: unknown): { errorName: string; errorLength: number; errorMessage: string } {
  const rawMessage = rawAgentRuntimeErrorMessage(error)
  if (error instanceof Error) {
    return {
      errorName: error.name || "Error",
      errorLength: rawMessage.length,
      errorMessage: errorMessage(error),
    }
  }
  return {
    errorName: typeof error,
    errorLength: rawMessage.length,
    errorMessage: errorMessage(error),
  }
}

const errorMessage = agentRuntimeErrorMessage

function scheduledLiveEventTimeoutMs(timeoutMs: number | undefined): number | undefined {
  return timeoutMs !== undefined && timeoutMs > 0 ? undefined : 0
}

function scheduledConversationTarget(
  conversation: Pick<ConversationEntryV1, "id" | "projectId" | "sessionKey">,
  platform: SynapseAgentConversationTarget["platform"],
): SynapseAgentConversationTarget | null {
  if (!conversation.id || !conversation.projectId || !conversation.sessionKey) return null
  return {
    projectId: conversation.projectId,
    conversationId: conversation.id,
    sessionKey: conversation.sessionKey,
    platform,
  }
}

async function resolvePublishedProjectCommands(
  source: PublishedProjectCommandSource | undefined,
  platform: string,
): Promise<readonly PublishedAgentCommand[]> {
  if (!source) return []
  return typeof source === "function" ? await source(platform) : source
}

function truncateRunes(value: string, maxRunes: number): string {
  const runes = [...value]
  if (runes.length <= maxRunes) return value
  return `${runes.slice(0, maxRunes).join("")}...`
}

function formatScheduledSessionName(input: ScheduledAgentSendInput, now: Date): string {
  const timestamp = formatAutomatedSessionTimestamp(now)
  const subject = input.sourcePlatform === "workflow"
    ? workflowSessionSubject(input.userMeta)
    : scheduledSessionSubject(input.userMeta)
  return subject ? `${truncateRunes(subject, 48)} · ${timestamp}` : timestamp
}

function scheduledSessionSubject(userMeta: Record<string, unknown> | undefined): string | undefined {
  return stringMeta(userMeta, "automationName") ?? stringMeta(userMeta, "taskName")
}

function workflowSessionSubject(userMeta: Record<string, unknown> | undefined): string | undefined {
  const workflowName = stringMeta(userMeta, "workflowName")
  const nodeName = stringMeta(userMeta, "workflowNodeName")
  if (workflowName && nodeName && workflowName !== nodeName) return `${workflowName} / ${nodeName}`
  return workflowName ?? nodeName
}

function stringMeta(userMeta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = userMeta?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function formatAutomatedSessionTimestamp(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  const hours = String(now.getHours()).padStart(2, "0")
  const minutes = String(now.getMinutes()).padStart(2, "0")
  return `${month}-${day} ${hours}:${minutes}`
}

function escapeShellArg(arg: string, shell: string): string {
  if (shell === "powershell") {
    // PowerShell single-quoted strings are literal (no interpolation)
    return `'${arg.replace(/'/g, "''")}'`
  }
  if (shell === "cmd") {
    // cmd.exe keeps embedded quotes inside a quoted argument when they are doubled.
    if (/[\s&|<>^()"]/.test(arg)) {
      return `"${arg.replace(/"/g, '""')}"`
    }
    return arg
  }
  // POSIX shell: single-quote wrapping, escape embedded single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`
}

export type { AgentGovernanceDecision }
