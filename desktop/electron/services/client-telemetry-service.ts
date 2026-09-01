import { randomUUID } from "node:crypto"
import type { DataNamespace } from "../runtime/data-repo"
import type {
  ClientTelemetryCategory,
  ClientTelemetryOutboxEntryV1,
  ClientTelemetryOutcome,
} from "../runtime/data-repo/schemas/client-telemetry"
import type { SynapseRendererLogPayload } from "../../src/types/log"
import type { SynapseAccountState } from "../../src/types/account"
import type { AccountService } from "./account-service"
import { LiveClientIdStore } from "./live-client-id-store"
import { createMainLogger } from "./log-store"
export { CLIENT_TELEMETRY_SERVICE_ID } from "./client-telemetry-constants"

const flushIntervalMs = 15_000
const flushThreshold = 20
const batchLimit = 50
const localQueueLimit = 5_000
const localMaxAgeMs = 7 * 24 * 60 * 60 * 1000
const retryBaseMs = 5_000
const retryMaxMs = 15 * 60 * 1000
const identityFlushTimeoutMs = 250
const stopFlushTimeoutMs = 2_000
const stableKeyPattern = /^[a-z][a-z0-9._-]{0,63}$/u
const stableDimensionPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const uuidLikePattern = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu

const logger = createMainLogger("service.client-telemetry")

type AccountClient = Pick<
  AccountService,
  | "fetchAuthenticated"
  | "fetchPublic"
  | "getState"
  | "onBeforeIdentityChange"
  | "onStateChanged"
>

type ClientTelemetryServiceDeps = {
  readonly outbox: DataNamespace<ClientTelemetryOutboxEntryV1>
  readonly account: AccountClient
  readonly clientIdStore?: Pick<LiveClientIdStore, "getOrCreate">
  readonly appVersion: string
  readonly platform: string
  readonly createId?: () => string
  readonly now?: () => Date
}

type RemoteTelemetryDetails = {
  readonly category: ClientTelemetryCategory
  readonly eventKey: string
  readonly component: string
  readonly action: string
  readonly outcome?: ClientTelemetryOutcome
  readonly durationMs?: number
  readonly moduleId?: string
  readonly windowType: string
}

export class ClientTelemetryService {
  private readonly outbox: DataNamespace<ClientTelemetryOutboxEntryV1>
  private readonly account: AccountClient
  private readonly clientIdStore: Pick<LiveClientIdStore, "getOrCreate">
  private readonly appVersion: string
  private readonly platform: string
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly sessionId: string
  private clientInstanceId: string | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  private flushInFlight: Promise<void> | null = null
  private unsubscribers: Array<() => void> = []

  constructor(deps: ClientTelemetryServiceDeps) {
    this.outbox = deps.outbox
    this.account = deps.account
    this.clientIdStore = deps.clientIdStore ?? new LiveClientIdStore()
    this.appVersion = deps.appVersion
    this.platform = deps.platform
    this.createId = deps.createId ?? randomUUID
    this.now = deps.now ?? (() => new Date())
    this.sessionId = this.createId()
  }

  async start(): Promise<void> {
    try {
      this.clientInstanceId = await this.clientIdStore.getOrCreate()
    } catch (error) {
      logger.warn("Client telemetry identity initialization deferred.", failureMetadata(error))
    }
    try {
      await this.pruneQueue()
    } catch (error) {
      logger.warn("Client telemetry queue pruning deferred.", failureMetadata(error))
    }
    try {
      this.unsubscribers.push(this.account.onBeforeIdentityChange(() => this.flushBeforeIdentityChange()))
    } catch (error) {
      logger.warn("Client telemetry identity listener disabled.", failureMetadata(error))
    }
    try {
      this.unsubscribers.push(this.account.onStateChanged(() => this.scheduleFlush(0)))
    } catch (error) {
      logger.warn("Client telemetry account listener disabled.", failureMetadata(error))
    }
    try {
      this.interval = setInterval(() => this.scheduleFlush(0), flushIntervalMs)
      this.interval.unref?.()
      this.scheduleFlush(0)
    } catch (error) {
      logger.warn("Client telemetry scheduling disabled.", failureMetadata(error))
    }
  }

