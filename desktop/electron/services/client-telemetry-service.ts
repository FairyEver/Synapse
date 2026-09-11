import { randomUUID } from "node:crypto"
import { release as osRelease } from "node:os"
import type { DataNamespace } from "../runtime/data-repo"
import type {
  ClientTelemetryCategory,
  ClientTelemetryEnvironmentEntryV1,
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
const osNameHeader = "X-Synapse-Telemetry-OS-Name"
const osVersionHeader = "X-Synapse-Telemetry-OS-Version"
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
  readonly environments: DataNamespace<ClientTelemetryEnvironmentEntryV1>
  readonly account: AccountClient
  readonly clientIdStore?: Pick<LiveClientIdStore, "getOrCreate">
  readonly appVersion: string
  readonly platform: string
  readonly osName?: string
  readonly osVersion?: string
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
  private readonly environments: DataNamespace<ClientTelemetryEnvironmentEntryV1>
  private readonly account: AccountClient
  private readonly clientIdStore: Pick<LiveClientIdStore, "getOrCreate">
  private readonly appVersion: string
  private readonly platform: string
  private readonly osName?: string
  private readonly osVersion?: string
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
    this.environments = deps.environments
    this.account = deps.account
    this.clientIdStore = deps.clientIdStore ?? new LiveClientIdStore()
    this.appVersion = deps.appVersion
    this.platform = deps.platform
    this.osName = deps.osName
    this.osVersion = deps.osVersion
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
    await this.environments.upsert({
      id,
      schemaVersion: 1,
      ...(this.osName ? { osName: this.osName } : {}),
      ...(this.osVersion ? { osVersion: this.osVersion } : {}),
      occurredAt,
    })
    try {
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
    } catch (error) {
      await this.removeEnvironment(id)
      throw error
    }
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
    const candidates = eligible
      .filter((entry) => entry.accountUserId === accountUserId)
      .slice(0, batchLimit)
    const candidateEnvironments = await Promise.all(candidates.map((entry) => this.environments.get(entry.id)))
    const batchEnvironment = candidateEnvironments[0] ?? undefined
    const batch = candidates.filter((_entry, index) => sameEnvironment(
      candidateEnvironments[index] ?? undefined,
      batchEnvironment,
    ))
    const request = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(batchEnvironment?.osName ? { [osNameHeader]: batchEnvironment.osName } : {}),
        ...(batchEnvironment?.osVersion ? { [osVersionHeader]: batchEnvironment.osVersion } : {}),
      },
      body: JSON.stringify({ events: batch.map(toRemoteEvent) }),
    }
    try {
      const response = accountUserId === null
        ? await this.account.fetchPublic("/client-telemetry/events", request)
        : await this.account.fetchAuthenticated("/client-telemetry/events", request, "埋点发送失败。")
      if (response.ok) {
        await this.removeBatch(batch)
        this.retryAttempt = 0
        if (entries.length > batch.length) this.scheduleFlush(0)
        return
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 429) {
        await this.removeBatch(batch)
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
    await this.removeBatch([...expired, ...overflow])
  }

  private async removeBatch(entries: readonly ClientTelemetryOutboxEntryV1[]): Promise<void> {
    await Promise.all(entries.map(async (entry) => {
      await this.outbox.remove(entry.id)
      await this.removeEnvironment(entry.id)
    }))
  }

  private async removeEnvironment(id: string): Promise<void> {
    try {
      await this.environments.remove(id)
    } catch (error) {
      logger.warn("Failed to remove client telemetry environment.", failureMetadata(error))
    }
  }
}

export function detectDesktopOperatingSystem(
  platform: NodeJS.Platform | string = process.platform,
  systemVersion = readSystemVersion(),
): { readonly osName: string; readonly osVersion: string } {
  const osVersion = normalizeOperatingSystemVersion(systemVersion)
  if (platform === "win32") {
    return { osName: windowsName(osVersion), osVersion }
  }
  if (platform === "darwin") return { osName: "macos", osVersion }
  if (platform === "linux") return { osName: "linux", osVersion }
  return { osName: normalizeOperatingSystemName(platform), osVersion }
}

function readSystemVersion(): string {
  const electronProcess = process as NodeJS.Process & { readonly getSystemVersion?: () => string }
  const version = electronProcess.getSystemVersion?.() ?? osRelease()
  return normalizeOperatingSystemVersion(version)
}

function windowsName(version: string): string {
  const [major, minor, build] = version.split(".").map(Number)
  if (major === 6 && minor === 1) return "windows-7"
  if (major === 6 && minor === 2) return "windows-8"
  if (major === 6 && minor === 3) return "windows-8.1"
  if (major === 10 && minor === 0) {
    if (!Number.isFinite(build)) return "windows-10-or-11"
    return build >= 22_000 ? "windows-11" : "windows-10"
  }
  return "windows"
}

function normalizeOperatingSystemName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]/gu, "-").slice(0, 64)
  return normalized || "unknown"
}

function normalizeOperatingSystemVersion(value: string | undefined): string {
  const normalized = value?.replace(/[^A-Za-z0-9._+-]/gu, "-").slice(0, 32)
  return normalized || "unknown"
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

function sameEnvironment(
  left: ClientTelemetryEnvironmentEntryV1 | undefined,
  right: ClientTelemetryEnvironmentEntryV1 | undefined,
): boolean {
  return left?.osName === right?.osName && left?.osVersion === right?.osVersion
}

function toRemoteEvent(entry: ClientTelemetryOutboxEntryV1) {
  const {
    id,
    schemaVersion: _schemaVersion,
    accountUserId: _accountUserId,
    ...event
  } = entry
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
