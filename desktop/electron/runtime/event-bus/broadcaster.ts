/**
 * Phase 0.4 — EventBus → WindowManager broadcaster.
 * SPEC §7 / §15.3.
 *
 * Adapts the EventBus EventBroadcaster contract to a WindowManager so events
 * cross from main → renderer through a single allowed `webContents.send`
 * chokepoint (per SPEC §1 hard rule #3, satisfied by WindowManager.broadcast).
 *
 * Optional scope filter: agent-domain events with `scope.projectId` only go
 * to windows whose `payload.projectId` matches (consumed in T0.5 once
 * ProjectContainer registers windows with project-scoped metadata).
 */

import type { ManagedWindow, WindowManager } from "../window"
import type { DomainEvent, EventBroadcaster } from "./types"

export interface WindowBroadcasterOptions {
  /**
   * Optional predicate to narrow down recipients per emit. Defaults to
   * sending to every alive window. Phase 0.5 ProjectContainer wires the
   * project-scope filter here.
   */
  readonly filter?: (event: DomainEvent, window: ManagedWindow) => boolean
}

export class WindowBroadcaster implements EventBroadcaster {
  private readonly windowManager: WindowManager
  private readonly filter?: (event: DomainEvent, window: ManagedWindow) => boolean

  constructor(windowManager: WindowManager, options: WindowBroadcasterOptions = {}) {
    this.windowManager = windowManager
    this.filter = options.filter
  }

  broadcast(event: DomainEvent, channel: string): number {
    const filter = this.filter
    return this.windowManager.broadcast(channel, event, filter ? (window) => filter(event, window) : undefined)
  }
}
