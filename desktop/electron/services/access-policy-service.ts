export type AccessRateLimitConfig = {
  maxMessages: number
  windowMs: number
}

export type AccessRoleInput = {
  name: string
  userIds: string[]
  disabledCommands?: string[]
  rateLimit?: AccessRateLimitConfig | null
}

export type AccessRoleSnapshot = {
  userIds: string[]
  disabledCommands: string[]
  rateLimit?: AccessRateLimitConfig
}

export type AccessPolicySnapshot = {
  configured: boolean
  defaultRole: string
  roles: Record<string, AccessRoleSnapshot>
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "allow_from" | "command_disabled" | "rate_limited"; role?: string }

export type CommandDefinition = {
  id: string
  names: string[]
}

export type IncomingMessageRateInput = {
  sessionKey: string
  userId: string
}

export type AccessPolicyOptions = {
  allowFrom?: string
  disabledCommands?: string[]
  defaultRole?: string
  roles?: AccessRoleInput[]
  rateLimit?: AccessRateLimitConfig | null
  commandCatalog?: CommandDefinition[]
  now?: () => number
}

export type OutgoingRateLimitConfig = {
  maxPerSecond: number
  burst?: number
}

export const CC_BUILTIN_COMMANDS: CommandDefinition[] = [
  { id: "new", names: ["new"] },
  { id: "list", names: ["list", "sessions"] },
  { id: "switch", names: ["switch"] },
  { id: "name", names: ["name", "rename"] },
  { id: "current", names: ["current"] },
  { id: "status", names: ["status"] },
  { id: "usage", names: ["usage", "quota"] },
  { id: "history", names: ["history"] },
  { id: "allow", names: ["allow"] },
  { id: "model", names: ["model"] },
  { id: "reasoning", names: ["reasoning", "effort"] },
  { id: "mode", names: ["mode"] },
  { id: "lang", names: ["lang"] },
  { id: "quiet", names: ["quiet"] },
  { id: "provider", names: ["provider"] },
  { id: "memory", names: ["memory"] },
  { id: "cron", names: ["cron"] },
  { id: "heartbeat", names: ["heartbeat", "hb"] },
  { id: "compress", names: ["compress", "compact"] },
  { id: "stop", names: ["stop"] },
  { id: "help", names: ["help"] },
  { id: "version", names: ["version"] },
  { id: "commands", names: ["commands", "command", "cmd"] },
  { id: "skills", names: ["skills", "skill"] },
  { id: "config", names: ["config"] },
  { id: "doctor", names: ["doctor"] },
  { id: "upgrade", names: ["upgrade", "update"] },
  { id: "restart", names: ["restart"] },
  { id: "alias", names: ["alias"] },
  { id: "delete", names: ["delete", "del", "rm"] },
  { id: "bind", names: ["bind"] },
  { id: "search", names: ["search", "find"] },
  { id: "shell", names: ["shell", "sh", "exec", "run"] },
  { id: "show", names: ["show"] },
  { id: "dir", names: ["dir", "cd", "chdir", "workdir"] },
  { id: "tts", names: ["tts"] },
  { id: "workspace", names: ["workspace", "ws"] },
  { id: "whoami", names: ["whoami", "myid"] },
  { id: "web", names: ["web"] },
  { id: "diff", names: ["diff"] },
]

type RoleEntry = {
  roleName: string
  userIds: Set<string>
  wildcard: boolean
}

type ResolvedRole = {
  name: string
  disabledCommands: Set<string>
  rateLimit: AccessRateLimitConfig | null
}

type RateBucket = {
  timestamps: number[]
  lastAccess: number
}

function normalizeCommand(command: string): string {
  return command.trim().toLowerCase().replace(/^\/+/, "")
}

function matchCommand(command: string, catalog: readonly CommandDefinition[]): string {
  const normalized = normalizeCommand(command)

  for (const item of catalog) {
    if (item.names.some((name) => name === normalized)) {
      return item.id
    }
  }

  let matched = ""
  for (const item of catalog) {
    if (item.names.some((name) => name.startsWith(normalized))) {
      if (matched && matched !== item.id) {
        return ""
      }
      matched = item.id
    }
  }

  return matched
}

function sortedSet(values: Iterable<string>): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b))
}

export function allowListAllows(allowFrom: string | undefined, userId: string): boolean {
  const normalized = allowFrom?.trim() ?? ""

  if (!normalized || normalized === "*") {
    return true
  }

  return normalized
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .some((id) => id.toLowerCase() === userId.toLowerCase())
}

