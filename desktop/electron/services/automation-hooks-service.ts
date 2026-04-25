export type HookEventType =
  | "message.received"
  | "message.sent"
  | "session.started"
  | "session.ended"
  | "cron.triggered"
  | "permission.requested"
  | "error"

export type HookHandlerType = "command" | "http"

export type AutomationHookConfig = {
  event: string
  type: HookHandlerType | string
  command?: string
  url?: string
  timeout?: number
  async?: boolean
}

export type AutomationHookEvent = {
  event: HookEventType
  timestamp?: Date
  project?: string
  sessionKey?: string
  platform?: string
  userId?: string
  userName?: string
  content?: string
  error?: string
  extra?: Record<string, unknown>
}

export type HookRunResult =
  | {
    status: "permission_required"
    type: "command"
    event: string
    command: string
    env: Record<string, string>
    timeoutMs: number
    requiresPermission: true
  }
  | {
    status: "delivered"
    type: "http"
    event: string
    url: string
    statusCode: number
    timeoutMs: number
  }
  | {
    status: "failed"
    type: HookHandlerType
    event: string
    error: string
    statusCode?: number
    timeoutMs: number
  }
  | {
    status: "queued"
    type: HookHandlerType
    event: string
  }

export type HookHttpTransport = (input: {
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
}) => Promise<{ statusCode: number }>

export const HOOK_COMMAND_DEFAULT_TIMEOUT_MS = 10_000
export const HOOK_HTTP_DEFAULT_TIMEOUT_MS = 5_000

function isAsync(config: AutomationHookConfig): boolean {
  return config.async ?? true
}

function timeoutMs(config: AutomationHookConfig): number {
  if (config.timeout && config.timeout > 0) {
    return config.timeout * 1000
  }
  return config.type === "http" ? HOOK_HTTP_DEFAULT_TIMEOUT_MS : HOOK_COMMAND_DEFAULT_TIMEOUT_MS
}

export function validateHookConfig(config: AutomationHookConfig): void {
  if (!config.event) {
    throw new Error("event is required")
  }

  if (config.type === "command") {
    if (!config.command) {
      throw new Error("command is required for type=command")
    }
    return
  }

  if (config.type === "http") {
    if (!config.url) {
      throw new Error("url is required for type=http")
    }
    if (!config.url.startsWith("http://") && !config.url.startsWith("https://")) {
      throw new Error("url must start with http:// or https://")
    }
    return
  }

  throw new Error(`unknown handler type ${JSON.stringify(config.type)} (must be command or http)`)
}

export function matchHookEvent(pattern: string, event: string): boolean {
  return pattern === "*" || pattern.toLowerCase() === event.toLowerCase()
}

export function hookEventToEnv(event: Required<Pick<AutomationHookEvent, "event" | "timestamp" | "project">> & AutomationHookEvent): Record<string, string> {
  const env: Record<string, string> = {
    CC_HOOK_EVENT: event.event,
    CC_HOOK_PROJECT: event.project,
    CC_HOOK_TIMESTAMP: event.timestamp.toISOString(),
  }

  if (event.sessionKey) env.CC_HOOK_SESSION_KEY = event.sessionKey
  if (event.platform) env.CC_HOOK_PLATFORM = event.platform
  if (event.userId) env.CC_HOOK_USER_ID = event.userId
  if (event.userName) env.CC_HOOK_USER_NAME = event.userName
  if (event.content) env.CC_HOOK_CONTENT = event.content
  if (event.error) env.CC_HOOK_ERROR = event.error

  return env
}

function normalizeEvent(event: AutomationHookEvent, project: string, now: () => Date): Required<Pick<AutomationHookEvent, "event" | "timestamp" | "project">> & AutomationHookEvent {
  return {
    ...event,
    project,
    timestamp: event.timestamp ?? now(),
  }
}

function eventBody(event: Required<Pick<AutomationHookEvent, "event" | "timestamp" | "project">> & AutomationHookEvent): string {
  return JSON.stringify({
    event: event.event,
    timestamp: event.timestamp.toISOString(),
    project: event.project,
    session_key: event.sessionKey,
    platform: event.platform,
    user_id: event.userId,
    user_name: event.userName,
    content: event.content,
    error: event.error,
    extra: event.extra,
  })
}

export class AutomationHookManager {
  private readonly project: string
  private readonly hooks: AutomationHookConfig[]
  private readonly httpTransport: HookHttpTransport
  private readonly now: () => Date
  private readonly asyncQueue: Promise<HookRunResult>[] = []

  constructor(project: string, hooks: readonly AutomationHookConfig[], options: {
    httpTransport?: HookHttpTransport
    now?: () => Date
  } = {}) {
    this.project = project
    this.hooks = hooks.filter((hook) => {
      try {
        validateHookConfig(hook)
        return true
      } catch {
        return false
      }
    }).map((hook) => ({ ...hook }))
    this.httpTransport = options.httpTransport ?? (async () => {
      throw new Error("http hook transport is not configured")
    })
    this.now = options.now ?? (() => new Date())
  }

  listHooks(): AutomationHookConfig[] {
    return this.hooks.map((hook) => ({ ...hook }))
  }

  emit(event: AutomationHookEvent): Promise<HookRunResult[]> {
    const normalized = normalizeEvent(event, this.project, this.now)
    const results: Promise<HookRunResult>[] = []

    for (const hook of this.hooks) {
      if (!matchHookEvent(hook.event, normalized.event)) {
        continue
      }

      const task = this.runHook(hook, normalized)
      if (isAsync(hook)) {
        this.asyncQueue.push(task)
        results.push(Promise.resolve({
          status: "queued",
          type: hook.type as HookHandlerType,
          event: normalized.event,
        }))
      } else {
        results.push(task)
      }
    }

    return Promise.all(results)
  }

  async drainAsync(): Promise<HookRunResult[]> {
    const pending = this.asyncQueue.splice(0)
    return Promise.all(pending)
  }

  private async runHook(
    hook: AutomationHookConfig,
    event: Required<Pick<AutomationHookEvent, "event" | "timestamp" | "project">> & AutomationHookEvent,
  ): Promise<HookRunResult> {
    if (hook.type === "command") {
      return {
        status: "permission_required",
        type: "command",
        event: event.event,
        command: hook.command ?? "",
        env: hookEventToEnv(event),
        timeoutMs: timeoutMs(hook),
        requiresPermission: true,
      }
    }

    return this.runHttpHook(hook, event)
  }

  private async runHttpHook(
    hook: AutomationHookConfig,
    event: Required<Pick<AutomationHookEvent, "event" | "timestamp" | "project">> & AutomationHookEvent,
  ): Promise<HookRunResult> {
    const hookTimeoutMs = timeoutMs(hook)
    try {
      const response = await this.httpTransport({
        url: hook.url ?? "",
        timeoutMs: hookTimeoutMs,
        body: eventBody(event),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Synapse-Hooks/1.0",
          "X-Hook-Event": event.event,
        },
      })
      if (response.statusCode >= 400) {
        return {
          status: "failed",
          type: "http",
          event: event.event,
          error: `http response error: ${response.statusCode}`,
          statusCode: response.statusCode,
          timeoutMs: hookTimeoutMs,
        }
      }
      return {
        status: "delivered",
        type: "http",
        event: event.event,
        url: hook.url ?? "",
        statusCode: response.statusCode,
        timeoutMs: hookTimeoutMs,
      }
    } catch (error) {
      return {
        status: "failed",
        type: "http",
        event: event.event,
        error: error instanceof Error ? error.message : String(error),
        timeoutMs: hookTimeoutMs,
      }
    }
  }
}
