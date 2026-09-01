import { sendClientTelemetryBatch } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'

export type DriveTelemetryCategory = 'lifecycle' | 'navigation' | 'interaction' | 'operation' | 'error'
export type DriveTelemetryOutcome = 'success' | 'failure' | 'cancelled'
export type DriveTelemetryAction =
  | 'blur'
  | 'change'
  | 'click'
  | 'close'
  | 'complete'
  | 'drop'
  | 'focus'
  | 'open'
  | 'scroll'
  | 'select'
  | 'submit'

export type DriveTelemetryDetails = {
  readonly eventKey: string
  readonly component: string
  readonly action: DriveTelemetryAction
  readonly category?: DriveTelemetryCategory
  readonly outcome?: DriveTelemetryOutcome
  readonly durationMs?: number
}

type DriveTelemetryEvent = {
  readonly eventId: string
  readonly category: DriveTelemetryCategory
  readonly eventKey: string
  readonly component: string
  readonly action: DriveTelemetryAction
  readonly outcome?: DriveTelemetryOutcome
  readonly durationMs?: number
  readonly moduleId: 'drive'
  readonly windowType: 'web-drive'
  readonly clientInstanceId: string
  readonly sessionId: string
  readonly appVersion: string
  readonly platform: 'web'
  readonly occurredAt: string
}

type QueuedDriveTelemetryEvent = {
  readonly accountSessionId: string | null
  readonly event: DriveTelemetryEvent
}

const stableKeyPattern = /^[a-z][a-z0-9._-]{0,63}$/u
const clientIdStorageKey = 'synapse.drive.telemetry.client-id'
const sessionIdStorageKey = 'synapse.drive.telemetry.session-id'
const flushThreshold = 20
const batchLimit = 50
const queueLimit = 500
const flushDelayMs = 5_000
const sampleIntervalMs = 1_000
const storedIdPattern = /^[A-Za-z0-9_-]{1,64}$/u
const highFrequencyActions = new Set<DriveTelemetryAction>(['change', 'scroll'])
const queue: QueuedDriveTelemetryEvent[] = []
const sampledEvents = new Map<string, { readonly queued: QueuedDriveTelemetryEvent; readonly timer: number }>()
let flushTimer: number | null = null
let flushInFlight: Promise<void> | null = null
let lifecycleInstalled = false
let fallbackClientId: string | null = null
let fallbackSessionId: string | null = null

export function trackDriveEvent(details: DriveTelemetryDetails): void {
  try {
    const queued = createDriveTelemetryEvent(details)
    if (!queued) return
    installLifecycleFlush()

    if (highFrequencyActions.has(details.action)) {
      sampleDriveEvent(queued)
      return
    }

    enqueueDriveEvent(queued)
  } catch {
    return
  }
}

export function startDriveOperation(
  eventKey: string,
  component = 'drive-api',
): (outcome: DriveTelemetryOutcome) => void {
  const startedAt = nowMilliseconds()
  let completed = false
  return (outcome) => {
    if (completed) return
    completed = true
    trackDriveEvent({
      eventKey,
      component,
      action: 'complete',
      category: 'operation',
      outcome,
      durationMs: nowMilliseconds() - startedAt,
    })
  }
}

export function flushDriveTelemetry(): void {
  try {
    drainSampledEvents()
    if (flushInFlight || queue.length === 0) return
    if (flushTimer !== null) window.clearTimeout(flushTimer)
    flushTimer = null
    const batch = takeEligibleBatch()
    if (batch.length === 0) return
    flushInFlight = sendClientTelemetryBatch({ events: batch.map((entry) => entry.event) })
      .catch(() => undefined)
      .finally(() => {
        flushInFlight = null
        if (queue.length > 0 && flushTimer === null) scheduleFlush(flushDelayMs)
      })
  } catch {
    return
  }
}

export function resetDriveTelemetryForTests(): void {
  queue.splice(0)
  for (const pending of sampledEvents.values()) window.clearTimeout(pending.timer)
  sampledEvents.clear()
  if (flushTimer !== null) window.clearTimeout(flushTimer)
  flushTimer = null
  flushInFlight = null
  fallbackClientId = null
  fallbackSessionId = null
}

function createDriveTelemetryEvent(details: DriveTelemetryDetails): QueuedDriveTelemetryEvent | null {
  if (!stableKeyPattern.test(details.eventKey) || !stableKeyPattern.test(details.component)) return null
  return {
    accountSessionId: currentAccountSessionId(),
    event: {
      eventId: createId(),
      category: details.category ?? 'interaction',
      eventKey: details.eventKey,
      component: details.component,
      action: details.action,
      ...(details.outcome ? { outcome: details.outcome } : {}),
      ...(typeof details.durationMs === 'number' && Number.isFinite(details.durationMs)
        ? { durationMs: Math.max(0, Math.round(details.durationMs)) }
        : {}),
      moduleId: 'drive',
      windowType: 'web-drive',
      clientInstanceId: getClientInstanceId(),
      sessionId: getSessionId(),
      appVersion: normalizeAppVersion(import.meta.env.VITE_APP_VERSION),
      platform: 'web',
      occurredAt: new Date().toISOString(),
    },
  }
}

