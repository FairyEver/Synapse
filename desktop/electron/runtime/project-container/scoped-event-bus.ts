/**
 * Phase 0.5 — ScopedEventBus implementation.
 *
 * Auto-fills `scope.projectId` on every emit so listeners can rely on the
 * `event.scope.projectId` invariant.
 */

import type {
  DomainEvent,
  EventBus,
  EventDomain,
  EventScope,
  Unsubscribe,
} from "../event-bus/types"
import type { ScopedEventBus } from "./types"

export class ScopedEventBusImpl implements ScopedEventBus {
  readonly projectId: string
  readonly underlying: EventBus

  constructor(projectId: string, underlying: EventBus) {
    this.projectId = projectId
    this.underlying = underlying
  }

  emit<D extends EventDomain>(
    event: Omit<DomainEvent<D>, "scope"> & { scope?: Omit<EventScope, "projectId"> },
  ): void {
    const merged: DomainEvent<D> = {
      ...event,
      scope: {
        ...(event.scope ?? {}),
        projectId: this.projectId,
      },
    }
    this.underlying.emit(merged)
  }

  on<D extends EventDomain>(
    domain: D,
    listener: (event: DomainEvent<D>) => void,
  ): Unsubscribe {
    return this.underlying.on(domain, (event) => {
      if (event.scope?.projectId === this.projectId) {
        listener(event)
      }
    })
  }
}