  async stop(): Promise<void> {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe()
      } catch (error) {
        logger.warn("Client telemetry listener cleanup skipped.", failureMetadata(error))
      }
    }
    if (this.interval) clearInterval(this.interval)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.interval = null
    this.retryTimer = null
    await Promise.race([
      this.flush(),
      new Promise<void>((resolve) => setTimeout(resolve, stopFlushTimeoutMs)),
    ])
  }

  recordRendererLog(payload: SynapseRendererLogPayload): void {
    try {
      const details = projectTelemetryDetails(payload)
      if (!details) return
      void this.enqueue(details).catch((error) => {
        logger.warn("Failed to enqueue client telemetry.", failureMetadata(error))
      })
    } catch (error) {
      logger.warn("Failed to project client telemetry.", failureMetadata(error))
    }
  }

  private async enqueue(details: RemoteTelemetryDetails): Promise<void> {
    const clientInstanceId = this.clientInstanceId ?? await this.clientIdStore.getOrCreate()
    this.clientInstanceId = clientInstanceId
    const state = this.account.getState()
    const accountUserId = accountUserIdFromState(state)
    const occurredAt = this.now().toISOString()
    const id = this.createId()
    await this.outbox.upsert({
      id,
      schemaVersion: 1,
      accountUserId,
      ...details,
      clientInstanceId,
      sessionId: this.sessionId,
      appVersion: this.appVersion,
      platform: this.platform,
      occurredAt,
    })
    const count = await this.outbox.count?.()
    if (count !== undefined && count >= flushThreshold) this.scheduleFlush(0)
    if (count !== undefined && count > localQueueLimit) await this.pruneQueue()
  }

  private scheduleFlush(delayMs: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flush()
    }, delayMs)
    this.retryTimer.unref?.()
  }

  private flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight
    this.flushInFlight = this.flushBatch()
      .catch((error) => {
        logger.warn("Client telemetry flush deferred.", failureMetadata(error))
        this.scheduleRetry()
      })
      .finally(() => {
        this.flushInFlight = null
      })
    return this.flushInFlight
  }

  private async flushBeforeIdentityChange(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        this.flush(),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, identityFlushTimeoutMs)
          timeout.unref?.()
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private async flushBatch(): Promise<void> {
    const entries = (await this.outbox.list())
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    if (entries.length === 0) {
      this.retryAttempt = 0
      return
    }
    const currentUserId = accountUserIdFromState(this.account.getState())
    const eligible = entries.filter((entry) => entry.accountUserId === null || entry.accountUserId === currentUserId)
    if (eligible.length === 0) return
    const accountUserId = eligible[0].accountUserId
    const batch = eligible.filter((entry) => entry.accountUserId === accountUserId).slice(0, batchLimit)
    const request = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch.map(toRemoteEvent) }),
    }
    try {
      const response = accountUserId === null
        ? await this.account.fetchPublic("/client-telemetry/events", request)
        : await this.account.fetchAuthenticated("/client-telemetry/events", request, "埋点发送失败。")
      if (response.ok) {
        await Promise.all(batch.map((entry) => this.outbox.remove(entry.id)))
        this.retryAttempt = 0
        if (entries.length > batch.length) this.scheduleFlush(0)
        return
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 429) {
        await Promise.all(batch.map((entry) => this.outbox.remove(entry.id)))
        logger.warn("Dropped invalid client telemetry batch.", { status: response.status, count: batch.length })
        return
      }
      this.scheduleRetry()
    } catch (error) {
      logger.warn("Client telemetry delivery deferred.", failureMetadata(error))
      this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    const delay = Math.min(retryMaxMs, retryBaseMs * (2 ** this.retryAttempt))
    this.retryAttempt = Math.min(this.retryAttempt + 1, 8)
    const jittered = Math.round(delay * (0.8 + Math.random() * 0.4))
    this.scheduleFlush(jittered)
  }

  private async pruneQueue(): Promise<void> {
    const entries = (await this.outbox.list())
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    const minimumTime = this.now().getTime() - localMaxAgeMs
    const expired = entries.filter((entry) => Date.parse(entry.occurredAt) < minimumTime)
    const remaining = entries.filter((entry) => Date.parse(entry.occurredAt) >= minimumTime)
    const overflow = remaining.slice(0, Math.max(0, remaining.length - localQueueLimit))
    await Promise.all([...expired, ...overflow].map((entry) => this.outbox.remove(entry.id)))
  }
}

function projectTelemetryDetails(payload: SynapseRendererLogPayload): RemoteTelemetryDetails | null {
  if (payload.category === "renderer.runtime" && payload.level === "error") {
    return {
      category: "error",
      eventKey: "renderer.runtime.error",
      component: "renderer",
      action: "error",
      outcome: "failure",
      windowType: "unknown",
    }
  }
  if (payload.category !== "ui.tracking" || !isRecord(payload.details)) return null
  const telemetry = payload.details.telemetry
  if (!isRecord(telemetry)) return null
  const eventKey = stableKey(telemetry.eventKey)
  const component = stableDimension(telemetry.component)
  const action = stableDimension(telemetry.action)
  const windowType = stableDimension(telemetry.windowType)
  if (!eventKey || !component || !action || !windowType) return null
  const category = telemetry.category
  if (!isCategory(category)) return null
  const outcome = isOutcome(telemetry.outcome) ? telemetry.outcome : undefined
  const durationMs = typeof telemetry.durationMs === "number"
    && Number.isInteger(telemetry.durationMs)
    && telemetry.durationMs >= 0
    ? Math.min(telemetry.durationMs, 24 * 60 * 60 * 1000)
    : undefined
  const moduleId = stableDimension(telemetry.moduleId) ?? undefined
  return { category, eventKey, component, action, outcome, durationMs, moduleId, windowType }
}

function stableKey(value: unknown): string | null {
  return typeof value === "string" && stableKeyPattern.test(value) && !uuidLikePattern.test(value)
    ? value
    : null
}

function stableDimension(value: unknown): string | null {
  return typeof value === "string" && stableDimensionPattern.test(value) && !uuidLikePattern.test(value)
    ? value
    : null
}

function isCategory(value: unknown): value is ClientTelemetryCategory {
  return value === "lifecycle" || value === "navigation" || value === "interaction" || value === "operation" || value === "error"
}

function isOutcome(value: unknown): value is ClientTelemetryOutcome {
  return value === "success" || value === "failure" || value === "cancelled"
}

function accountUserIdFromState(state: SynapseAccountState): string | null {
  return "profile" in state && state.profile ? state.profile.user.id : null
}

function toRemoteEvent(entry: ClientTelemetryOutboxEntryV1) {
  const { id, schemaVersion: _schemaVersion, accountUserId: _accountUserId, ...event } = entry
  return { eventId: id, ...event }
}

function failureMetadata(error: unknown) {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: String(error).length,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