function sampleDriveEvent(queued: QueuedDriveTelemetryEvent): void {
  const samplingKey = `${queued.event.eventKey}:${queued.event.action}`
  const current = sampledEvents.get(samplingKey)
  if (current) {
    sampledEvents.set(samplingKey, { queued, timer: current.timer })
    return
  }
  const timer = window.setTimeout(() => {
    try {
      const latest = sampledEvents.get(samplingKey)
      if (!latest) return
      sampledEvents.delete(samplingKey)
      enqueueDriveEvent(latest.queued)
    } catch {
      sampledEvents.delete(samplingKey)
    }
  }, sampleIntervalMs)
  sampledEvents.set(samplingKey, { queued, timer })
}

function drainSampledEvents(): void {
  for (const pending of sampledEvents.values()) {
    window.clearTimeout(pending.timer)
    queue.push(pending.queued)
  }
  sampledEvents.clear()
  trimQueue()
}

function enqueueDriveEvent(queued: QueuedDriveTelemetryEvent): void {
  queue.push(queued)
  trimQueue()
  if (queue.length >= flushThreshold) {
    flushDriveTelemetry()
    return
  }
  scheduleFlush(flushDelayMs)
}

function trimQueue(): void {
  if (queue.length > queueLimit) queue.splice(0, queue.length - queueLimit)
}

function takeEligibleBatch(): QueuedDriveTelemetryEvent[] {
  const accountSessionId = currentAccountSessionId()
  const eligible: QueuedDriveTelemetryEvent[] = []
  const remaining: QueuedDriveTelemetryEvent[] = []
  for (const entry of queue) {
    if (entry.accountSessionId !== accountSessionId) continue
    if (eligible.length < batchLimit) eligible.push(entry)
    else remaining.push(entry)
  }
  queue.splice(0, queue.length, ...remaining)
  return eligible
}

function scheduleFlush(delayMs: number): void {
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flushDriveTelemetry()
  }, delayMs)
}

function installLifecycleFlush(): void {
  if (lifecycleInstalled) return
  lifecycleInstalled = true
  window.addEventListener('pagehide', flushWithBeacon)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushWithBeacon()
  })
}

function flushWithBeacon(): void {
  let batch: QueuedDriveTelemetryEvent[] = []
  try {
    drainSampledEvents()
    if (queue.length === 0 || typeof navigator.sendBeacon !== 'function') {
      flushDriveTelemetry()
      return
    }
    batch = takeEligibleBatch()
    if (batch.length === 0) return
    const body = new Blob([JSON.stringify({ events: batch.map((entry) => entry.event) })], { type: 'application/json' })
    if (navigator.sendBeacon('/api/client-telemetry/events', body)) {
      return
    }
    queue.unshift(...batch)
    trimQueue()
  } catch {
    if (batch.length > 0) {
      queue.unshift(...batch)
      trimQueue()
    }
    return
  }
}

function getClientInstanceId(): string {
  if (fallbackClientId) return fallbackClientId
  try {
    fallbackClientId = readOrCreateStorageId(window.localStorage, clientIdStorageKey)
  } catch {
    fallbackClientId = createId()
  }
  return fallbackClientId
}

function getSessionId(): string {
  if (fallbackSessionId) return fallbackSessionId
  try {
    fallbackSessionId = readOrCreateStorageId(window.sessionStorage, sessionIdStorageKey)
  } catch {
    fallbackSessionId = createId()
  }
  return fallbackSessionId
}

function readOrCreateStorageId(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key)
    if (existing && storedIdPattern.test(existing)) return existing
    const created = createId()
    storage.setItem(key, created)
    return created
  } catch {
    return createId()
  }
}

function createId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

function normalizeAppVersion(value: unknown): string {
  if (typeof value !== 'string') return 'web'
  const normalized = value.replace(/[^A-Za-z0-9.+_-]/gu, '-').slice(0, 32)
  return normalized || 'web'
}

function nowMilliseconds(): number {
  try {
    return typeof performance === 'undefined' ? Date.now() : performance.now()
  } catch {
    return Date.now()
  }
}

function currentAccountSessionId(): string | null {
  try {
    return useAuthStore.getState().auth.user?.sessionId ?? null
  } catch {
    return null
  }
}
