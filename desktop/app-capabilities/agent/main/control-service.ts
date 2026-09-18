import { randomUUID } from "node:crypto"
import type { CCProvider } from "../../../electron/services/provider"
import {
  MODEL_TIER_DISPLAY_ORDER,
  isProviderModelTierSelectable,
  pickDefaultProviderModelTier,
  pickInitialProviderModelSelection,
  resolveModelName,
  resolveModelDisplayName,
} from "../../../src/lib/provider-model-selection"
import type { ModelTier } from "../../../src/types/provider-model"

import type { ConversationEntryV1, DataRepository } from "../../../electron/runtime/data-repo"
import type { EventBus, DomainEvent } from "../../../electron/runtime/event-bus"
import type {
  AgentConversationRuntimeSnapshot,
  AgentMessage,
  AgentPendingPermission,
  AgentRuntimeService,
  AgentUserQuestion,
} from "../../../electron/services/agent-runtime"
import { redactSensitiveValue } from "../../../electron/services/agent-runtime/redaction"
import { historyRecordToTimelineItem } from "../../../src/lib/agent-timeline"
import { boundedTimelinePage } from "../../../electron/services/agent-runtime/timeline-page"
import { DEFAULT_AGENT_WORKSPACE_PROJECT } from "../../../src/lib/default-agent-workspace"
import {
  normalizeAgentProjectOrder,
  orderAgentProjects,
  splitPinnedAgentProjects,
} from "../../../src/modules/agent/project-order"
import type { DispatchActorIdentity } from "../../../synapse-capabilities/shared/types"
import { AgentConversationCapabilityError } from "../shared/errors"
import type {
  AgentGroupListInput,
  AgentProviderListInput,
  AgentConversationCreateInput,
  AgentConversationTargetInput,
  AgentConversationInspectInput,
  AgentConversationObserveInput,
  AgentMessageSendInput,
  AgentPermissionRespondInput,
  AgentTurnSteerInput,
  AgentTurnStopInput,
} from "../shared/schema"
import { buildAgentConversationDeepLink } from "../shared/schema"
import { agentConversationSourceForPlatform } from "../shared/source"
import { agentConversationReference } from "./conversation-reference"
import { AgentConversationTargetError, resolvePersistedAgentConversation } from "./conversation-target"

/**
 * The tiers one Provider can actually be asked for, with the name to show for each.
 *
 * A Provider may name no model for a tier, which means that tier is not a choice it
 * offers — the desktop's own picker disables it for the same reason. `resolveModelName`
 * first, because the ordinary case is a model id; the display name covers the one that
 * resolves to a label rather than an id, the bundled Claude Code following the
 * computer's own login.
 */
function selectableTierModels(provider: CCProvider): Partial<Record<ModelTier, string>> {
  const models: Partial<Record<ModelTier, string>> = {}
  for (const tier of MODEL_TIER_DISPLAY_ORDER) {
    if (!isProviderModelTierSelectable(provider, tier)) continue
    const name = resolveModelName(provider, tier) ?? resolveModelDisplayName(provider, tier)
    if (name) models[tier] = name
  }
  return models
}

const ITEM_BYTE_LIMIT = 64 * 1024
const PAGE_BYTE_LIMIT = 1024 * 1024
const TIMELINE_PAGE_BYTE_LIMIT = 800 * 1024
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000
const IDEMPOTENCY_ENTRY_LIMIT = 1_000
const CHANGE_HISTORY_LIMIT = 128
const MAX_OBSERVERS_PER_CONVERSATION = 4
const MAX_OBSERVERS_PER_CLIENT = 8
const MAX_OBSERVERS_GLOBAL = 32
const OMITTED = "[omitted]"

type ChangeType = "timeline" | "state" | "permission"
type ConversationSource = ReturnType<typeof agentConversationSourceForPlatform>
type Logger = {
  warn(message: string, context?: Record<string, unknown>): void
}
type RuntimeResolver = (projectId: string) => Promise<AgentRuntimeService>
type RuntimePeek = (projectId: string) => AgentRuntimeService | undefined
type ConversationTarget = { readonly projectId: string; readonly conversationId: string }
type ResolvedInput<T extends AgentConversationTargetInput> = Omit<T, keyof AgentConversationTargetInput>
  & ConversationTarget
type RevisionChange = { readonly revision: number; readonly types: readonly ChangeType[] }
type IdempotencyEntry = {
  readonly fingerprint: string
  readonly createdAt: number
  readonly result: Promise<unknown>
}
type Waiter = {
  readonly clientId: string
  readonly afterRevision: number
  resolve(): void
}

