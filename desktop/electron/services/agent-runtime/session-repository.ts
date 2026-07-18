import type {
  AgentUsageEntryV1,
  ConversationEntryV1,
  ConversationMainThreadPersonaSnapshotV1,
  ConversationResumePolicyV1,
  DataNamespace,
} from "../../runtime/data-repo"
import {
  normalizeClaudeSdkUsage,
  sumClaudeSdkUsageSummaries,
  type ClaudeSdkUsageSummary,
} from "../../../src/lib/token-usage"
import type { AgentMessage, AgentUserQuestionResolution } from "./types"

export interface AgentSessionRepositoryOptions {
  readonly projectId: string
  readonly conversations: DataNamespace<ConversationEntryV1>
  readonly agentUsage?: DataNamespace<AgentUsageEntryV1>
  readonly now?: () => Date
  readonly idFactory?: () => string
  readonly logger?: { warn: (message: string, meta?: unknown) => void }
}

export interface CreateAgentSessionInput {
  readonly id?: string
  readonly sessionKey: string
  readonly platform?: string
  readonly channelKey?: string
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly name?: string
  readonly userMeta?: ConversationEntryV1["userMeta"]
  readonly resumePolicy?: ConversationResumePolicyV1
  readonly agentType?: string
  readonly providerId?: string
  readonly mode?: string
  readonly modelTier?: string
  readonly sdkSessionId?: string
  readonly usage?: ConversationEntryV1["usage"]
  readonly costUsd?: number
  readonly costCny?: number
  readonly costCurrency?: "CNY"
}

export interface SaveAgentSessionInput {
  readonly conversationId: string
  readonly agentType: string
  readonly agentSessionId?: string
  readonly resumePolicy?: ConversationResumePolicyV1
  readonly providerId?: string
  readonly sdkSessionId?: string
  readonly usage?: ConversationEntryV1["usage"]
  readonly costUsd?: number
  readonly costCny?: number
  readonly costCurrency?: "CNY"
}

export class AgentSessionRepository {
  private readonly projectId: string
  private readonly conversations: DataNamespace<ConversationEntryV1>
  private readonly agentUsage: DataNamespace<AgentUsageEntryV1> | undefined
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly logger: { warn: (message: string, meta?: unknown) => void } | undefined
  private readonly titleMutationTails = new Map<string, Promise<void>>()

