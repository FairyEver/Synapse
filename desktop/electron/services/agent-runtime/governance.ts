import type { AgentMessage } from "./types"

export interface AgentGovernanceDecision {
  readonly allowed: boolean
  readonly code?: string
  readonly reason?: string
}

export interface RateLimitConfig {
  readonly maxMessages: number
  readonly windowMs: number
}

export interface RolePolicyInput {
  readonly name: string
  readonly userIds: readonly string[]
  readonly disabledCommands?: readonly string[]
  readonly rateLimit?: RateLimitConfig
}

export interface AgentGovernanceConfig {
  readonly disabledCommands?: readonly string[]
  readonly adminUserIds?: readonly string[] | "*"
  readonly privilegedCommands?: readonly string[]
  readonly bannedWords?: readonly string[]
  readonly allowlist?: {
    readonly mode: "all" | "users"
    readonly userIds?: readonly string[]
  }
  readonly groupMention?: {
    readonly required: boolean
    readonly botIds?: readonly string[]
    readonly botNames?: readonly string[]
  }
  readonly rateLimit?: RateLimitConfig
  readonly defaultRole?: string
  readonly roles?: readonly RolePolicyInput[]
  readonly dedupe?: {
    readonly ttlMs: number
    readonly ignoreBefore?: string
  }
  readonly outgoingRateLimit?: {
    readonly default?: TokenBucketConfig
    readonly platforms?: Record<string, TokenBucketConfig>
  }
}

export interface TokenBucketConfig {
  readonly maxPerSecond: number
  readonly burst?: number
}

const DEFAULT_PRIVILEGED_COMMANDS = new Set([
  "shell",
  "show",
  "dir",
  "restart",
  "upgrade",
  "web",
  "diff",
])

export class AgentGovernanceService {
  private readonly config: AgentGovernanceConfig
  private readonly globalRateLimiter: SlidingWindowRateLimiter | null
  private readonly roleManager: RolePolicyManager
  private readonly dedupe: MessageDedupe
  private readonly outgoing: OutgoingTokenBucketLimiter

  constructor(config: AgentGovernanceConfig = {}) {
    this.config = config
    this.globalRateLimiter = config.rateLimit
      ? new SlidingWindowRateLimiter(config.rateLimit)
      : null
    this.roleManager = new RolePolicyManager(config.defaultRole, config.roles ?? [])
    this.dedupe = new MessageDedupe(
      config.dedupe?.ttlMs ?? 60_000,
      config.dedupe?.ignoreBefore,
    )
    this.outgoing = new OutgoingTokenBucketLimiter(config.outgoingRateLimit)
  }

  evaluateMessage(message: AgentMessage): AgentGovernanceDecision {
    const allowlist = this.checkAllowlist(message)
    if (!allowlist.allowed) return allowlist

    const groupMention = this.checkGroupMention(message)
    if (!groupMention.allowed) return groupMention

    const dedupe = this.checkDedupe(message)
    if (!dedupe.allowed) return dedupe

    const command = slashCommand(message.content)
    const role = this.roleManager.resolve(message.userId)
    const disabledCommands = role?.disabledCommands ?? normalizeCommands(this.config.disabledCommands)
    if (command && disabledCommands.has(command)) {
      return blocked("disabled-command", `Command "${command}" is disabled`)
    }

    const privileged = new Set([
      ...DEFAULT_PRIVILEGED_COMMANDS,
      ...normalizeCommands(this.config.privilegedCommands),
    ])
    if (command && privileged.has(command) && !this.isAdmin(message.userId)) {
      return blocked("admin-required", `Command "${command}" requires an admin`)
    }

    if (!command) {
      const banned = this.matchBannedWord(message.content)
      if (banned) return blocked("banned-word", `Message contains banned word "${banned}"`)
    }

    const rate = this.checkRateLimit(message)
    if (!rate.allowed) return rate

    return { allowed: true }
  }

  allowOutgoing(platform: string): boolean {
    return this.outgoing.allow(platform)
  }