/** One row of the project directory `listAllGroups` returns, and `listGroups` pages over. */
export type AgentGroupChoice = {
  readonly projectId: string
  readonly name: string
  readonly isDefault: boolean
}

/**
 * One Provider as a phone may see it: no endpoint, no credential, no environment.
 *
 * Declared here rather than derived from the provider record so that adding a field to
 * that record cannot silently widen what leaves the desktop.
 */
export type AgentProviderChoice = {
  readonly id: string
  readonly name: string
  /** The Provider this desktop's own resolution picks, when a caller names none. */
  readonly isDefault: boolean
  /** The tier this Provider would be used at. Always present: unusable ones are not offered. */
  readonly defaultTier: ModelTier
  readonly models: Partial<Record<ModelTier, string>>
}

export class AgentConversationControlService {
  private readonly conversations
  private readonly revisions = new Map<string, number>()
  private readonly changes = new Map<string, RevisionChange[]>()
  private readonly waiters = new Map<string, Set<Waiter>>()
  private readonly observersByClient = new Map<string, number>()
  private readonly idempotency = new Map<string, IdempotencyEntry>()
  private readonly unsubscribeAgent: () => void
  private readonly unsubscribeConversations: () => void

  constructor(private readonly deps: {
    readonly dataRepository: DataRepository
    readonly eventBus: EventBus
    readonly resolveRuntime: RuntimeResolver
    readonly peekRuntime: RuntimePeek
    readonly listProjects: () => Promise<readonly { readonly id: string; readonly name: string }[]>
    readonly listProviders: () => Promise<readonly CCProvider[]>
    /**
     * The Provider and tier the desktop was configured to use by default, or null.
     *
     * Read rather than held because it is a setting the user can change while the
     * service is alive, and what it decides — which Provider a phone's new-conversation
     * panel marks as the default — has to follow the setting rather than a snapshot.
     */
    readonly readDefaultProviderModel: () => Promise<{ readonly providerId: string; readonly modelTier: ModelTier } | null>
    readonly createConversation: (input: Pick<AgentConversationCreateInput, "name" | "providerId" | "modelTier"> & { readonly projectId: string }) => Promise<ConversationEntryV1>
    readonly logger: Logger
    readonly now?: () => number
  }) {
    this.conversations = deps.dataRepository.namespace<ConversationEntryV1>("conversations")
    this.unsubscribeAgent = deps.eventBus.on("agent", (event) => this.onAgentEvent(event))
    this.unsubscribeConversations = this.conversations.onChange((change) => {
      if (!change.id) return
      const conversation = change.value ?? change.previous
      if (!conversation?.projectId) return
      this.bump(conversation.projectId, change.id, ["timeline", "state"])
    })
  }

  dispose(): void {
    this.unsubscribeAgent()
    this.unsubscribeConversations()
    for (const group of this.waiters.values()) {
      for (const waiter of group) waiter.resolve()
    }
    this.waiters.clear()
    this.observersByClient.clear()
  }

  async resolveTarget(input: AgentConversationTargetInput): Promise<ConversationTarget> {
    try {
      const conversation = await resolvePersistedAgentConversation(this.deps.dataRepository, input)
      return { projectId: conversation.projectId, conversationId: conversation.id }
    } catch (error) {
      if (error instanceof AgentConversationTargetError) {
        throw new AgentConversationCapabilityError(error.code)
      }
      throw error
    }
  }

  /**
   * The whole project directory, unpaged.
   *
   * Public because it is the same list two consumers need for different reasons:
   * `listGroups` pages over it for the capability, and the mobile gateway hands the
   * desktop's own project list to a phone so its new-conversation panel offers the
   * same choices the desktop's sidebar does. A second builder here would be a second
   * answer to "which projects exist".
   *
   * `displayOrder` is a consumer that stands in for the sidebar passing on the sidebar's
   * own order preference (`global.agentProjectOrder`), so a list the user reads is in
   * the order they dragged it into. Omitted, the directory answers in configured order,
   * which is what the capability pages over: that preference is a display fact about one
   * sidebar, not a property of the projects themselves.
   */
  async listAllGroups(displayOrder: readonly unknown[] = []): Promise<readonly AgentGroupChoice[]> {
    const projects = await this.deps.listProjects()
    const listed = [DEFAULT_AGENT_WORKSPACE_PROJECT, ...projects.filter(
      (project) => project.id !== DEFAULT_AGENT_WORKSPACE_PROJECT.id,
    )]
    // Split rather than ordered whole: 本地对话 leads the sidebar by position, so the
    // preference is only ever read against the projects that can actually move.
    const { pinned, sortable } = splitPinnedAgentProjects(listed)
    const ordered = [...pinned, ...orderAgentProjects(sortable, normalizeAgentProjectOrder(sortable, displayOrder))]
    return ordered.map((project) => ({
      projectId: project.id,
      name: project.name,
      isDefault: project.id === DEFAULT_AGENT_WORKSPACE_PROJECT.id,
    }))
  }

