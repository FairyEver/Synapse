/**
 * Phase 0.4 — EventBus core implementation.
 * SPEC §7.
 *
 * In-process pub/sub with:
 *   - per-domain listeners (`on(domain)`)
 *   - per-(domain,type) listeners (`onType(domain, type)`)
 *   - coalesce and queued backpressure (T4.3)
 *   - optional WindowManager broadcaster injection (T4.2)
 *   - listener-error isolation: throwing listeners don't poison siblings
 *
 * IPC channel scheme: each domain maps to `synapse:app:events:operation:<domain>`. Renderer
 * subscribes to the channel via the EventBusClient (T4.4).
 */

import type {
  BackpressurePolicy,
  DomainEvent,
  EventBroadcaster,
  EventBus,
  EventBusEmitOptions,
  EventDomain,
  EventListener,
  Unsubscribe,
} from "./types"
import { buildKey, makeUnrefTimeout } from "../lib"
import { ConsoleSink, createLogger } from "../logging"

const DEFAULT_COALESCE_WINDOW_MS = 16
const DEFAULT_QUEUE_SIZE = 100
const listenerLogger = createLogger({ module: "runtime.event-bus", sink: new ConsoleSink() })

export interface EventBusOptions {
  /** Optional bridge to WindowManager (or any other broadcaster). */
  readonly broadcaster?: EventBroadcaster | null
  /** Default backpressure policy when `emit()` doesn't override. */
  readonly defaultBackpressure?: BackpressurePolicy
}

interface ListenerEntry {
  readonly id: number
  readonly listener: EventListener
  readonly typeFilter?: string
}

interface QueueSlot {
  queue: DomainEvent[]
  cancel: (() => void) | null
}

export class EventBusImpl implements EventBus {
  private readonly listenersByDomain = new Map<EventDomain, ListenerEntry[]>()
  private nextListenerId = 1
  private readonly broadcaster: EventBroadcaster | null
  private readonly defaultBackpressure: BackpressurePolicy
  /** Per-coalesce-key timer state. `cancel` stops the underlying setTimeout. */
  private readonly coalesceTimers = new Map<
    string,
    { cancel: () => void; latestEvent: DomainEvent; options: EventBusEmitOptions }
  >()
  private readonly backpressureQueues = new Map<string, QueueSlot>()

  constructor(options: EventBusOptions = {}) {
    this.broadcaster = options.broadcaster ?? null
    this.defaultBackpressure = options.defaultBackpressure ?? "coalesce"
  }

  on<D extends EventDomain>(domain: D, listener: EventListener<D>): Unsubscribe {
    return this.subscribe(domain, listener as EventListener)
  }

  onType<D extends EventDomain, T extends string>(
    domain: D,
    type: T,
    listener: (event: DomainEvent<D, T>) => void,
  ): Unsubscribe {
    return this.subscribe(domain, listener as EventListener, type)
  }

  emit<D extends EventDomain>(event: DomainEvent<D>, options: EventBusEmitOptions = {}): void {
    const policy = options.backpressure ?? this.defaultBackpressure
    switch (policy) {
      case "coalesce":
        this.coalesce(event, options)
        return
      case "block":
      case "drop-newest":
      case "drop-oldest":
        this.enqueue(event, policy, options)
        return
    }
  }

  emitInternal<D extends EventDomain>(event: DomainEvent<D>): void {
    this.notifyLocalListeners(event)
  }

  private subscribe(
    domain: EventDomain,
    listener: EventListener,
    typeFilter?: string,
  ): Unsubscribe {
    const entries = this.listenersByDomain.get(domain) ?? []
    const id = this.nextListenerId++
    entries.push({ id, listener, typeFilter })
    this.listenersByDomain.set(domain, entries)
    return () => {
      const list = this.listenersByDomain.get(domain)
      if (!list) return
      const next = list.filter((entry) => entry.id !== id)
      if (next.length === 0) {
        this.listenersByDomain.delete(domain)
      } else {
        this.listenersByDomain.set(domain, next)
      }
    }
  }

