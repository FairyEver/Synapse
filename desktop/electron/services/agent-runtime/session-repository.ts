import type {
  ConversationEntryV1,
  ConversationResumePolicyV1,
  DataNamespace,
} from "../../runtime/data-repo"
import type { AgentMessage } from "./types"

export interface AgentSessionRepositoryOptions {
  readonly projectId: string
  readonly conversations: DataNamespace<ConversationEntryV1>
  readonly now?: () => Date
  readonly idFactory?: () => string
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
}

export class AgentSessionRepository {
  private readonly projectId: string
  private readonly conversations: DataNamespace<ConversationEntryV1>
  private readonly now: () => Date
  private readonly idFactory: () => string

  constructor(options: AgentSessionRepositoryOptions) {
    this.projectId = options.projectId
    this.conversations = options.conversations
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => randomId())
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
      ?? candidates[0]
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
      history: [],
      userMeta: input.userMeta,
      active: true,
      name: input.name ?? input.sessionKey,
      resumePolicy: input.resumePolicy ?? "resume",
      createdAt: now,
      updatedAt: now,
    }
    await this.conversations.upsert(conversation)
    await this.deactivateActive(input.sessionKey, input.platform, conversation.id, input.workspaceKey)
    return conversation
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
      history: [],
      userMeta: input.userMeta,
      active: false,
      name: input.name ?? input.sessionKey,
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
    const updated = { ...target, active: true, updatedAt: this.isoNow() }
    await this.conversations.upsert(updated)
    await this.deactivateActive(
      sessionKey,
      platform ?? target.platform,
      conversationIdValue,
      workspaceKey ?? target.workspaceKey,
    )
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
  }): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(input.conversationId)
    const updated: ConversationEntryV1 = {
      ...conversation,
      usage: input.usage ?? conversation.usage,
      costUsd: input.costUsd ?? conversation.costUsd,
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
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
    const conversation = await this.requireConversation(conversationIdValue)
    const updated: ConversationEntryV1 = {
      ...conversation,
      name,
      updatedAt: this.isoNow(),
    }
    await this.conversations.upsert(updated)
    return updated
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

  private isoNow(): string {
    return this.now().toISOString()
  }
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

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