  /**
   * Every Provider a conversation may be started with, reduced to what a phone may know.
   *
   * The reduction is the point. `deps.listProviders()` answers with the full provider
   * record, credentials and endpoint included, and this is the boundary where that stops:
   * `id`, `name`, which one is active, and the model each tier resolves to are copied out
   * and the rest is never read. Not filtered afterwards — never carried — so there is no
   * version of the returned value that could have a key in it.
   *
   * A tier the Provider does not name is left out rather than sent empty, which is what
   * the phone's picker disables.
   */
  async listProviderChoices(): Promise<readonly AgentProviderChoice[]> {
    const providers = (await this.deps.listProviders())
      // Archived is "the user put this away", and a phone must not offer to start a
      // conversation with one. The capability's own `listProviders` filters the same
      // way; this reads the same unfiltered source, so it filters for itself.
      .filter((provider) => !provider.archived)
    const defaultSelection = pickInitialProviderModelSelection(
      providers,
      await this.deps.readDefaultProviderModel(),
    )
    const choices: AgentProviderChoice[] = []
    for (const provider of providers) {
      // A Provider that names no model for any tier cannot start anything, so it is
      // not a choice a phone may make — and it is the same condition that decides
      // whether any tier can be named for it at all.
      const ownTier = pickDefaultProviderModelTier(provider)
      if (!ownTier) continue
      const isDefault = provider.id === defaultSelection?.providerId
      choices.push({
        id: provider.id,
        name: provider.name,
        isDefault,
        // What this Provider would be used at: the configured default tier when this
        // is the Provider that default names, otherwise the Provider's own best one.
        defaultTier: isDefault && defaultSelection ? defaultSelection.modelTier : ownTier,
        models: selectableTierModels(provider),
      })
    }
    return choices
  }

  async listGroups(input: AgentGroupListInput): Promise<Record<string, unknown>> {
    const query = input.query?.toLocaleLowerCase()
    const groups = (await this.listAllGroups()).filter((group) => !query || group.name.toLocaleLowerCase().includes(query))
    const end = input.offset + input.limit
    return {
      groups: groups.slice(input.offset, end),
      nextOffset: end < groups.length ? end : null,
    }
  }

  async listProviders(input: AgentProviderListInput): Promise<Record<string, unknown>> {
    const query = input.query?.toLocaleLowerCase()
    const providers = (await this.deps.listProviders())
      .filter((provider) => !provider.archived && (!input.providerId || provider.id === input.providerId))
      .map((provider) => ({
        providerId: provider.id,
        name: provider.name,
        models: MODEL_TIER_DISPLAY_ORDER
          .filter((tier) => isProviderModelTierSelectable(provider, tier))
          .map((modelTier) => ({
            modelTier,
            modelName: resolveModelName(provider, modelTier) ?? null,
            displayName: resolveModelDisplayName(provider, modelTier),
          })),
      }))
      .filter((provider) => !query || provider.name.toLocaleLowerCase().includes(query)
        || provider.models.some((model) => model.displayName?.toLocaleLowerCase().includes(query)))
    const end = input.offset + input.limit
    return { providers: providers.slice(input.offset, end), nextOffset: end < providers.length ? end : null }
  }

