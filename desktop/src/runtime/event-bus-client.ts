/**
 * Phase 0.4 — Renderer-side EventBus client.
 * SPEC §7.
 *
 * Subscribers only see typed events; the IPC channel is opened lazily once
 * per domain. The transport is injected (default uses `window.synapse.events.*`
 * once T4.4 wires the preload bridge), so this file can also be unit-tested
 * with a stub transport.
 *
 * Phase 0.4 lands the client; the preload bridge surface
 * (`window.synapse.events.subscribe(channel, listener)`) is wired in the
 * follow-up PR that migrates the 5 existing event channels (T4.5/T4.6 — see
 * REPORT 3.2 deferral).
 */

import type {
  DomainEvent,
  EventDomain,
  EventScope,
  Unsubscribe,
} from "../../electron/runtime/event-bus/types"
import { channelForDomain } from "../../electron/runtime/event-bus/bus"

export interface EventBusTransport {
  /**
   * Subscribe to a raw IPC channel. The renderer-side bridge pushes
   * `DomainEvent` payloads here. Returns an unsubscribe.
   */
  subscribe(channel: string, listener: (event: DomainEvent) => void): Unsubscribe
}

export interface EventBusClient {
  on<D extends EventDomain>(
    domain: D,
    listener: (event: DomainEvent<D>) => void,
  ): Unsubscribe

  onType<D extends EventDomain, T extends string>(
    domain: D,
    type: T,
    listener: (event: DomainEvent<D, T>) => void,
  ): Unsubscribe

  onScoped<D extends EventDomain>(
    domain: D,
    scope: EventScope,
    listener: (event: DomainEvent<D>) => void,
  ): Unsubscribe
}

interface DomainSubscription {
  domain: EventDomain
  listeners: Set<(event: DomainEvent) => void>
  detach: Unsubscribe
}

export class EventBusClientImpl implements EventBusClient {
  private readonly transport: EventBusTransport
  private readonly domainSubs = new Map<EventDomain, DomainSubscription>()

  constructor(transport: EventBusTransport) {
    this.transport = transport
  }

  on<D extends EventDomain>(
    domain: D,
    listener: (event: DomainEvent<D>) => void,
  ): Unsubscribe {
    return this.subscribeFiltered(domain, listener as (event: DomainEvent) => void, () => true)
  }

  onType<D extends EventDomain, T extends string>(
    domain: D,
    type: T,
    listener: (event: DomainEvent<D, T>) => void,
  ): Unsubscribe {
    return this.subscribeFiltered(
      domain,
      listener as (event: DomainEvent) => void,
      (event) => event.type === type,
    )
  }

  onScoped<D extends EventDomain>(
    domain: D,
    scope: EventScope,
    listener: (event: DomainEvent<D>) => void,
  ): Unsubscribe {
    return this.subscribeFiltered(
      domain,
      listener as (event: DomainEvent) => void,
      (event) => scopeMatches(scope, event.scope),
    )
  }

  private subscribeFiltered(
    domain: EventDomain,
    listener: (event: DomainEvent) => void,
    predicate: (event: DomainEvent) => boolean,
  ): Unsubscribe {
    const sub = this.ensureDomainSub(domain)
    const wrapped = (event: DomainEvent) => {
      if (!predicate(event)) return
      try {
        listener(event)
      } catch (err) {
        // Renderer-side: log + continue. The main-process EventBus already
        // isolates server-side listener throws; this guards renderer ones.
        // eslint-disable-next-line no-console
        console.error(`[event-bus-client:${domain}] listener threw`, err)
      }
    }
    sub.listeners.add(wrapped)
    return () => {
      sub.listeners.delete(wrapped)
      if (sub.listeners.size === 0) {
        sub.detach()
        this.domainSubs.delete(domain)
      }
    }
  }

  private ensureDomainSub(domain: EventDomain): DomainSubscription {
    const existing = this.domainSubs.get(domain)
    if (existing) return existing

    const channel = channelForDomain(domain)
    const sub: DomainSubscription = {
      domain,
      listeners: new Set(),
      detach: () => {},
    }
    sub.detach = this.transport.subscribe(channel, (event) => {
      // Snapshot to allow listeners to unsubscribe themselves during dispatch.
      for (const listener of [...sub.listeners]) listener(event)
    })
    this.domainSubs.set(domain, sub)
    return sub
  }
}

function scopeMatches(want: EventScope, got: EventScope | undefined): boolean {
  if (!got) {
    // A scoped subscription only cares when the event also carries scope.
    return false
  }
  if (want.projectId && got.projectId !== want.projectId) return false
  if (want.sessionId && got.sessionId !== want.sessionId) return false
  if (want.repositoryId && got.repositoryId !== want.repositoryId) return false
  return true
}

export function createEventBusClient(transport: EventBusTransport): EventBusClient {
  return new EventBusClientImpl(transport)
}
