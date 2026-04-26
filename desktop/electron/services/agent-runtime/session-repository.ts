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
  readonly name?: string
  readonly userMeta?: ConversationEntryV1["userMeta"]
  readonly resumePolicy?: ConversationResumePolicyV1
}

export interface SaveAgentSessionInput {
  readonly conversationId: string
  readonly agentType: string
  readonly agentSessionId?: string
  readonly resumePolicy?: ConversationResumePolicyV1
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
    const existing = await this.getActive(message.sessionKey, message.platform)
    if (existing) {
      const updated = {
        ...existing,
        platform: message.platform,
        userMeta: mergeUserMeta(existing.userMeta, message),
        updatedAt: this.isoNow(),
      }
      await this.conversations.upsert(updated)
      return updated
    }

    return this.createSession({
      id: conversationId(message.platform, message.sessionKey, "active"),
      sessionKey: message.sessionKey,
      platform: message.platform,
      name: message.sessionKey,
      userMeta: mergeUserMeta(undefined, message),
      resumePolicy: "resume",
    })
  }

  async getActive(
    sessionKey: string,
    platform?: string,
  ): Promise<ConversationEntryV1 | null> {
    const candidates = await this.conversations.list({
      projectId: this.projectId,
      sessionKey,
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
    await this.deactivateActive(input.sessionKey, input.platform)
    const now = this.isoNow()
    const conversation: ConversationEntryV1 = {
      id: input.id ?? conversationId(input.platform ?? "local", input.sessionKey, this.idFactory()),
      schemaVersion: 1,
      projectId: this.projectId,
      sessionKey: input.sessionKey,
      platform: input.platform,
      history: [],
      userMeta: input.userMeta,
      active: true,
      name: input.name ?? input.sessionKey,
      resumePolicy: input.resumePolicy ?? "resume",
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
  ): Promise<ConversationEntryV1> {
    const target = await this.conversations.get(conversationIdValue)
    if (!target || target.projectId !== this.projectId || target.sessionKey !== sessionKey) {
      throw new Error(`Conversation "${conversationIdValue}" is not available for this session key`)
    }
    await this.deactivateActive(sessionKey, platform ?? target.platform, conversationIdValue)
    const updated = { ...target, active: true, updatedAt: this.isoNow() }
    await this.conversations.upsert(updated)
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
      updatedAt: this.isoNow(),
    })
    await this.conversations.upsert(updated)
    return updated
  }

  async clearCurrentAgentSessionId(
    conversationIdValue: string,
    agentType?: string,
  ): Promise<ConversationEntryV1> {
    const conversation = await this.requireConversation(conversationIdValue)
    const updated = applyAgentSession(conversation, {
      agentType: agentType ?? conversation.agentType,
      agentSessionId: undefined,
      updatedAt: this.isoNow(),
    })
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
  ): Promise<void> {
    const active = await this.conversations.list({
      projectId: this.projectId,
      sessionKey,
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
): string {
  const key = Buffer.from(`${platform}:${sessionKey}:${nonce}`).toString("base64url")
  return `agent-runtime:${key}`
}

function applyAgentSession(
  conversation: ConversationEntryV1,
  input: {
    readonly agentType?: string
    readonly agentSessionId?: string
    readonly resumePolicy?: ConversationResumePolicyV1
    readonly updatedAt: string
  },
): ConversationEntryV1 {
  const previous = conversation.agentSessionId
  const next = input.agentSessionId
  return {
    ...conversation,
    agentType: input.agentType ?? conversation.agentType,
    agentSessionId: next,
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