  async create(input: AgentConversationCreateInput, clientId: string): Promise<Record<string, unknown>> {
    return this.runIdempotent(clientId, "create", input.idempotencyKey, input, async () => {
      const groups = await this.listAllGroups()
      const projectId = input.sameGroupAs
        ? (await this.resolveTarget(input.sameGroupAs)).projectId
        : input.projectId
      const matches = input.projectName !== undefined
        ? groups.filter((group) => group.name === input.projectName)
        : groups.filter((group) => group.projectId === (projectId ?? DEFAULT_AGENT_WORKSPACE_PROJECT.id))
      if (matches.length === 0) throw new AgentConversationCapabilityError("group_not_found")
      if (matches.length > 1) throw new AgentConversationCapabilityError("group_ambiguous")
      const group = matches[0]!
      const conversation = await this.deps.createConversation({ projectId: group.projectId, name: input.name, providerId: input.providerId, modelTier: input.modelTier })
      const conversationRef = agentConversationReference(conversation.projectId, conversation.id)
      try {
        this.deps.eventBus.emit({
          domain: "agent",
          type: "conversationUpdated",
          payload: {
            batchId: randomUUID(),
            projectId: conversation.projectId,
            conversationId: conversation.id,
            sessionKey: conversation.sessionKey,
            platform: conversation.platform ?? "local-renderer",
          },
          scope: { sessionId: conversation.id },
          timestamp: conversation.updatedAt,
        })
      } catch (error) {
        this.deps.logger.warn("Created Agent conversation refresh notification failed.", {
          projectId: conversation.projectId,
          conversationId: conversation.id,
          errorType: error instanceof Error ? error.name : typeof error,
        })
      }
      return {
        created: true,
        providerId: conversation.providerId,
        modelTier: conversation.modelTier,
        projectId: conversation.projectId,
        conversationRef,
        deepLink: buildAgentConversationDeepLink({ projectId: conversation.projectId, conversationRef }),
      }
    })
  }