  constructor(options: AgentSessionRepositoryOptions) {
    this.projectId = options.projectId
    this.conversations = options.conversations
    this.agentUsage = options.agentUsage
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => randomId())
    this.logger = options.logger
  }

  async getOrCreateActive(message: AgentMessage): Promise<ConversationEntryV1> {
    const existing = await this.getActive(
      message.sessionKey,
      message.platform,
      message.workspaceKey,
    )
    if (existing) {
      const updated = {
        ...existing,
        platform: message.platform,
        channelKey: message.channelKey ?? existing.channelKey,
        workspaceKey: message.workspaceKey ?? existing.workspaceKey,
        workspacePath: message.workspacePath ?? existing.workspacePath,
        agentType: message.agentType ?? existing.agentType,
        providerId: message.providerId ?? existing.providerId,
        userMeta: mergeUserMeta(existing.userMeta, message),
        updatedAt: this.isoNow(),
      }
      await this.conversations.upsert(updated)
      return updated
    }

    return this.createSession({
      id: conversationId(message.platform, message.sessionKey, "active", message.workspaceKey),
      sessionKey: message.sessionKey,
      platform: message.platform,
      name: message.sessionKey,
      userMeta: mergeUserMeta(undefined, message),
      channelKey: message.channelKey,
      workspaceKey: message.workspaceKey,
      workspacePath: message.workspacePath,
      resumePolicy: "resume",
      agentType: message.agentType,
      providerId: message.providerId,
    })
  }

  async getActive(
    sessionKey: string,
    platform?: string,
    workspaceKey?: string,
  ): Promise<ConversationEntryV1 | null> {
    const candidates = await this.conversations.list({
      projectId: this.projectId,
      sessionKey,
      workspaceKey,
      active: true,
    } as Partial<ConversationEntryV1>)
    const matching = candidates.find((item) => platform === undefined || item.platform === platform)
    return matching ?? null
  }

  async listSessions(): Promise<ConversationEntryV1[]> {
    const sessions = await this.conversations.list({
      projectId: this.projectId,
    } as Partial<ConversationEntryV1>)
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async createSession(input: CreateAgentSessionInput): Promise<ConversationEntryV1> {
    const now = this.isoNow()
    const conversation: ConversationEntryV1 = {
      id: input.id
        ?? conversationId(input.platform ?? "local", input.sessionKey, this.idFactory(), input.workspaceKey),
      schemaVersion: 1,
      projectId: this.projectId,
      sessionKey: input.sessionKey,
      platform: input.platform,
      channelKey: input.channelKey,
      workspaceKey: input.workspaceKey,
      workspacePath: input.workspacePath,
      agentType: input.agentType,
      providerId: input.providerId,
      agentConfig: input.mode || input.modelTier
        ? { ...(input.mode ? { mode: input.mode } : {}), ...(input.modelTier ? { modelTier: input.modelTier } : {}) }
        : undefined,
      sdkSessionId: input.sdkSessionId,
      usage: input.usage,
      costUsd: input.costUsd,
      costCny: input.costCny,
      costCurrency: input.costCurrency,
      history: [],
      userMeta: input.userMeta,
      active: true,
      name: input.name ?? input.sessionKey,
      titleSource: initialConversationTitleSource(input.name ?? input.sessionKey),
      resumePolicy: input.resumePolicy ?? "resume",
      createdAt: now,
      updatedAt: now,
    }
    const previous = await this.conversations.get(conversation.id)
    await this.conversations.upsert({ ...conversation, active: false })
    try {
      await this.deactivateActive(input.sessionKey, input.platform, conversation.id, input.workspaceKey)
      await this.activateCreatedSession(conversation)
    } catch (error) {
      await this.restoreFailedCreatedSession(conversation, previous)
      throw error
    }
    return conversation
  }

  private async activateCreatedSession(conversation: ConversationEntryV1): Promise<void> {
    try {
      await this.conversations.upsert(conversation)
    } catch (error) {
      this.logger?.warn("Failed to activate newly created Agent session. Retrying once.", {
        error,
        conversationId: conversation.id,
        projectId: conversation.projectId,
        sessionKey: conversation.sessionKey,
        platform: conversation.platform,
        workspaceKey: conversation.workspaceKey,
      })
      await this.conversations.upsert(conversation)
    }
  }

  private async restoreFailedCreatedSession(
    conversation: ConversationEntryV1,
    previous: ConversationEntryV1 | null,
  ): Promise<void> {
    try {
      if (previous) {
        await this.conversations.upsert(previous)
      } else {
        await this.conversations.remove(conversation.id)
      }
    } catch (cleanupError) {
      this.logger?.warn("Failed to clean up inactive Agent session placeholder after creation failure.", {
        error: cleanupError,
        conversationId: conversation.id,
        projectId: conversation.projectId,
        sessionKey: conversation.sessionKey,
        platform: conversation.platform,
        workspaceKey: conversation.workspaceKey,
      })
    }
  }

  async createSideSession(input: CreateAgentSessionInput): Promise<ConversationEntryV1> {
    const now = this.isoNow()
    const conversation: ConversationEntryV1 = {
      id: input.id
        ?? conversationId(input.platform ?? "local", input.sessionKey, this.idFactory(), input.workspaceKey),
      schemaVersion: 1,
      projectId: this.projectId,
      sessionKey: input.sessionKey,
      platform: input.platform,
      channelKey: input.channelKey,
      workspaceKey: input.workspaceKey,
      workspacePath: input.workspacePath,
      agentType: input.agentType,
      providerId: input.providerId,
      agentConfig: input.mode || input.modelTier
        ? { ...(input.mode ? { mode: input.mode } : {}), ...(input.modelTier ? { modelTier: input.modelTier } : {}) }
        : undefined,
      sdkSessionId: input.sdkSessionId,
      usage: input.usage,
      costUsd: input.costUsd,
      costCny: input.costCny,
      costCurrency: input.costCurrency,
      history: [],
      userMeta: input.userMeta,
      active: false,
      name: input.name ?? input.sessionKey,
      titleSource: initialConversationTitleSource(input.name ?? input.sessionKey),
      resumePolicy: input.resumePolicy ?? "fresh",
      createdAt: now,
      updatedAt: now,
    }
    await this.conversations.upsert(conversation)
    return conversation
  }

  async setActiveSession(
    sessionKey: string,
    conversationIdValue: string,
    platform?: string,
    workspaceKey?: string,
  ): Promise<ConversationEntryV1> {
    const target = await this.conversations.get(conversationIdValue)
    if (!target || target.projectId !== this.projectId || target.sessionKey !== sessionKey) {
      throw new Error(`Conversation "${conversationIdValue}" is not available for this session key`)
    }
    const effectivePlatform = platform ?? target.platform
    const effectiveWorkspaceKey = workspaceKey ?? target.workspaceKey
    const previouslyActive = (await this.conversations.list({
      projectId: this.projectId,
      sessionKey,
      workspaceKey: effectiveWorkspaceKey,
      active: true,
    } as Partial<ConversationEntryV1>)).filter((conversation) =>
      effectivePlatform === undefined || conversation.platform === effectivePlatform)
    const updated = { ...target, active: true, updatedAt: this.isoNow() }
    await this.conversations.upsert(updated)
    try {
      await this.deactivateActive(
        sessionKey,
        effectivePlatform,
        conversationIdValue,
        effectiveWorkspaceKey,
      )
    } catch (e) {
      await this.restoreActiveSessionRollback(target, previouslyActive, e)
      throw e
    }
    return updated
  }

  async appendHistory(
    conversationIdValue: string,
    role: ConversationEntryV1["history"][number]["role"],
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(conversationIdValue)
    const entry: ConversationEntryV1["history"][number] = {
      role,
      content,
      timestamp: this.isoNow(),
      ...(metadata ? { metadata } : {}),
    }
    const updated = {
      ...conversation,
      history: [...conversation.history, entry],
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
  }

  async mergeLastHistoryMetadata(
    conversationIdValue: string,
    role: ConversationEntryV1["history"][number]["role"],
    metadata: Record<string, unknown> | undefined,
  ): Promise<ConversationEntryV1 | null> {
    if (!metadata || Object.keys(metadata).length === 0) return null
    const conversation = await this.requireConversation(conversationIdValue)
    const historyIndex = findLastHistoryIndex(conversation.history, role)
    if (historyIndex === -1) return null
    const history = conversation.history.map((entry, index) =>
      index === historyIndex
        ? { ...entry, metadata: { ...(entry.metadata ?? {}), ...metadata } }
        : entry)
    const updated = {
      ...conversation,
      history,
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
  }

  async resolveUserQuestion(
    conversationIdValue: string,
    requestId: string,
    resolution: AgentUserQuestionResolution,
  ): Promise<ConversationEntryV1 | null> {
    const conversation = await this.requireConversation(conversationIdValue)
    const historyIndex = findPermissionRequestHistoryIndex(conversation.history, requestId)
    if (historyIndex === -1) return null
    const current = conversation.history[historyIndex]
    if (current?.metadata?.userQuestionResolution) return null
    const history = conversation.history.map((entry, index) =>
      index === historyIndex ? resolvedUserQuestionHistoryEntry(entry, resolution) : entry)
    const updated = {
      ...conversation,
      history,
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
  }

  async prepareUserQuestionResolution(
    conversationIdValue: string,
    requestId: string,
    resolution: AgentUserQuestionResolution,
  ): Promise<ConversationEntryV1 | null> {
    const conversation = await this.requireConversation(conversationIdValue)
    const historyIndex = findPermissionRequestHistoryIndex(conversation.history, requestId)
    if (historyIndex === -1) return null
    const current = conversation.history[historyIndex]
    if (current?.metadata?.userQuestionResolution) return null
    const history = conversation.history.map((entry, index) =>
      index === historyIndex
        ? {
            ...entry,
            metadata: {
              ...(entry.metadata ?? {}),
              userQuestionResolutionAttempt: resolution,
            },
          }
        : entry)
    const updated = {
      ...conversation,
      history,
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
  }

  async saveAgentSession(input: SaveAgentSessionInput): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(input.conversationId)
    const updated = applyAgentSession(conversation, {
      agentType: input.agentType,
      agentSessionId: input.agentSessionId,
      resumePolicy: input.resumePolicy,
      providerId: input.providerId,
      sdkSessionId: input.sdkSessionId,
      usage: input.usage,
      costUsd: input.costUsd,
      costCny: input.costCny,
      costCurrency: input.costCurrency,
      updatedAt: this.isoNow(),
    })
    await this.conversations.upsert(updated)
    return updated
  }

  async saveSdkSession(input: {
    readonly conversationId: string
    readonly sdkSessionId: string
  }): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(input.conversationId)
    const updated: ConversationEntryV1 = {
      ...conversation,
      sdkSessionId: input.sdkSessionId,
      agentSessionId: input.sdkSessionId,
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
  }

  async saveUsage(input: {
    readonly conversationId: string
    readonly usage?: ConversationEntryV1["usage"]
    readonly costUsd?: number
    readonly costCny?: number
    readonly costCurrency?: "CNY"
  }): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(input.conversationId)
    const updated: ConversationEntryV1 = {
      ...conversation,
      usage: input.usage ?? conversation.usage,
      costUsd: input.costUsd ?? conversation.costUsd,
      costCny: input.costCny ?? conversation.costCny,
      costCurrency: input.costCurrency ?? conversation.costCurrency,
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
  }

  async recordSdkResultUsage(input: {
    readonly conversationId: string
    readonly turnId: string
    readonly sdkResultUuid?: string
    readonly sdkSessionId?: string
    readonly usage?: Record<string, unknown>
    readonly usageSummary?: ClaudeSdkUsageSummary
    readonly modelUsage?: Record<string, unknown>
    readonly userMeta?: ConversationEntryV1["userMeta"]
  }): Promise<AgentUsageEntryV1 | undefined> {
    if (!this.agentUsage) return undefined
    const summary = input.usageSummary ?? normalizeClaudeSdkUsage(input.usage)
    if (!input.usage || !summary) return undefined
    const conversation = await this.requireConversation(input.conversationId)
    const source = usageSourceFields(input.userMeta ?? conversation.userMeta)
    const row: AgentUsageEntryV1 = {
      id: input.sdkResultUuid ?? `${input.conversationId}:${input.turnId}`,
      schemaVersion: 1,
      projectId: this.projectId,
      conversationId: input.conversationId,
      turnId: input.turnId,
      sdkResultUuid: input.sdkResultUuid,
      sdkSessionId: input.sdkSessionId ?? conversation.sdkSessionId,
      ...source,
      usage: input.usage,
      usageSummary: {
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        cacheReadInputTokens: summary.cacheReadInputTokens,
        cacheCreationInputTokens: summary.cacheCreationInputTokens,
        ...(summary.reasoningOutputTokens === undefined ? {} : {
          reasoningOutputTokens: summary.reasoningOutputTokens,
        }),
        totalTokens: summary.totalTokens,
      },
      modelUsage: input.modelUsage,
      createdAt: this.isoNow(),
    }
    await this.agentUsage.upsert(row)
    return row
  }

  async getUsageSummary(conversationIdValue: string): Promise<ClaudeSdkUsageSummary | undefined> {
    return this.getUsageSummaryByFilter({ conversationId: conversationIdValue })
  }

  async getTaskRunUsageSummary(taskRunId: string): Promise<ClaudeSdkUsageSummary | undefined> {
    return this.getUsageSummaryByFilter({ taskRunId })
  }

  async getWorkflowRunUsageSummary(workflowRunId: string): Promise<ClaudeSdkUsageSummary | undefined> {
    return this.getUsageSummaryByFilter({ workflowRunId })
  }

  private async getUsageSummaryByFilter(
    filter: Partial<AgentUsageEntryV1>,
  ): Promise<ClaudeSdkUsageSummary | undefined> {
    if (!this.agentUsage) return undefined
    const rows = await this.agentUsage.list({
      projectId: this.projectId,
      ...filter,
    } as Partial<AgentUsageEntryV1>)
    const unique = new Map<string, AgentUsageEntryV1>()
    for (const row of rows) {
      unique.set(row.sdkResultUuid ?? row.id, row)
    }
    return sumClaudeSdkUsageSummaries([...unique.values()].map((row) => row.usageSummary))
  }

  async savePermissionMode(
    conversationIdValue: string,
    mode: string,
  ): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(conversationIdValue)
    const updated: ConversationEntryV1 = {
      ...conversation,
      agentConfig: {
        ...(conversation.agentConfig ?? {}),
        mode,
      },
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
  }

  async saveMainThreadPersona(
    conversationIdValue: string,
    snapshot: ConversationMainThreadPersonaSnapshotV1 | null,
  ): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(conversationIdValue)
    const nextAgentConfig = {
      ...(conversation.agentConfig ?? {}),
      activeMainThreadPersonaId: snapshot?.id ?? null,
      ...(snapshot ? { activeMainThreadPersonaSnapshot: snapshot } : {}),
    }
    if (!snapshot) {
      delete nextAgentConfig.activeMainThreadPersonaSnapshot
    }
    const updated: ConversationEntryV1 = {
      ...conversation,
      agentConfig: nextAgentConfig,
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
  }

  async clearCurrentAgentSessionId(
    conversationIdValue: string,
    agentType?: string,
  ): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(conversationIdValue)
    const updated = {
      ...applyAgentSession(conversation, {
        agentType: agentType ?? conversation.agentType,
        agentSessionId: undefined,
        updatedAt: this.isoNow(),
      }),
      sdkSessionId: undefined,
    }
    await this.conversations.upsert(updated)
    return updated
  }

  async updateUserMeta(
    conversationIdValue: string,
    userMeta: ConversationEntryV1["userMeta"],
  ): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(conversationIdValue)
    const updated = {
      ...conversation,
      userMeta: {
        ...(conversation.userMeta ?? {}),
        ...(userMeta ?? {}),
      },
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
  }

  async get(conversationIdValue: string): Promise<ConversationEntryV1 | null> {
    const conversation = await this.conversations.get(conversationIdValue)
    if (!conversation || conversation.projectId !== this.projectId) return null
    return conversation
  }

  async deleteSession(conversationIdValue: string): Promise<void> {
    const conversation = await this.requireConversation(conversationIdValue)
    await this.conversations.remove(conversation.id)
  }

  async renameSession(conversationIdValue: string, name: string): Promise<ConversationEntryV1> {
    return this.runTitleMutation(conversationIdValue, async () => {
      const conversation = await this.requireConversation(conversationIdValue)
      const updated: ConversationEntryV1 = {
        ...conversation,
        name,
        titleSource: "manual",
        updatedAt: this.isoNow(),
      }
      await this.conversations.upsert(updated)
      return updated
    })
  }

  async renameSessionFromGeneratedTitle(
    conversationIdValue: string,
    name: string,
  ): Promise<ConversationEntryV1 | null> {
    return this.runTitleMutation(conversationIdValue, async () => {
      const conversation = await this.requireConversation(conversationIdValue)
      const normalizedName = name.trim()
      if (
        !normalizedName
        || normalizedName === conversation.name
        || !canReplaceWithGeneratedTitle(conversation)
      ) return null
      const updated: ConversationEntryV1 = {
        ...conversation,
        name: normalizedName,
        titleSource: "generated",
        updatedAt: this.isoNow(),
      }
      await this.conversations.upsert(updated)
      return updated
    })
  }

  async renameSessionFromFirstUserMessage(
    conversationIdValue: string,
  ): Promise<ConversationEntryV1 | null> {
    return this.runTitleMutation(conversationIdValue, async () => {
      const conversation = await this.requireConversation(conversationIdValue)
      if (!canReplaceWithFallbackTitle(conversation)) return null
      const name = firstUserMessageTitle(conversation)
      if (!name) return null
      const updated: ConversationEntryV1 = {
        ...conversation,
        name,
        titleSource: "fallback",
        updatedAt: this.isoNow(),
      }
      await this.conversations.upsert(updated)
      return updated
    })
  }

  private async runTitleMutation<T>(
    conversationIdValue: string,
    mutation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.titleMutationTails.get(conversationIdValue) ?? Promise.resolve()
    const current = previous.then(mutation)
    const tail = current.then(() => undefined, () => undefined)
    this.titleMutationTails.set(conversationIdValue, tail)
    try {
      return await current
    } finally {
      if (this.titleMutationTails.get(conversationIdValue) === tail) {
        this.titleMutationTails.delete(conversationIdValue)
      }
    }
  }

  private async requireConversation(conversationIdValue: string): Promise<ConversationEntryV1> {
    const conversation = await this.get(conversationIdValue)
    if (!conversation) {
      throw new Error(`Conversation "${conversationIdValue}" was not found`)
    }
    return conversation
  }

  private async deactivateActive(
    sessionKey: string,
    platform?: string,
    exceptId?: string,
    workspaceKey?: string,
  ): Promise<void> {
    const active = await this.conversations.list({
      projectId: this.projectId,
      sessionKey,
      workspaceKey,
      active: true,
    } as Partial<ConversationEntryV1>)
    for (const conversation of active) {
      if (conversation.id === exceptId) continue
      if (platform !== undefined && conversation.platform !== platform) continue
      await this.conversations.upsert({
        ...conversation,
        active: false,
        updatedAt: this.isoNow(),
      })
    }
  }

  private async restoreActiveSessionRollback(
    target: ConversationEntryV1,
    previouslyActive: readonly ConversationEntryV1[],
    cause: unknown,
  ): Promise<void> {
    const updatedAt = this.isoNow()
    const restoreTargets = [
      target,
      ...previouslyActive.filter((conversation) => conversation.id !== target.id),
    ]
    for (const conversation of restoreTargets) {
      try {
        await this.conversations.upsert({
          ...conversation,
          active: conversation.id === target.id ? target.active : true,
          updatedAt,
        })
      } catch (rollbackError) {
        this.logger?.warn("Failed to rollback Agent active session state.", {
          conversationId: conversation.id,
          sessionKey: conversation.sessionKey,
          platform: conversation.platform,
          workspaceKey: conversation.workspaceKey,
          causeName: cause instanceof Error ? cause.name : typeof cause,
          rollbackErrorName: rollbackError instanceof Error ? rollbackError.name : typeof rollbackError,
        })
      }
    }
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

const AUTOMATIC_CONVERSATION_NAME_PATTERN = /^(?:新会话|新对话)(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?$/i
const FALLBACK_CONVERSATION_TITLE_MAX_LENGTH = 50

function isAutomaticConversationName(name: string | undefined): boolean {
  return typeof name === "string" && AUTOMATIC_CONVERSATION_NAME_PATTERN.test(name.trim())
}

function initialConversationTitleSource(name: string): "automatic" | "manual" {
  return isAutomaticConversationName(name) ? "automatic" : "manual"
}

function canReplaceWithFallbackTitle(conversation: ConversationEntryV1): boolean {
  if (conversation.titleSource !== undefined) return conversation.titleSource === "automatic"
  return isAutomaticConversationName(conversation.name)
}

function canReplaceWithGeneratedTitle(conversation: ConversationEntryV1): boolean {
  if (conversation.titleSource !== undefined) {
    return conversation.titleSource === "automatic" || conversation.titleSource === "fallback"
  }
  return isAutomaticConversationName(conversation.name)
    || conversation.name === firstUserMessageTitle(conversation)
}

function firstUserMessageTitle(conversation: ConversationEntryV1): string | undefined {
  const content = conversation.history.find((entry) => entry.role === "user")?.content
  if (!content) return undefined
  const normalized = content.replace(/\s+/g, " ").trim()
  if (!normalized) return undefined
  const characters = Array.from(normalized)
  if (characters.length <= FALLBACK_CONVERSATION_TITLE_MAX_LENGTH) return normalized
  return `${characters.slice(0, FALLBACK_CONVERSATION_TITLE_MAX_LENGTH - 1).join("")}…`
}

export function conversationId(
  platform: string,
  sessionKey: string,
  nonce = "default",
  workspaceKey?: string,
): string {
  const key = Buffer.from(`${platform}:${workspaceKey ?? ""}:${sessionKey}:${nonce}`).toString("base64url")
  return `agent-runtime:${key}`
}

function applyAgentSession(
  conversation: ConversationEntryV1,
  input: {
    readonly agentType?: string
    readonly agentSessionId?: string
    readonly resumePolicy?: ConversationResumePolicyV1
    readonly providerId?: string
    readonly sdkSessionId?: string
    readonly usage?: ConversationEntryV1["usage"]
    readonly costUsd?: number
    readonly costCny?: number
    readonly costCurrency?: "CNY"
    readonly updatedAt: string
  },
): ConversationEntryV1 {
  const previous = conversation.agentSessionId
  const next = input.agentSessionId
  return {
    ...conversation,
    agentType: input.agentType ?? conversation.agentType,
    agentSessionId: next,
    providerId: input.providerId ?? conversation.providerId,
    sdkSessionId: input.sdkSessionId ?? conversation.sdkSessionId,
    usage: input.usage ?? conversation.usage,
    costUsd: input.costUsd ?? conversation.costUsd,
    costCny: input.costCny ?? conversation.costCny,
    costCurrency: input.costCurrency ?? conversation.costCurrency,
    pastAgentSessionIds: pastAgentSessionIds(conversation.pastAgentSessionIds, previous, next),
    resumePolicy: input.resumePolicy ?? conversation.resumePolicy ?? "resume",
    updatedAt: input.updatedAt,
  }
}

function mergeUserMeta(
  current: ConversationEntryV1["userMeta"] | undefined,
  message: AgentMessage,
): ConversationEntryV1["userMeta"] {
  return {
    ...(current ?? {}),
    userId: message.userId ?? current?.userId,
    userName: message.userName ?? current?.userName,
    chatName: message.chatName ?? current?.chatName,
    platform: message.platform,
    channelKey: message.channelKey ?? current?.channelKey,
    workspaceKey: message.workspaceKey ?? current?.workspaceKey,
    workspacePath: message.workspacePath ?? current?.workspacePath,
  }
}

function pastAgentSessionIds(
  current: string[] | undefined,
  previous: string | undefined,
  next: string | undefined,
): string[] | undefined {
  if (!previous || previous === next) return current
  const values = current ? [...current] : []
  if (!values.includes(previous)) values.push(previous)
  return values.length > 0 ? values : undefined
}

function findLastHistoryIndex(
  history: readonly ConversationEntryV1["history"][number][],
  role: ConversationEntryV1["history"][number]["role"],
): number {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === role) return index
  }
  return -1
}

function findPermissionRequestHistoryIndex(
  history: readonly ConversationEntryV1["history"][number][],
  requestId: string,
): number {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const metadata = history[index]?.metadata
    if (metadata?.agentEventType === "permissionRequest" && metadata.requestId === requestId) {
      return index
    }
  }
  return -1
}

function resolvedUserQuestionHistoryEntry(
  entry: ConversationEntryV1["history"][number],
  resolution: AgentUserQuestionResolution,
): ConversationEntryV1["history"][number] {
  const metadata = { ...(entry.metadata ?? {}) }
  delete metadata.userQuestionResolutionAttempt
  return {
    ...entry,
    metadata: {
      ...metadata,
      userQuestionResolution: resolution,
    },
  }
}

function usageSourceFields(
  userMeta: ConversationEntryV1["userMeta"] | undefined,
): Pick<
  AgentUsageEntryV1,
  "source" | "taskId" | "taskRunId" | "workflowId" | "workflowRunId" | "workflowNodeId" | "workflowNodeName"
> {
  return {
    source: stringField(userMeta?.source),
    taskId: stringField(userMeta?.taskId),
    taskRunId: stringField(userMeta?.taskRunId),
    workflowId: stringField(userMeta?.workflowId),
    workflowRunId: stringField(userMeta?.workflowRunId),
    workflowNodeId: stringField(userMeta?.workflowNodeId),
    workflowNodeName: stringField(userMeta?.workflowNodeName),
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