export function resolveDisabledCommands(
  commands: readonly string[] | undefined,
  catalog: readonly CommandDefinition[] = CC_BUILTIN_COMMANDS,
): Set<string> {
  const resolved = new Set<string>()

  for (const command of commands ?? []) {
    const normalized = normalizeCommand(command)
    if (!normalized) {
      continue
    }

    if (normalized === "*") {
      for (const item of catalog) {
        resolved.add(item.id)
      }
      return resolved
    }

    resolved.add(matchCommand(normalized, catalog) || normalized)
  }

  return resolved
}

export function isCommandDisabled(
  command: string,
  disabledCommands: ReadonlySet<string>,
  catalog: readonly CommandDefinition[] = CC_BUILTIN_COMMANDS,
): boolean {
  const normalized = normalizeCommand(command)
  const canonical = matchCommand(normalized, catalog) || normalized

  return disabledCommands.has(canonical)
}

export function validateAccessRoleInputs(defaultRole: string, roles: readonly AccessRoleInput[]): Error | null {
  if (roles.length === 0) {
    return new Error("no roles defined")
  }

  let wildcardCount = 0
  const seenUsers = new Map<string, string>()
  const roleNames = new Set<string>()

  for (const role of roles) {
    roleNames.add(role.name)

    if (role.userIds.length === 0) {
      return new Error(`role ${JSON.stringify(role.name)} has empty user_ids`)
    }

    for (const userId of role.userIds) {
      if (userId === "*") {
        wildcardCount++
        continue
      }

      const normalizedUserId = userId.toLowerCase()
      const previousRole = seenUsers.get(normalizedUserId)
      if (previousRole) {
        return new Error(`user ${JSON.stringify(userId)} appears in both role ${JSON.stringify(previousRole)} and ${JSON.stringify(role.name)}`)
      }
      seenUsers.set(normalizedUserId, role.name)
    }
  }

  if (wildcardCount > 1) {
    return new Error('wildcard user_ids=["*"] appears in multiple roles')
  }

  if (defaultRole && !roleNames.has(defaultRole)) {
    return new Error(`default_role ${JSON.stringify(defaultRole)} does not match any defined role`)
  }

  return null
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, RateBucket>()
  private readonly now: () => number
  private readonly maxMessages: number
  private readonly windowMs: number

  constructor(config: AccessRateLimitConfig, options: { now?: () => number } = {}) {
    this.maxMessages = config.maxMessages
    this.windowMs = config.windowMs
    this.now = options.now ?? Date.now
  }

  allow(key: string): boolean {
    if (this.maxMessages <= 0) {
      return true
    }

    const now = this.now()
    const bucket = this.buckets.get(key) ?? { timestamps: [], lastAccess: now }
    bucket.lastAccess = now

    const cutoff = now - this.windowMs
    bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > cutoff)

    if (bucket.timestamps.length >= this.maxMessages) {
      this.buckets.set(key, bucket)
      return false
    }

    bucket.timestamps.push(now)
    this.buckets.set(key, bucket)
    return true
  }

  cleanup(): void {
    const now = this.now()
    const staleThreshold = this.windowMs * 2

    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastAccess > staleThreshold) {
        this.buckets.delete(key)
      }
    }
  }
}

export class AccessRoleManager {
  private readonly roles: RoleEntry[]
  private readonly roleMap: Map<string, ResolvedRole>
  private readonly limiters: Map<string, SlidingWindowRateLimiter>
  private readonly defaultRole: string

  constructor(
    defaultRole: string,
    roles: readonly AccessRoleInput[],
    options: { commandCatalog?: CommandDefinition[]; now?: () => number } = {},
  ) {
    const catalog = options.commandCatalog ?? CC_BUILTIN_COMMANDS
    const sortedRoles = [...roles].sort((a, b) => a.name.localeCompare(b.name))
    this.defaultRole = defaultRole
    this.roles = []
    this.roleMap = new Map()
    this.limiters = new Map()

    for (const input of sortedRoles) {
      const resolvedRole: ResolvedRole = {
        name: input.name,
        disabledCommands: resolveDisabledCommands(input.disabledCommands, catalog),
        rateLimit: input.rateLimit ?? null,
      }
      this.roleMap.set(input.name, resolvedRole)

      const entry: RoleEntry = {
        roleName: input.name,
        userIds: new Set(),
        wildcard: false,
      }

      for (const userId of input.userIds) {
        if (userId === "*") {
          entry.wildcard = true
        } else {
          entry.userIds.add(userId.toLowerCase())
        }
      }

      this.roles.push(entry)

      if (input.rateLimit && input.rateLimit.maxMessages > 0) {
        this.limiters.set(input.name, new SlidingWindowRateLimiter(input.rateLimit, { now: options.now }))
      }
    }
  }