  async inspect(input: ResolvedInput<AgentConversationInspectInput>): Promise<Record<string, unknown>> {
    const conversation = await this.requireConversation(input)
    const source = agentConversationSourceForPlatform(conversation.platform)
    const runtime = this.deps.peekRuntime(input.projectId)
    const state = runtime?.getConversationRuntimeSnapshot(input.conversationId) ?? idleSnapshot()
    const pending = runtime
      ? runtime.listPendingPermissions()
        .filter((item) => item.conversationId === input.conversationId)
        .map(sanitizePendingPermission)
      : []
    const page = buildTimelinePage(conversation, input.beforeIndex, input.limit)
    const result = {
      conversation: {
        projectId: conversation.projectId,
        conversationId: conversation.id,
        conversationRef: agentConversationReference(conversation.projectId, conversation.id),
        source,
        controllable: isControllable(source),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      revision: this.revisionFor(input.projectId, input.conversationId),
      state,
      pending,
      timeline: page,
    }
    if (jsonBytes(result) <= PAGE_BYTE_LIMIT) return result
    const boundedResult = {
      ...result,
      pending: pending.map((item) => ({
        kind: item.kind,
        requestId: item.requestId,
        turnId: item.turnId,
        toolName: item.toolName,
        truncated: true,
      })),
    }
    if (jsonBytes(boundedResult) > PAGE_BYTE_LIMIT) {
      throw new AgentConversationCapabilityError("operation_failed", { reason: "inspection_page_too_large" })
    }
    return boundedResult
  }

  async observe(
    input: ResolvedInput<AgentConversationObserveInput>,
    clientId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    let conversation = await this.requireConversation(input)
    const key = conversationKey(input.projectId, input.conversationId)
    const current = this.revisionFor(input.projectId, input.conversationId)
    if (input.afterRevision > current) {
      throw new AgentConversationCapabilityError("watermark_ahead", { revision: current })
    }
    if (input.afterRevision === current && input.maxWaitMs > 0 && !signal?.aborted) {
      await this.waitForChange(key, clientId, input.afterRevision, input.maxWaitMs, signal)
      conversation = await this.requireConversation(input)
    }
    const revision = this.revisionFor(input.projectId, input.conversationId)
    const runtime = this.deps.peekRuntime(input.projectId)
    return {
      changed: revision > input.afterRevision,
      revision,
      changeTypes: this.changeTypesAfter(key, input.afterRevision),
      historyCount: conversation.history.length,
      state: runtime?.getConversationRuntimeSnapshot(input.conversationId) ?? idleSnapshot(),
    }
  }

  async send(input: ResolvedInput<AgentMessageSendInput>, clientId: string): Promise<Record<string, unknown>> {
    return this.runIdempotent(clientId, "send", input.idempotencyKey, input, async () => {
      const conversation = await this.requireControllableConversation(input)
      const runtime = await this.requireRuntime(input.projectId)
      const turnId = randomUUID()
      const message: AgentMessage = {
        projectId: conversation.projectId,
        sessionKey: conversation.sessionKey,
        platform: conversation.platform ?? "local-renderer",
        messageId: input.idempotencyKey,
        userId: "synapse-mcp",
        userName: "Codex",
        content: input.content.trim(),
        displayContent: input.content.trim(),
        workspaceKey: conversation.workspaceKey,
        workspacePath: conversation.workspacePath,
        providerId: conversation.providerId,
        agentType: conversation.agentType,
        modelTier: conversation.agentConfig?.modelTier,
        replyCtx: {
          kind: "local-renderer",
          projectId: conversation.projectId,
          sessionKey: conversation.sessionKey,
        },
      }
      const admitted = await runtime.submitToConversation(message, conversation.id, { turnId })
      if (!admitted.accepted) {
        throw new AgentConversationCapabilityError(
          admitted.reason === "queue_full" ? "quota_exceeded" : "operation_failed",
        )
      }
      const revision = this.bump(input.projectId, input.conversationId, ["timeline", "state"])
      return {
        accepted: true,
        turnId: admitted.turnId,
        disposition: admitted.disposition,
        queuePosition: admitted.queuePosition,
        revision,
      }
    })
  }

  async steer(input: ResolvedInput<AgentTurnSteerInput>): Promise<Record<string, unknown>> {
    await this.requireControllableConversation(input)
    const runtime = await this.requireRuntime(input.projectId)
    const result = await runtime.steer({
      conversationId: input.conversationId,
      expectedTurnId: input.expectedTurnId,
      clientMessageId: input.clientMessageId,
      content: input.content.trim(),
      submittedAt: new Date(this.now()).toISOString(),
    })
    if (result.status === "accepted") {
      return {
        accepted: true,
        turnId: result.turnId ?? input.expectedTurnId,
        clientMessageId: result.clientMessageId,
        revision: this.bump(input.projectId, input.conversationId, ["timeline", "state"]),
      }
    }
    if (result.status === "no-active-turn") throw new AgentConversationCapabilityError("no_active_turn")
    if (result.status === "turn-changed") {
      throw new AgentConversationCapabilityError("turn_changed", { turnId: result.turnId })
    }
    throw new AgentConversationCapabilityError("operation_failed", { status: result.status })
  }

  async stop(input: ResolvedInput<AgentTurnStopInput>, clientId: string): Promise<Record<string, unknown>> {
    return this.runIdempotent(clientId, "stop", input.idempotencyKey, input, async () => {
      await this.requireControllableConversation(input)
      const runtime = await this.requireRuntime(input.projectId)
      const result = await runtime.cancelExpectedTurn(input.conversationId, input.expectedTurnId)
      this.assertStopResult(result)
      if (result.status !== "graceful-pending") {
        throw new AgentConversationCapabilityError("operation_failed", { status: result.status })
      }
      return {
        stopped: true,
        mode: "graceful",
        turnId: input.expectedTurnId,
        revision: this.bump(input.projectId, input.conversationId, ["state"]),
      }
    })
  }

  async forceStop(input: ResolvedInput<AgentTurnStopInput>, clientId: string): Promise<Record<string, unknown>> {
    return this.runIdempotent(clientId, "force-stop", input.idempotencyKey, input, async () => {
      await this.requireControllableConversation(input)
      const runtime = await this.requireRuntime(input.projectId)
      const result = await runtime.forceKillExpectedTurn(input.conversationId, input.expectedTurnId)
      this.assertStopResult(result)
      if (result.status !== "hard-killed") {
        throw new AgentConversationCapabilityError("operation_failed", { status: result.status })
      }
      return {
        stopped: true,
        mode: "force",
        turnId: input.expectedTurnId,
        revision: this.bump(input.projectId, input.conversationId, ["state"]),
      }
    })
  }

  async respondPermission(
    input: ResolvedInput<AgentPermissionRespondInput>,
    clientId: string,
    actor: DispatchActorIdentity,
  ): Promise<Record<string, unknown>> {
    return this.runIdempotent(clientId, "permission", input.idempotencyKey, input, async () => {
      await this.requireControllableConversation(input)
      const runtime = await this.requireRuntime(input.projectId)
      const snapshot = runtime.getConversationRuntimeSnapshot(input.conversationId)
      if (!snapshot.activeTurnId) throw new AgentConversationCapabilityError("no_active_turn")
      if (snapshot.activeTurnId !== input.expectedTurnId) {
        throw new AgentConversationCapabilityError("turn_changed", { turnId: snapshot.activeTurnId })
      }
      const pending = runtime.listPendingPermissions().find((item) =>
        item.projectId === input.projectId
        && item.conversationId === input.conversationId
        && item.requestId === input.requestId)
      if (!pending) throw new AgentConversationCapabilityError("permission_not_pending")
      if (pending.turnId !== undefined && pending.turnId !== input.expectedTurnId) {
        throw new AgentConversationCapabilityError("turn_changed", { turnId: snapshot.activeTurnId })
      }
      const isQuestion = pending.toolName === "AskUserQuestion"
      if ((input.kind === "user_question") !== isQuestion) {
        throw new AgentConversationCapabilityError("permission_kind_mismatch")
      }
      if (input.kind === "tool_permission" && pending.toolName !== input.expectedToolName) {
        throw new AgentConversationCapabilityError("permission_kind_mismatch")
      }
      const decision = input.kind === "user_question"
        ? buildQuestionDecision(pending, input)
        : input.decision === "deny"
          ? { behavior: "deny" as const }
          : {
              behavior: "allow" as const,
              scope: input.decision === "allow_session" ? "session" as const : "once" as const,
            }
      try {
        await runtime.respondPermission({
          requestId: input.requestId,
          sessionKey: pending.sessionKey,
          actor,
          ...decision,
        })
      } catch (error) {
        this.deps.logger.warn("Agent MCP permission response failed.", {
          projectId: input.projectId,
          conversationId: input.conversationId,
          requestId: input.requestId,
          toolName: pending.toolName,
          errorType: error instanceof Error ? error.name : typeof error,
        })
        if (!runtime.listPendingPermissions().some((item) => item.requestId === input.requestId)) {
          throw new AgentConversationCapabilityError("permission_not_pending")
        }
        throw new AgentConversationCapabilityError("operation_failed")
      }
      return {
        responded: true,
        requestId: input.requestId,
        revision: this.bump(input.projectId, input.conversationId, ["permission", "state", "timeline"]),
      }
    })
  }

  private async requireConversation(input: ConversationTarget): Promise<ConversationEntryV1> {
    const conversation = await this.conversations.get(input.conversationId)
    if (!conversation || conversation.id !== input.conversationId || conversation.projectId !== input.projectId) {
      throw new AgentConversationCapabilityError("not_found")
    }
    return conversation
  }

  private async requireControllableConversation(input: ConversationTarget): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(input)
    if (!isControllable(agentConversationSourceForPlatform(conversation.platform))) {
      throw new AgentConversationCapabilityError("control_not_supported")
    }
    return conversation
  }

