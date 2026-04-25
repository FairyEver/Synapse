/**
 * Phase 0.5 — idle-reaper.
 * SPEC §8 "空闲回收（对齐 CC idle reaper）".
 *
 * Periodically scans open project containers; if a project has no recent
 * activity it gets `close()`-ed automatically. "Activity" is reported by
 * services through `markActive(projectId)`.
 */

import type { ProjectContainerRegistry } from "./types"
import { makeUnrefInterval } from "../lib"

export interface IdleReaperOptions {
  readonly idleTimeoutMs?: number
  readonly checkIntervalMs?: number
  readonly now?: () => number
}

export class IdleReaper {
  private readonly registry: ProjectContainerRegistry
  private readonly idleTimeoutMs: number
  private readonly checkIntervalMs: number
  private readonly now: () => number
  private readonly lastActiveAt = new Map<string, number>()
  private cancelTimer: (() => void) | null = null

  constructor(registry: ProjectContainerRegistry, options: IdleReaperOptions = {}) {
    this.registry = registry
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000
    this.now = options.now ?? Date.now
  }

  start(): void {
    if (this.cancelTimer) return
    this.cancelTimer = makeUnrefInterval(this.checkIntervalMs, () => {
      void this.sweep()
    })
  }

  stop(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  markActive(projectId: string): void {
    this.lastActiveAt.set(projectId, this.now())
  }

  /** Public for tests; production lets `start()` schedule it. */
  async sweep(): Promise<void> {
    const horizon = this.now() - this.idleTimeoutMs
    for (const entry of this.registry.list()) {
      const last = this.lastActiveAt.get(entry.projectId)
        ?? new Date(entry.openedAt).getTime()
      if (last < horizon) {
        await this.registry.close(entry.projectId)
        this.lastActiveAt.delete(entry.projectId)
      }
    }
  }
}

export function createIdleReaper(
  registry: ProjectContainerRegistry,
  options?: IdleReaperOptions,
): IdleReaper {
  return new IdleReaper(registry, options)
}
