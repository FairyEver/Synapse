/**
 * Phase 0.2 — Abstract base implementation of DataNamespace.
 *
 * Concrete backends (T2.2..T2.5) extend this to inherit:
 *  - Listener management with safe error isolation.
 *  - Default emit() that timestamps and dispatches change events.
 *  - In-memory id-to-value indexing helpers (when the backend chooses to use them).
 *
 * Backends override the abstract `read*` / `write*` methods to do the real I/O.
 */

import type {
  BackendKind,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "./types"
import { ConsoleSink, createLogger } from "../logging"

const namespaceLogger = createLogger({ module: "runtime.data-repo.namespace", sink: new ConsoleSink() })

export interface NamespaceBaseDeps<T> {
  readonly name: string
  readonly schemaVersion: number
  readonly backend: BackendKind
  /** Optional initial value for getSingleton() before any write. */
  readonly defaults?: () => T
}

export abstract class AbstractDataNamespace<T> implements DataNamespace<T> {
  readonly name: string
  readonly schemaVersion: number
  readonly backend: BackendKind
  protected readonly defaults?: () => T
  protected readonly listeners = new Set<DataChangeListener<T>>()

  constructor(deps: NamespaceBaseDeps<T>) {
    this.name = deps.name
    this.schemaVersion = deps.schemaVersion
    this.backend = deps.backend
    this.defaults = deps.defaults
  }

  abstract getSingleton(): Promise<T | null>
  abstract setSingleton(value: T): Promise<void>
  abstract list(filter?: Partial<T>): Promise<T[]>
  abstract get(id: string): Promise<T | null>
  abstract upsert(item: T & { id: string }): Promise<void>
  abstract remove(id: string): Promise<void>

  async count(filter?: Partial<T>): Promise<number> {
    return (await this.list(filter)).length
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  protected emit(change: Omit<DataChangeEvent<T>, "namespace" | "timestamp">): void {
    const event: DataChangeEvent<T> = {
      namespace: this.name,
      timestamp: new Date().toISOString(),
      ...change,
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        namespaceLogger.error("Data repository listener threw.", { namespace: this.name, error })
      }
    }
  }

  /**
   * Helper to apply equality-based partial filtering. Backends can override
   * to push the filter into a real query language.
   */
  protected applyFilter(items: readonly T[], filter?: Partial<T>): T[] {
    if (!filter) return items.slice()
    const entries = Object.entries(filter) as Array<[string, unknown]>
    return items.filter((item) => {
      const record = item as Record<string, unknown>
      return entries.every(([key, expected]) => record[key] === expected)
    })
  }
}