  private async requireRuntime(projectId: string): Promise<AgentRuntimeService> {
    try {
      return await this.deps.resolveRuntime(projectId)
    } catch (error) {
      this.deps.logger.warn("Agent MCP project runtime unavailable.", {
        projectId,
        errorType: error instanceof Error ? error.name : typeof error,
      })
      throw new AgentConversationCapabilityError("project_unavailable")
    }
  }

  private assertStopResult(result: { readonly status: string; readonly turnId?: string }): void {
    if (result.status === "no-active-turn") throw new AgentConversationCapabilityError("no_active_turn")
    if (result.status === "turn-changed") {
      throw new AgentConversationCapabilityError("turn_changed", { turnId: result.turnId })
    }
  }

  private onAgentEvent(event: DomainEvent<"agent">): void {
    const payload = recordValue(event.payload)
    const projectId = stringValue(payload?.projectId) ?? event.scope?.projectId
    const conversationId = stringValue(payload?.conversationId) ?? event.scope?.sessionId
    if (!projectId || !conversationId) return
    const types: ChangeType[] = event.type === "conversationUpdated"
      ? ["timeline", "state"]
      : event.type === "eventBatch"
        ? ["timeline", "state", "permission"]
        : ["state"]
    this.bump(projectId, conversationId, types)
  }

  private bump(projectId: string, conversationId: string, types: readonly ChangeType[]): number {
    const key = conversationKey(projectId, conversationId)
    const revision = (this.revisions.get(key) ?? 0) + 1
    this.revisions.set(key, revision)
    const history = [...(this.changes.get(key) ?? []), { revision, types: [...new Set(types)] }]
    this.changes.set(key, history.slice(-CHANGE_HISTORY_LIMIT))
    const group = this.waiters.get(key)
    if (group) {
      for (const waiter of [...group]) {
        if (revision > waiter.afterRevision) waiter.resolve()
      }
    }
    return revision
  }

  private revisionFor(projectId: string, conversationId: string): number {
    return this.revisions.get(conversationKey(projectId, conversationId)) ?? 0
  }

