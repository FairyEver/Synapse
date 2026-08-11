/**
 * Phase 0.4 — EventBus public types.
 * SPEC §7.
 */

export type EventDomain =
  | "account"
  | "live"
  | "repository"
  | "content"
  | "update"
  | "database"
  | "agent"      // M1
  | "connector"  // M3
  | "scheduler"  // M4
  | "automation"
  | "knowledge-base"
  | "project"    // Phase 0.5
  | "system"     // handshake / lifecycle
  | "install-status"
  | "workflow"
  | "git"
  | "cheat-code"

export interface EventScope {
  readonly projectId?: string
  readonly sessionId?: string
  readonly repositoryId?: string
}

export interface DomainEvent<
  D extends EventDomain = EventDomain,
  T extends string = string,
  P = unknown,
> {
  readonly domain: D
  readonly type: T
  readonly payload: P
  readonly timestamp: string
  readonly scope?: EventScope
}

export type EventListener<D extends EventDomain = EventDomain> = (
  event: DomainEvent<D>,
) => void

export type Unsubscribe = () => void

export type BackpressurePolicy =
  | "drop-oldest"
  | "drop-newest"
  | "coalesce"
  | "block"

export interface EventBusEmitOptions {
  readonly backpressure?: BackpressurePolicy
  /** Queued events with the same key share one FIFO even when their domain event types differ. */
  readonly orderingKey?: string
  /** Default 16ms (~60fps). Only consumed when backpressure === "coalesce". */
  readonly coalesceWindowMs?: number
  /** Per-ordering-key queue cap; >cap follows `backpressure`. */
  readonly maxQueueSize?: number
}

export interface EventBus {
  on<D extends EventDomain>(domain: D, listener: EventListener<D>): Unsubscribe
  onType<D extends EventDomain, T extends string>(
    domain: D,
    type: T,
    listener: (event: DomainEvent<D, T>) => void,
  ): Unsubscribe
  /** Emits to in-process listeners + (Phase 0.4 T4.2) WindowManager broadcast. */
  emit<D extends EventDomain>(event: DomainEvent<D>, options?: EventBusEmitOptions): void
  /** Emits only to in-process listeners — does NOT cross to renderer windows. */
  emitInternal<D extends EventDomain>(event: DomainEvent<D>): void
}

/**
 * Bridge interface: T4.2 wires this to WindowManager so EventBus can broadcast
 * cross-window events. The interface exists in T4.1 as a clean dependency
 * injection seam.
 */
export interface EventBroadcaster {
  broadcast(event: DomainEvent, channel: string): number
}

/**
 * EventBusBridge (SPEC §15.3): future cross-process mirror. T4.7 publishes
 * the interface; T0.5 process-runtime work picks it up later.
 */
export interface EventFilter {
  readonly domains?: readonly EventDomain[]
  readonly scope?: EventScope
}

export interface EventBusBridge {
  bridge(source: EventBus, target: EventBus, filter?: EventFilter): Unsubscribe
}

/**
 * EventRecorder (SPEC §15.12): dev-only event recorder. T4.7 publishes the
 * interface for the DebugPanel.
 */
export interface RecordingHandle {
  readonly id: string
  readonly startedAt: string
}

export interface RecordingArtifact {
  readonly id: string
  readonly events: readonly DomainEvent[]
  readonly capturedAt: string
}

export interface EventRecorder {
  startRecording(filter?: EventFilter): RecordingHandle
  stopRecording(handle: RecordingHandle): Promise<RecordingArtifact>
  replay(artifact: RecordingArtifact, speed: number): Promise<void>
}