  private checkAllowlist(message: AgentMessage): AgentGovernanceDecision {
    const allowlist = this.config.allowlist
    if (!allowlist || allowlist.mode === "all") return { allowed: true }
    if (!message.userId) return blocked("allowlist", "User is not allowlisted")
    const allowed = new Set((allowlist.userIds ?? []).map((id) => id.toLowerCase()))
    return allowed.has(message.userId.toLowerCase())
      ? { allowed: true }
      : blocked("allowlist", "User is not allowlisted")
  }

  private checkGroupMention(message: AgentMessage): AgentGovernanceDecision {
    const mention = this.config.groupMention
    if (!mention?.required || message.chatType !== "group") return { allowed: true }
    const mentions = new Set((message.mentions ?? []).map((item) => item.toLowerCase()))
    for (const id of mention.botIds ?? []) {
      if (mentions.has(id.toLowerCase())) return { allowed: true }
    }
    const lowerContent = message.content.toLowerCase()
    for (const name of mention.botNames ?? []) {
      if (lowerContent.includes(`@${name.toLowerCase()}`)) return { allowed: true }
    }
    return blocked("mention-required", "Group message does not mention the bot")
  }

  private checkDedupe(message: AgentMessage): AgentGovernanceDecision {
    if (message.createdAt && this.dedupe.isOld(message.createdAt)) {
      return blocked("old-message", "Message is older than the connector start boundary")
    }
    if (message.messageId && this.dedupe.isDuplicate(message.messageId)) {
      return blocked("duplicate-message", "Message was already processed")
    }
    return { allowed: true }
  }

  private checkRateLimit(message: AgentMessage): AgentGovernanceDecision {
    const roleRate = this.roleManager.allowRate(message.userId, message.sessionKey)
    if (roleRate.handled) {
      return roleRate.allowed ? { allowed: true } : blocked("rate-limit", "Role rate limit exceeded")
    }
    if (!this.globalRateLimiter) return { allowed: true }
    const key = message.userId ?? message.sessionKey
    return this.globalRateLimiter.allow(key)
      ? { allowed: true }
      : blocked("rate-limit", "Global rate limit exceeded")
  }

  private isAdmin(userId: string | undefined): boolean {
    const admins = this.config.adminUserIds
    if (!admins || !userId) return false
    if (admins === "*") return true
    return admins.some((id) => id.toLowerCase() === userId.toLowerCase())
  }

  private matchBannedWord(content: string): string | undefined {
    const lower = content.toLowerCase()
    return this.config.bannedWords
      ?.map((word) => word.toLowerCase())
      .find((word) => word !== "" && lower.includes(word))
  }
}

export class SlidingWindowRateLimiter {
  private readonly maxMessages: number
  private readonly windowMs: number
  private readonly buckets = new Map<string, number[]>()
  private readonly now: () => number

  constructor(config: RateLimitConfig, now: () => number = () => Date.now()) {
    this.maxMessages = config.maxMessages
    this.windowMs = config.windowMs
    this.now = now
  }

  allow(key: string): boolean {
    if (this.maxMessages <= 0) return true
    const now = this.now()
    const cutoff = now - this.windowMs
    const bucket = (this.buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff)
    if (bucket.length === 0) {
      this.buckets.delete(key)
      return true
    }
    if (bucket.length >= this.maxMessages) {
      this.buckets.set(key, bucket)
      return false
    }
    bucket.push(now)
    this.buckets.set(key, bucket)
    return true
  }
}

export class RolePolicyManager {
  private readonly roles: readonly RolePolicy[]
  private readonly defaultRole?: string

  constructor(defaultRole: string | undefined, roles: readonly RolePolicyInput[]) {
    this.defaultRole = defaultRole
    this.roles = roles.map((role) => ({
      name: role.name,
      userIds: new Set(role.userIds.map((id) => id.toLowerCase())),
      wildcard: role.userIds.includes("*"),
      disabledCommands: normalizeCommands(role.disabledCommands),
      limiter: role.rateLimit ? new SlidingWindowRateLimiter(role.rateLimit) : null,
    }))
  }