  private changeTypesAfter(key: string, revision: number): readonly ChangeType[] {
    const found = (this.changes.get(key) ?? [])
      .filter((entry) => entry.revision > revision)
      .flatMap((entry) => entry.types)
    return [...new Set(found)]
  }

  private async waitForChange(
    key: string,
    clientId: string,
    afterRevision: number,
    maxWaitMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const group = this.waiters.get(key) ?? new Set<Waiter>()
    const clientCount = this.observersByClient.get(clientId) ?? 0
    const globalCount = [...this.waiters.values()].reduce((sum, entries) => sum + entries.size, 0)
    if (group.size >= MAX_OBSERVERS_PER_CONVERSATION
      || clientCount >= MAX_OBSERVERS_PER_CLIENT
      || globalCount >= MAX_OBSERVERS_GLOBAL) {
      throw new AgentConversationCapabilityError("quota_exceeded")
    }
    await new Promise<void>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const waiter: Waiter = {
        clientId,
        afterRevision,
        resolve: () => finish(),
      }
      const finish = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        signal?.removeEventListener("abort", finish)
        group.delete(waiter)
        if (group.size === 0) this.waiters.delete(key)
        const next = (this.observersByClient.get(clientId) ?? 1) - 1
        if (next <= 0) this.observersByClient.delete(clientId)
        else this.observersByClient.set(clientId, next)
        resolve()
      }
      group.add(waiter)
      this.waiters.set(key, group)
      this.observersByClient.set(clientId, clientCount + 1)
      signal?.addEventListener("abort", finish, { once: true })
      timer = setTimeout(finish, maxWaitMs)
      timer.unref?.()
      if ((this.revisions.get(key) ?? 0) > afterRevision) finish()
    })
  }

  private async runIdempotent<T>(
    clientId: string,
    operation: string,
    key: string,
    input: unknown,
    execute: () => Promise<T>,
  ): Promise<T> {
    this.pruneIdempotency()
    const cacheKey = `${clientId}:${operation}:${key}`
    const fingerprint = JSON.stringify(input)
    const existing = this.idempotency.get(cacheKey)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new AgentConversationCapabilityError("idempotency_conflict")
      }
      return existing.result as Promise<T>
    }
    const result = execute()
    this.idempotency.set(cacheKey, { fingerprint, createdAt: this.now(), result })
    result.catch(() => this.idempotency.delete(cacheKey))
    return result
  }

  private pruneIdempotency(): void {
    const cutoff = this.now() - IDEMPOTENCY_TTL_MS
    for (const [key, entry] of this.idempotency) {
      if (entry.createdAt < cutoff) this.idempotency.delete(key)
    }
    while (this.idempotency.size >= IDEMPOTENCY_ENTRY_LIMIT) {
      const oldest = this.idempotency.keys().next().value as string | undefined
      if (!oldest) break
      this.idempotency.delete(oldest)
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

function buildTimelinePage(
  conversation: ConversationEntryV1,
  requestedEnd: number | undefined,
  requestedLimit: number,
): Record<string, unknown> {
  const total = conversation.history.length
  const end = requestedEnd ?? total
  if (!Number.isInteger(end) || end < 0 || end > total) {
    throw new AgentConversationCapabilityError("invalid_input")
  }
  const { entries, startIndex: start } = boundedTimelinePage({
    endIndex: end,
    limit: requestedLimit,
    maxBytes: TIMELINE_PAGE_BYTE_LIMIT,
    project: (index) => sanitizeTimelineItem(historyRecordToTimelineItem(
      conversation.id, conversation.history[index]!, index, conversation.agentType,
    )),
  })
  return {
    entries,
    total,
    startIndex: start,
    endIndex: end,
    hasMore: start > 0,
    nextBeforeIndex: start > 0 ? start : null,
  }
}

function sanitizeTimelineItem(value: unknown): unknown {
  const constrained = constrainValue(removeInternalFields(redactSensitiveValue(value)), "")
  if (jsonBytes(constrained) <= ITEM_BYTE_LIMIT) return constrained
  const record = recordValue(constrained)
  if (!record) return OMITTED
  const summary = {
    id: record.id,
    timestamp: record.timestamp,
    kind: record.kind,
    role: record.role,
    toolName: record.toolName,
    toolUseId: record.toolUseId,
    truncated: true,
    content: OMITTED,
  }
  return jsonBytes(summary) <= ITEM_BYTE_LIMIT
    ? summary
    : { kind: typeof record.kind === "string" ? truncateUtf8(record.kind, 1_024) : "unknown", truncated: true }
}

function removeInternalFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeInternalFields)
  const record = recordValue(value)
  if (!record) return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    const normalized = key.toLowerCase()
    if (normalized === "sdksessionid"
      || normalized === "agentsessionid"
      || normalized === "threadid"
      || normalized === "usermessageuuid"
      || (normalized.startsWith("sdk") && (normalized.endsWith("id") || normalized.endsWith("uuid")))
      || normalized.endsWith("payload")
      || normalized === "base64"
      || normalized === "dataurl"
      || normalized === "url") continue
    if (typeof child === "string" && isBase64Payload(child)) {
      output[key] = OMITTED
      continue
    }
    output[key] = removeInternalFields(child)
  }
  return output
}

