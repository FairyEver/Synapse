/**
 * Phase 0.2 — LayeredConfig minimal in-memory implementation.
 * SPEC §15.8.
 *
 * Resolution order: defaults < global < repository < project < session.
 * The framework is intentionally minimal — full persistent layering lands in
 * M1/M2 once we know which fields actually need scope-specific overrides.
 *
 * Phase 0 scope: structure-only behaviour with watch notifications. No on-disk
 * persistence; consumers compose this with a DataNamespace<T> for any layer
 * that should survive restarts.
 */

import { ConsoleSink, createLogger } from "../logging"
import type { ConfigScope, LayeredConfig } from "./types"

const layeredConfigLogger = createLogger({ module: "runtime.data-repo.layered-config", sink: new ConsoleSink() })

type ScopeLayer<T> =
  | { kind: "global"; value: Partial<T> }
  | { kind: "repository"; repositoryId: string; value: Partial<T> }
  | { kind: "project"; projectId: string; value: Partial<T> }
  | { kind: "session"; sessionId: string; value: Partial<T> }

type ResolvedListener<T> = (value: T) => void

interface ListenerEntry<T> {
  readonly scope: ConfigScope
  readonly listener: ResolvedListener<T>
}

export class InMemoryLayeredConfig<T extends Record<string, unknown>>
  implements LayeredConfig<T>
{
  readonly defaults: T
  private readonly layers: ScopeLayer<T>[] = []
  private readonly listeners = new Set<ListenerEntry<T>>()

  constructor(defaults: T) {
    this.defaults = defaults
  }

  async resolveFor(scope: ConfigScope): Promise<T> {
    const merged: Record<string, unknown> = { ...(this.defaults as Record<string, unknown>) }

    const apply = (layer: ScopeLayer<T> | undefined) => {
      if (!layer) return
      Object.assign(merged, layer.value as Record<string, unknown>)
    }

    apply(this.layers.find((l) => l.kind === "global") as ScopeLayer<T>)
    if (scope.repositoryId) {
      apply(
        this.layers.find(
          (l) => l.kind === "repository" && l.repositoryId === scope.repositoryId,
        ) as ScopeLayer<T>,
      )
    }
    if (scope.projectId) {
      apply(
        this.layers.find(
          (l) => l.kind === "project" && l.projectId === scope.projectId,
        ) as ScopeLayer<T>,
      )
    }
    if (scope.sessionId) {
      apply(
        this.layers.find(
          (l) => l.kind === "session" && l.sessionId === scope.sessionId,
        ) as ScopeLayer<T>,
      )
    }

    return merged as T
  }

  async setAt(scope: ConfigScope, patch: Partial<T>): Promise<void> {
    const layer = this.layerFor(scope)
    const existing = this.layers.find((l) => sameLayerKey(l, layer))
    if (existing) {
      existing.value = { ...existing.value, ...patch }
    } else {
      this.layers.push({ ...layer, value: { ...patch } } as ScopeLayer<T>)
    }
    await this.notifyMatching(scope)
  }

  watchResolved(scope: ConfigScope, listener: ResolvedListener<T>): () => void {
    const entry: ListenerEntry<T> = { scope, listener }
    this.listeners.add(entry)
    return () => {
      this.listeners.delete(entry)
    }
  }

  private layerFor(scope: ConfigScope): ScopeLayer<T> {
    if (scope.sessionId) return { kind: "session", sessionId: scope.sessionId, value: {} }
    if (scope.projectId) return { kind: "project", projectId: scope.projectId, value: {} }
    if (scope.repositoryId) return { kind: "repository", repositoryId: scope.repositoryId, value: {} }
    return { kind: "global", value: {} }
  }

  private async notifyMatching(scope: ConfigScope): Promise<void> {
    for (const entry of [...this.listeners]) {
      if (!scopeOverlaps(entry.scope, scope)) continue
      const value = await this.resolveFor(entry.scope)
      try {
        entry.listener(value)
      } catch (err) {
        layeredConfigLogger.error("LayeredConfig listener threw.", { error: err })
      }
    }
  }
}

function sameLayerKey<T>(a: ScopeLayer<T>, b: ScopeLayer<T>): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case "global":
      return true
    case "repository":
      return a.repositoryId === (b as { repositoryId: string }).repositoryId
    case "project":
      return a.projectId === (b as { projectId: string }).projectId
    case "session":
      return a.sessionId === (b as { sessionId: string }).sessionId
  }
}

function scopeOverlaps(watcher: ConfigScope, mutated: ConfigScope): boolean {
  // A watcher cares about the union of its scope; any change at a layer the
  // watcher would resolve through must trigger a notification.
  if (mutated.sessionId && watcher.sessionId === mutated.sessionId) return true
  if (mutated.projectId && watcher.projectId === mutated.projectId) return true
  if (mutated.repositoryId && watcher.repositoryId === mutated.repositoryId) return true
  // Global mutation always notifies everyone.
  return !mutated.sessionId && !mutated.projectId && !mutated.repositoryId
}