  resolveRole(userId: string): ResolvedRole | null {
    const normalizedUserId = userId.toLowerCase()

    for (const entry of this.roles) {
      if (!entry.wildcard && entry.userIds.has(normalizedUserId)) {
        return this.roleMap.get(entry.roleName) ?? null
      }
    }

    if (this.defaultRole) {
      const role = this.roleMap.get(this.defaultRole)
      if (role) {
        return role
      }
    }

    for (const entry of this.roles) {
      if (entry.wildcard) {
        return this.roleMap.get(entry.roleName) ?? null
      }
    }

    return null
  }

  allowRate(userId: string): { allowed: boolean; handled: boolean; role?: string } {
    const role = this.resolveRole(userId)

    if (!role?.rateLimit) {
      return { allowed: true, handled: false }
    }

    const limiter = this.limiters.get(role.name)
    if (!limiter) {
      return { allowed: true, handled: false }
    }

    return {
      allowed: limiter.allow(userId),
      handled: true,
      role: role.name,
    }
  }

  snapshot(): AccessPolicySnapshot {
    const roles: Record<string, AccessRoleSnapshot> = {}

    for (const entry of this.roles) {
      const role = this.roleMap.get(entry.roleName)
      if (!role) {
        continue
      }

      const userIds = entry.wildcard
        ? ["*", ...sortedSet(entry.userIds)]
        : sortedSet(entry.userIds)

      roles[entry.roleName] = {
        userIds,
        disabledCommands: sortedSet(role.disabledCommands),
        ...(role.rateLimit ? { rateLimit: role.rateLimit } : undefined),
      }
    }

    return {
      configured: true,
      defaultRole: this.defaultRole,
      roles,
    }
  }
}

export class AccessPolicyService {
  private readonly allowFrom: string | undefined
  private readonly commandCatalog: CommandDefinition[]
  private readonly projectDisabledCommands: Set<string>
  private readonly roleManager: AccessRoleManager | null
  private readonly globalRateLimiter: SlidingWindowRateLimiter | null

  constructor(options: AccessPolicyOptions = {}) {
    this.allowFrom = options.allowFrom
    this.commandCatalog = options.commandCatalog ?? CC_BUILTIN_COMMANDS
    this.projectDisabledCommands = resolveDisabledCommands(options.disabledCommands, this.commandCatalog)
    this.roleManager = options.roles?.length
      ? new AccessRoleManager(options.defaultRole ?? "", options.roles, {
          commandCatalog: this.commandCatalog,
          now: options.now,
        })
      : null
    this.globalRateLimiter = options.rateLimit
      ? new SlidingWindowRateLimiter(options.rateLimit, { now: options.now })
      : null
  }

  checkUser(userId: string): AccessDecision {
    return allowListAllows(this.allowFrom, userId)
      ? { allowed: true }
      : { allowed: false, reason: "allow_from" }
  }

  checkCommand(userId: string, command: string): AccessDecision {
    const role = this.roleManager?.resolveRole(userId) ?? null
    const disabledCommands = role?.disabledCommands ?? this.projectDisabledCommands

    if (isCommandDisabled(command, disabledCommands, this.commandCatalog)) {
      return {
        allowed: false,
        reason: "command_disabled",
        ...(role ? { role: role.name } : undefined),
      }
    }

    return { allowed: true }
  }

  checkIncomingRate(input: IncomingMessageRateInput): AccessDecision {
    const roleRate = this.roleManager?.allowRate(input.userId)

    if (roleRate?.handled) {
      return roleRate.allowed
        ? { allowed: true }
        : { allowed: false, reason: "rate_limited", ...(roleRate.role ? { role: roleRate.role } : undefined) }
    }

    if (!this.globalRateLimiter) {
      return { allowed: true }
    }

    const key = this.roleManager ? input.userId : input.sessionKey
    return this.globalRateLimiter.allow(key)
      ? { allowed: true }
      : { allowed: false, reason: "rate_limited" }
  }