  resolve(userId: string | undefined): RolePolicy | null {
    const lower = userId?.toLowerCase()
    if (lower) {
      const explicit = this.roles.find((role) => !role.wildcard && role.userIds.has(lower))
      if (explicit) return explicit
    }
    if (this.defaultRole) {
      const fallback = this.roles.find((role) => role.name === this.defaultRole)
      if (fallback) return fallback
    }
    return this.roles.find((role) => role.wildcard) ?? null
  }

  allowRate(
    userId: string | undefined,
    sessionKey: string,
  ): { readonly allowed: boolean; readonly handled: boolean } {
    const role = this.resolve(userId)
    if (!role?.limiter) return { allowed: true, handled: false }
    return {
      allowed: role.limiter.allow(userId ?? sessionKey),
      handled: true,
    }
  }
}

export interface RolePolicy {
  readonly name: string
  readonly userIds: ReadonlySet<string>
  readonly wildcard: boolean
  readonly disabledCommands: ReadonlySet<string>
  readonly limiter: SlidingWindowRateLimiter | null
}

export class MessageDedupe {
  private readonly ttlMs: number
  private readonly ignoreBefore: number
  private readonly seen = new Map<string, number>()
  private readonly now: () => number

  constructor(
    ttlMs = 60_000,
    ignoreBefore?: string,
    now: () => number = () => Date.now(),
  ) {
    this.ttlMs = ttlMs
    this.ignoreBefore = ignoreBefore ? Date.parse(ignoreBefore) : 0
    this.now = now
  }

  isDuplicate(messageId: string): boolean {
    if (!messageId) return false
    const now = this.now()
    for (const [id, timestamp] of this.seen) {
      if (now - timestamp > this.ttlMs) this.seen.delete(id)
    }
    if (this.seen.has(messageId)) return true
    this.seen.set(messageId, now)
    return false
  }

  isOld(createdAt: string): boolean {
    if (this.ignoreBefore <= 0) return false
    const timestamp = Date.parse(createdAt)
    return Number.isFinite(timestamp) && timestamp < this.ignoreBefore
  }
}

export class OutgoingTokenBucketLimiter {
  private readonly config?: AgentGovernanceConfig["outgoingRateLimit"]
  private readonly buckets = new Map<string, TokenBucket>()
  private readonly now: () => number

  constructor(
    config?: AgentGovernanceConfig["outgoingRateLimit"],
    now: () => number = () => Date.now(),
  ) {
    this.config = config
    this.now = now
  }

  allow(platform: string): boolean {
    const config = this.config?.platforms?.[platform] ?? this.config?.default
    if (!config || config.maxPerSecond <= 0) return true
    const bucket = this.bucketFor(platform, config)
    bucket.refill(this.now())
    return bucket.take()
  }

  private bucketFor(platform: string, config: TokenBucketConfig): TokenBucket {
    const existing = this.buckets.get(platform)
    if (existing) return existing
    const burst = config.burst ?? Math.ceil(config.maxPerSecond)
    const bucket = new TokenBucket(burst, config.maxPerSecond, this.now())
    this.buckets.set(platform, bucket)
    return bucket
  }
}

class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(
    private readonly maxTokens: number,
    private readonly refillPerSecond: number,
    now: number,
  ) {
    this.tokens = maxTokens
    this.lastRefill = now
  }

  refill(now: number): void {
    const elapsedSeconds = Math.max(0, now - this.lastRefill) / 1000
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsedSeconds * this.refillPerSecond)
    this.lastRefill = now
  }

  take(): boolean {
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

function normalizeCommands(commands: readonly string[] | undefined): ReadonlySet<string> {
  const values = new Set<string>()
  for (const command of commands ?? []) {
    const normalized = command.trim().replace(/^\/+/, "").toLowerCase()
    if (!normalized) continue
    values.add(normalized)
  }
  return values
}

function slashCommand(content: string): string | undefined {
  const trimmed = content.trim()
  if (!trimmed.startsWith("/")) return undefined
  return trimmed.split(/\s+/, 1)[0]?.replace(/^\/+/, "").toLowerCase()
}

function blocked(code: string, reason: string): AgentGovernanceDecision {
  return { allowed: false, code, reason }
}