function constrainValue(value: unknown, key: string): unknown {
  if (typeof value === "string") {
    return byteLength(value) <= ITEM_BYTE_LIMIT ? value : truncateUtf8(value, ITEM_BYTE_LIMIT)
  }
  if (Array.isArray(value)) return value.map((entry) => constrainValue(entry, key))
  const record = recordValue(value)
  if (!record) return value
  if (key === "toolInputRaw" && jsonBytes(record) > ITEM_BYTE_LIMIT) return { truncated: true }
  return Object.fromEntries(Object.entries(record).map(([childKey, child]) =>
    [childKey, constrainValue(child, childKey)]))
}

function sanitizePendingPermission(permission: AgentPendingPermission): Record<string, unknown> {
  return sanitizeTimelineItem({
    kind: permission.toolName === "AskUserQuestion" ? "user_question" : "tool_permission",
    requestId: permission.requestId,
    turnId: permission.turnId,
    toolName: permission.toolName,
    toolInput: permission.toolInput,
    toolInputRaw: permission.toolInputRaw,
    questions: permission.questions,
    blockedPath: permission.blockedPath,
    sessionDirectoryGrantAvailable: permission.sessionDirectoryGrantAvailable,
    createdAt: permission.createdAt,
  }) as Record<string, unknown>
}

function buildQuestionDecision(
  pending: AgentPendingPermission,
  input: AgentPermissionRespondInput,
): { readonly behavior: "allow" | "deny"; readonly updatedInput?: Record<string, unknown> } {
  if (input.decision === "skip") return { behavior: "deny" }
  if (input.decision !== "answer") throw new AgentConversationCapabilityError("permission_kind_mismatch")
  const questions = pending.questions ?? []
  const answers = input.answers ?? []
  if (answers.length !== questions.length || new Set(answers.map((item) => item.questionIndex)).size !== answers.length) {
    throw new AgentConversationCapabilityError("invalid_input")
  }
  const answerRecord: Record<string, unknown> = {}
  for (const answer of answers) {
    const question = questions[answer.questionIndex]
    if (!question) throw new AgentConversationCapabilityError("invalid_input")
    validateQuestionAnswer(question, answer.values)
    answerRecord[`question-${answer.questionIndex}`] = answer.values
  }
  return {
    behavior: "allow",
    updatedInput: { questions, answers: answerRecord },
  }
}

function validateQuestionAnswer(question: AgentUserQuestion, values: readonly string[]): void {
  if (!question.multiSelect && values.length !== 1) {
    throw new AgentConversationCapabilityError("invalid_input")
  }
  if (!question.options || question.options.length === 0) return
  const allowed = new Set(question.options.map((option) => option.label))
  if (values.some((value) => !allowed.has(value))) {
    throw new AgentConversationCapabilityError("invalid_input")
  }
}

function idleSnapshot(): AgentConversationRuntimeSnapshot {
  return {
    lifecycle: "idle",
    activeTurnId: null,
    queuedTurns: [],
    pendingPermissionRequestId: null,
  }
}

function isControllable(source: ConversationSource): boolean {
  return source === "user"
}

function conversationKey(projectId: string, conversationId: string): string {
  return `${projectId}\u0000${conversationId}`
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

function jsonBytes(value: unknown): number {
  return byteLength(JSON.stringify(value))
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (byteLength(value.slice(0, middle)) <= maxBytes - Buffer.byteLength(OMITTED)) low = middle
    else high = middle - 1
  }
  return `${value.slice(0, low)}${OMITTED}`
}

function isBase64Payload(value: string): boolean {
  const compact = value.replaceAll(/\s/g, "")
  return /^data:[^,;]+;base64,/i.test(value)
    || (compact.length >= 1_024
      && compact.length % 4 === 0
      && /^[A-Za-z0-9+/]+={0,2}$/.test(compact))
}