  snapshotRoles(): AccessPolicySnapshot {
    return this.roleManager?.snapshot() ?? { configured: false, defaultRole: "", roles: {} }
  }
}

export function redactToken(text: string, token: string): string {
  if (!text || !token) {
    return text
  }

  return text.split(token).join("[REDACTED]")
}

export function redactEnv(env: readonly string[]): string[] {
  const sensitiveKeys = ["KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL"]

  return env.map((entry) => {
    const separatorIndex = entry.indexOf("=")
    if (separatorIndex < 0) {
      return entry
    }

    const key = entry.slice(0, separatorIndex).toUpperCase()
    return sensitiveKeys.some((sensitiveKey) => key.includes(sensitiveKey))
      ? `${entry.slice(0, separatorIndex + 1)}***`
      : entry
  })
}

export function redactArgs(args: readonly string[]): string[] {
  const sensitiveFlags = [
    "--api-key",
    "--api_key",
    "--apikey",
    "--token",
    "--secret",
    "--password",
    "-k",
  ]
  const output = [...args]

  for (let index = 0; index < output.length; index++) {
    const arg = output[index] ?? ""
    const normalized = arg.toLowerCase()

    for (const flag of sensitiveFlags) {
      if (normalized.startsWith(`${flag}=`)) {
        const separatorIndex = arg.indexOf("=")
        output[index] = `${arg.slice(0, separatorIndex + 1)}***`
        break
      }
    }

    for (const flag of sensitiveFlags) {
      if (normalized === flag && index + 1 < output.length) {
        output[index + 1] = "***"
        index++
        break
      }
    }
  }

  return output
}

type TokenBucket = {
  tokens: number
  maxTokens: number
  refillRate: number
  lastRefill: number
}

function effectiveBurst(config: OutgoingRateLimitConfig): number {
  return config.burst && config.burst > 0
    ? config.burst
    : Math.ceil(config.maxPerSecond)
}

function isOutgoingDisabled(config: OutgoingRateLimitConfig): boolean {
  return config.maxPerSecond <= 0
}

export class OutgoingRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>()
  private readonly defaults: OutgoingRateLimitConfig
  private readonly overrides: Record<string, OutgoingRateLimitConfig>
  private readonly now: () => number

  constructor(
    defaults: OutgoingRateLimitConfig,
    overrides: Record<string, OutgoingRateLimitConfig> = {},
    options: { now?: () => number } = {},
  ) {
    this.defaults = defaults
    this.overrides = overrides
    this.now = options.now ?? Date.now
  }

  tryAcquire(platform: string): boolean {
    const config = this.configFor(platform)
    if (isOutgoingDisabled(config)) {
      return true
    }

    const bucket = this.bucketFor(platform, config)
    this.refill(bucket)

    if (bucket.tokens >= 1) {
      bucket.tokens--
      return true
    }

    return false
  }

  nextDelayMs(platform: string): number {
    const config = this.configFor(platform)
    if (isOutgoingDisabled(config)) {
      return 0
    }

    const bucket = this.bucketFor(platform, config)
    this.refill(bucket)
    if (bucket.tokens >= 1) {
      return 0
    }

    return Math.ceil(((1 - bucket.tokens) / bucket.refillRate) * 1000)
  }

  async wait(platform: string, signal?: AbortSignal): Promise<void> {
    while (!this.tryAcquire(platform)) {
      await sleepWithAbort(Math.max(1, this.nextDelayMs(platform)), signal)
    }
  }

  private configFor(platform: string): OutgoingRateLimitConfig {
    return this.overrides[platform] ?? this.defaults
  }

  private bucketFor(platform: string, config: OutgoingRateLimitConfig): TokenBucket {
    const existing = this.buckets.get(platform)
    if (existing) {
      return existing
    }

    const burst = effectiveBurst(config)
    const bucket = {
      tokens: burst,
      maxTokens: burst,
      refillRate: config.maxPerSecond,
      lastRefill: this.now(),
    }
    this.buckets.set(platform, bucket)
    return bucket
  }

  private refill(bucket: TokenBucket): void {
    const now = this.now()
    const elapsedSeconds = Math.max(0, (now - bucket.lastRefill) / 1000)
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsedSeconds * bucket.refillRate)
    bucket.lastRefill = now
  }
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason)
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    const cleanup = (): void => {
      clearTimeout(timeout)
      reject(signal?.reason ?? new Error("aborted"))
    }

    signal?.addEventListener("abort", cleanup, { once: true })
  })
}
