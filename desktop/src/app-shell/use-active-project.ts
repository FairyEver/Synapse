/**
 * Phase 0.5 — Active project hook for the renderer.
 * SPEC §8.
 *
 * Phase 0.5 only lands the hook + a tiny in-memory store. The real bridge
 * `synapse.projects.activate(...)` ships when ProjectContainer integration
 * lands in M1. The hook keeps a minimal client-side cache so UI components
 * can subscribe without each one re-creating the bridge.
 */

import { useCallback, useEffect, useState } from "react"

export interface ActiveProjectMetadata {
  readonly id: string
  readonly name: string
}

export interface ActiveProjectActions {
  activate: (projectId: string) => Promise<void>
  close: (projectId: string) => Promise<void>
}

export interface ActiveProjectBridge {
  getActive(): ActiveProjectMetadata | null
  subscribe(listener: (active: ActiveProjectMetadata | null) => void): () => void
  activate(projectId: string): Promise<void>
  close(projectId: string): Promise<void>
}

/**
 * In-memory active-project store. Useful for unit tests and as a sane default
 * when the IPC bridge hasn't been wired yet.
 */
export class InMemoryActiveProjectBridge implements ActiveProjectBridge {
  private active: ActiveProjectMetadata | null = null
  private readonly listeners = new Set<(active: ActiveProjectMetadata | null) => void>()
  private readonly metadataResolver: (id: string) => ActiveProjectMetadata

  constructor(
    metadataResolver: (id: string) => ActiveProjectMetadata = (id) => ({ id, name: id }),
  ) {
    this.metadataResolver = metadataResolver
  }

  getActive(): ActiveProjectMetadata | null {
    return this.active
  }

  subscribe(listener: (active: ActiveProjectMetadata | null) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async activate(projectId: string): Promise<void> {
    this.active = this.metadataResolver(projectId)
    this.notify()
  }

  async close(projectId: string): Promise<void> {
    if (this.active?.id === projectId) {
      this.active = null
      this.notify()
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.active)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[active-project] listener threw", err)
      }
    }
  }
}

let defaultBridge: ActiveProjectBridge = new InMemoryActiveProjectBridge()

export function setActiveProjectBridge(bridge: ActiveProjectBridge): void {
  defaultBridge = bridge
}

export function useActiveProject(): ActiveProjectMetadata | null {
  const [state, setState] = useState<ActiveProjectMetadata | null>(() => defaultBridge.getActive())
  useEffect(() => {
    return defaultBridge.subscribe(setState)
  }, [])
  return state
}

export function useActiveProjectActions(): ActiveProjectActions {
  return {
    activate: useCallback((projectId: string) => defaultBridge.activate(projectId), []),
    close: useCallback((projectId: string) => defaultBridge.close(projectId), []),
  }
}
