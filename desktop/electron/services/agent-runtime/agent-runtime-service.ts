import type {
  AgentCommandEntryV1,
  AgentCompressStateEntryV1,
  ConversationEntryV1,
  AgentEventEntryV1,
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
import { AgentCommandRouter } from "./command-router"
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
import type {
  AgentEvent,
  AgentMessage,
  AgentPendingPermission,
  AgentPermissionResponseRequest,
  AgentRuntimeRelayResult,
  AgentRuntimeTurnResult,
  CancelTurnResult,
  ScheduledAgentSendInput,
  ScheduledAgentSendResult,
} from "./types"
import type { SkillRegistry } from "./skill-registry"
import { sanitizeError } from "../error-sanitize"
import type { SynapseAgentConversationTarget } from "../../../src/types/agent-navigation"

interface CommandExecutionRunner {
  run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult>
}

export interface AgentRuntimeServiceDeps {
  readonly projectId: string
  readonly workDir?: string
  readonly conversations: DataNamespace<ConversationEntryV1>
  readonly providerService: ProviderService
  readonly createSession?: AgentLiveSessionFactory
  readonly agentType?: string
  readonly sessionRepository?: AgentSessionRepository
  readonly agentEvents?: DataNamespace<AgentEventEntryV1>
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
  readonly commandRunner?: CommandExecutionRunner
  readonly executionIsolation?: ProcessIsolationResolver
  readonly sdkPlugins?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    readonly AgentSdkPluginSpec[] | Promise<readonly AgentSdkPluginSpec[]>
  readonly allowPluginHooks?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    boolean | Promise<boolean>
  readonly sdkAgents?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    AgentSdkAgentDefinitions | Promise<AgentSdkAgentDefinitions>
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
      now: deps.now,
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
      sdkPlugins: deps.sdkPlugins,
      allowPluginHooks: deps.allowPluginHooks,
      sdkAgents: deps.sdkAgents,
      sdkSubagentToolPolicies: deps.sdkSubagentToolPolicies,
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
      compressSession: (message, conversation) =>
        this.conversationRouter.compressSession(message, conversation),
    })
    this.conversationRouter = new ConversationRouter({
      deps: {
        projectId: deps.projectId,
        workDir: deps.workDir,
        eventBus: deps.eventBus,
        logger: deps.logger,
        governance: deps.governance,
        pendingQueueLimit: deps.pendingQueueLimit,
        permissionTimeoutMs: deps.permissionTimeoutMs,
        outbox: deps.outbox,
        replyTargets: deps.replyTargets,
        agentEvents: deps.agentEvents,
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
  ): Promise<AgentRuntimeTurnResult> {
    return this.conversationRouter.sendNewSession(message, name)
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
    const sourcePlatform = input.sourcePlatform ?? "scheduled"
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
        error: "Aborted before execution",
        durationMs,
      }
      this.logScheduledAgentFailure(input, message, result)
      return result
    }

    const onExternalAbort = () => ac.abort()
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true })

    const timeout = input.timeoutMs > 0
      ? setTimeout(() => ac.abort(), input.timeoutMs)
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
            error: "Agent spawn not permitted for scheduled execution",
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
          liveEventTimeoutMs: scheduledLiveEventTimeoutMs(input.timeoutMs),
          onConversationCreated: captureConversationTarget,
        })
      } else {
        try {
          result = await this.conversationRouter.sendToConversation(message, input.lastConversationId, {
            abortSignal: ac.signal,
            liveEventTimeoutMs: scheduledLiveEventTimeoutMs(input.timeoutMs),
          })
        } catch (resumeError) {
          const isNotFound = resumeError instanceof Error
            && resumeError.message.includes("not found")
          if (!isNotFound) throw resumeError
          this.logScheduledResumeFallback(input, message, resumeError)
          const name = formatScheduledSessionName(input, this.deps.now?.() ?? new Date())
          result = await this.conversationRouter.sendNewSession(message, name, {
            abortSignal: ac.signal,
            liveEventTimeoutMs: scheduledLiveEventTimeoutMs(input.timeoutMs),
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
          error: `Execution exceeded ${input.timeoutMs}ms timeout`,
          durationMs: Date.now() - startMs,
          usage: result.usage,
          costUsd: result.costUsd,
          costCny: result.costCny,
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
        costUsd: result.costUsd,
        costCny: result.costCny,
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
          ? `Execution exceeded ${input.timeoutMs}ms timeout`
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

    this.sessionManager.settlePending(state)

    if (state.liveSession) {
      const gracefulSent = await this.sessionManager.interrupt(conversationId)
      if (!gracefulSent) {
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
      toolInput: sanitizePendingPermissionText(pending.toolInput),
      toolInputRaw: sanitizePendingPermissionRawInput(pending.toolInputRaw),
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
      throw new Error(`Permission request "${request.requestId}" is not pending`)
    }
    if (request.sessionKey !== undefined && request.sessionKey !== pending.sessionKey) {
      throw new Error(`Session key mismatch: the request's session does not own this permission`)
    }

    const action = permissionActionForTool(pending.toolName)
    const resource = pending.toolInput ?? pending.toolName

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
        updatedInput: request.updatedInput ?? pending.toolInputRaw,
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
        updatedInput: request.updatedInput ?? pending.toolInputRaw,
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
      throw new Error(`Conversation "${input.conversationId}" was not found`)
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
    return this.sessionLifecycle.resetSession(sessionKey, platform, workspaceKey)
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
    return this.sessionLifecycle.deleteSession(conversationIdValue)
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
    if (!workDir) throw new Error("Project workspace path is required")
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
    if (!this.deps.commandRunner) throw new Error("Command execution is unavailable")
    if (!command.exec?.trim()) throw new Error("Command is missing exec body")
    const workDir = command.workDir ?? this.workDirFor(message)
    if (!workDir) throw new Error("Project workspace path is required")
    const shellOptions = {
      windowsDefault: "powershell" as const,
      posixLogin: false,
    }
    const shellKind = resolveEffectiveShell(command.shell, shellOptions)
    const escapedArgs = args.map((a) => escapeShellArg(a, shellKind)).join(" ")
    const shell = resolveShellCommand(command.shell, `${command.exec} ${escapedArgs}`.trim(), {
      ...shellOptions,
    })
    const result = await this.deps.commandRunner.run({
      actor: { kind: "user", id: message.userId },
      action: "shell.exec",
      command: shell.command,
      args: [...shell.args],
      cwd: workDir,
      isolation: await this.resolveProcessIsolation(message),
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
    if (!this.deps.compressState) throw new Error("Compression state is unavailable")
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

  private async resolveProcessIsolation(message: AgentMessage) {
    const sessionEnv = this.deps.replyTargets?.getAgentEnv(this.deps.projectId, message.sessionKey)
    return this.deps.executionIsolation?.resolveProcessIsolation(
      this.deps.projectId,
      Object.keys(sessionEnv ?? {}),
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
      source: input.sourcePlatform ?? "scheduled",
      sourcePlatform: input.sourcePlatform ?? "scheduled",
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
      source: input.sourcePlatform ?? "scheduled",
      sourcePlatform: input.sourcePlatform ?? "scheduled",
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
      source: input.sourcePlatform ?? "scheduled",
      sourcePlatform: input.sourcePlatform ?? "scheduled",
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

function sanitizePendingPermissionRawInput(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined
  return sanitizePendingPermissionValue(value) as Record<string, unknown>
}

function sanitizePendingPermissionValue(value: unknown, key = ""): unknown {
  if (isSensitivePendingPermissionKey(key)) return "[redacted]"
  if (typeof value === "string") return sanitizePendingPermissionText(value)
  if (Array.isArray(value)) return value.map((item) => sanitizePendingPermissionValue(item, key))
  if (!value || typeof value !== "object") return value

  const output: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = sanitizePendingPermissionValue(childValue, childKey)
  }
  return output
}

function sanitizePendingPermissionText(value: string | undefined): string | undefined {
  if (!value) return value
  return truncateRunes(
    value
      .replace(
        /\b(api[-_]?key|authorization|cookie|password|credential|secret|token)\b(\s*[:=]\s*)(?:(Bearer)\s+)?[^\s,;'"`]+/gi,
        (_match, key: string, separator: string, bearer: string | undefined) =>
          `${key}${separator}${bearer ? `${bearer} ` : ""}[redacted]`,
      )
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"),
    240,
  )
}

function isSensitivePendingPermissionKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "")
  return normalized.includes("secret")
    || normalized.includes("apikey")
    || normalized.includes("authorization")
    || normalized.includes("cookie")
    || normalized.includes("password")
    || normalized.includes("credential")
    || (normalized.includes("token") && !normalized.endsWith("tokens"))
}

function compressionStateId(projectId: string, agentType: string): string {
  return `compress:${projectId}:${agentType}`
}

function formatCommandResult(name: string, result: ControlledProcessResult): string {
  const output = [result.stdout, result.stderr]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n")
  const status = result.timedOut
    ? `Command timed out: /${name}`
    : result.exitCode === 0
      ? `Command completed: /${name}`
      : `Command failed: /${name} (${String(result.exitCode ?? result.signal ?? "unknown")})`
  return output ? `${status}\n\n${truncateRunes(output, 4000)}` : status
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

function summarizeScheduledResumeError(error: unknown): { errorName: string; errorLength: number; errorMessage: string } {
  if (error instanceof Error) {
    return {
      errorName: error.name || "Error",
      errorLength: error.message.length,
      errorMessage: error.message,
    }
  }
  const message = String(error)
  return {
    errorName: typeof error,
    errorLength: message.length,
    errorMessage: message,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function scheduledLiveEventTimeoutMs(timeoutMs: number): number | undefined {
  return timeoutMs > 0 ? undefined : 0
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
  return stringMeta(userMeta, "taskName")
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
    // cmd.exe: wrap in quotes if contains special chars, escape inner quotes
    if (/[\s&|<>^()"]/.test(arg)) {
      return `"${arg.replace(/"/g, '\\"')}"`
    }
    return arg
  }
  // POSIX shell: single-quote wrapping, escape embedded single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`
}

export type { AgentGovernanceDecision }