  private dispatch(event: DomainEvent): void {
    this.notifyLocalListeners(event)
    if (this.broadcaster) {
      const channel = channelForDomain(event.domain)
      try {
        this.broadcaster.broadcast(event, channel)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[event-bus:${event.domain}] broadcaster threw`, err)
      }
    }
  }

  private notifyLocalListeners(event: DomainEvent): void {
    const entries = this.listenersByDomain.get(event.domain)
    if (!entries) return
    // Snapshot for safe iteration when listeners unsubscribe during dispatch.
    for (const entry of [...entries]) {
      if (entry.typeFilter && entry.typeFilter !== event.type) continue
      try {
        entry.listener(event)
      } catch (err) {
        listenerLogger.error("EventBus listener threw.", {
          domain: event.domain,
          type: event.type,
          error: err,
        })
      }
    }
  }

  private coalesce(event: DomainEvent, options: EventBusEmitOptions): void {
    const window = options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS
    const key = coalesceKey(event)
    const existing = this.coalesceTimers.get(key)
    if (existing) {
      // Replace the latest event; the timer keeps ticking.
      existing.latestEvent = event
      return
    }
    const cancel = makeUnrefTimeout(window, () => {
      const slot = this.coalesceTimers.get(key)
      if (!slot) return
      this.coalesceTimers.delete(key)
      this.dispatch(slot.latestEvent)
    })
    this.coalesceTimers.set(key, { cancel, latestEvent: event, options })
  }

  private enqueue(event: DomainEvent, policy: Exclude<BackpressurePolicy, "coalesce">, options: EventBusEmitOptions): void {
    const key = options.orderingKey ?? coalesceKey(event)
    const slot = this.backpressureQueues.get(key) ?? { queue: [], cancel: null }
    const maxQueueSize = normalizeQueueSize(options.maxQueueSize)

    if (slot.queue.length >= maxQueueSize) {
      if (policy === "drop-newest") return
      if (policy === "drop-oldest") {
        slot.queue.shift()
      } else {
        const next = slot.queue.shift()
        if (next) this.dispatch(next)
      }
    }

    slot.queue.push(event)
    this.backpressureQueues.set(key, slot)
    this.scheduleQueuedDispatch(key, slot)
  }

  private scheduleQueuedDispatch(key: string, slot: QueueSlot): void {
    if (slot.cancel) return
    slot.cancel = makeUnrefTimeout(0, () => {
      slot.cancel = null
      const next = slot.queue.shift()
      if (next) this.dispatch(next)
      if (slot.queue.length > 0) {
        this.scheduleQueuedDispatch(key, slot)
      } else {
        this.backpressureQueues.delete(key)
      }
    })
  }

  /**
   * Test helper: cancel all pending timers and synchronously dispatch their
   * latest/queued events. Snapshot the slots first so a listener
   * that re-emits during dispatch can't observe a half-cleared map.
   */
  flushAllForTests(): void {
    const slots = [...this.coalesceTimers.values()]
    this.coalesceTimers.clear()
    for (const slot of slots) {
      slot.cancel()
      this.dispatch(slot.latestEvent)
    }
    const queuedSlots = [...this.backpressureQueues.values()]
    this.backpressureQueues.clear()
    for (const slot of queuedSlots) {
      slot.cancel?.()
      slot.cancel = null
      for (const event of slot.queue.splice(0)) {
        this.dispatch(event)
      }
    }
  }
}

export function channelForDomain(domain: EventDomain): string {
  return `synapse:app:events:operation:${domain.replaceAll("-", "_")}`
}

function coalesceKey(event: DomainEvent): string {
  return buildKey([
    event.domain,
    event.type,
    event.scope?.projectId,
    event.scope?.sessionId,
    event.scope?.repositoryId,
  ])
}

function normalizeQueueSize(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : DEFAULT_QUEUE_SIZE
}

export function createEventBus(options?: EventBusOptions): EventBusImpl {
  return new EventBusImpl(options)
}
