/**
 * Phase 0.1 — ServiceRegistry runtime.
 * SPEC §4.
 *
 * T1.3 lands register/inspect/get/has/planStartOrder.
 * T1.4 will land startAll/stopAll/reload on top of these primitives.
 */

import {
  DuplicateServiceError,
  ServiceNotFoundError,
  ServiceNotRunningError,
} from "./errors"
import { descriptorAsNode, topoSort } from "./topo"
import type {
  ServiceContext,
  ServiceDescriptor,
  ServiceInspectEntry,
  ServiceProcessKind,
  ServiceRegistry,
  ServiceStatus,
  StartAllResult,
} from "./types"

export interface RegistryEntry {
  readonly descriptor: ServiceDescriptor<unknown>
  status: ServiceStatus
  instance?: unknown
  lastError?: Error
  startedAt?: number
}

export interface ServiceRegistryOptions {
  /** Injected when starting; allows tests to provide stub context. */
  readonly contextProvider: (registry: ServiceRegistry) => ServiceContext
}

export class ServiceRegistryImpl implements ServiceRegistry {
  protected readonly entries = new Map<string, RegistryEntry>()
  /** Insertion order — Kahn's tie-breaks on this. */
  protected readonly order: string[] = []
  protected readonly contextProvider: (registry: ServiceRegistry) => ServiceContext
  protected sealed = false

  constructor(options: ServiceRegistryOptions) {
    this.contextProvider = options.contextProvider
  }

  register<T>(descriptor: ServiceDescriptor<T>): void {
    if (this.sealed) {
      throw new Error(
        `ServiceRegistry is sealed; cannot register "${descriptor.id}" after startAll() began`,
      )
    }
    if (!descriptor.id || typeof descriptor.id !== "string") {
      throw new Error("ServiceDescriptor.id is required and must be a non-empty string")
    }
    if (this.entries.has(descriptor.id)) {
      throw new DuplicateServiceError(descriptor.id)
    }
    this.entries.set(descriptor.id, {
      descriptor: descriptor as ServiceDescriptor<unknown>,
      status: "pending",
    })
    this.order.push(descriptor.id)
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  get<T>(id: string): T {
    const entry = this.entries.get(id)
    if (!entry) {
      throw new ServiceNotFoundError(id)
    }
    if (entry.status !== "running") {
      throw new ServiceNotRunningError(id, entry.status)
    }
    return entry.instance as T
  }

  inspect(): readonly ServiceInspectEntry[] {
    return this.order.map((id) => {
      const entry = this.entries.get(id)
      if (!entry) {
        throw new Error(`registry order/entries out of sync at id="${id}"`)
      }
      const runIn: ServiceProcessKind = entry.descriptor.runIn ?? "main"
      return {
        id,
        status: entry.status,
        criticality: entry.descriptor.criticality,
        dependsOn: entry.descriptor.dependsOn ?? [],
        runIn,
        lastError: entry.lastError,
      }
    })
  }

  /**
   * Validate dependency graph (no instantiation). Throws
   * CircularDependencyError / UnknownDependencyError on bad graphs.
   * Returns descriptors in start order (deps first).
   */
  planStartOrder(): readonly ServiceDescriptor<unknown>[] {
    const nodes = this.order.map((id) => {
      const entry = this.entries.get(id)
      if (!entry) {
        throw new Error(`registry order/entries out of sync at id="${id}"`)
      }
      return descriptorAsNode(entry.descriptor)
    })
    const sorted = topoSort(nodes)
    return sorted.map((n) => {
      const entry = this.entries.get(n.id)
      if (!entry) {
        throw new Error(`registry order/entries out of sync at id="${n.id}"`)
      }
      return entry.descriptor
    })
  }

  /** T1.4 lands the real impl. T1.3 stub keeps the interface complete. */
  async startAll(): Promise<StartAllResult> {
    throw new Error("ServiceRegistry.startAll not implemented (T1.4)")
  }

  async stopAll(timeoutMs: number): Promise<void> {
    void timeoutMs
    throw new Error("ServiceRegistry.stopAll not implemented (T1.4)")
  }

  async reload(id: string): Promise<void> {
    void id
    throw new Error("ServiceRegistry.reload not implemented (T1.4)")
  }

  // -------- protected helpers for T1.4 ---------------------------------

  protected getEntry(id: string): RegistryEntry | undefined {
    return this.entries.get(id)
  }

  protected setStatus(id: string, status: ServiceStatus, error?: Error): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.status = status
    if (error) entry.lastError = error
  }

  protected listEntries(): RegistryEntry[] {
    return this.order.map((id) => {
      const entry = this.entries.get(id)
      if (!entry) {
        throw new Error(`registry order/entries out of sync at id="${id}"`)
      }
      return entry
    })
  }

  protected seal(): void {
    this.sealed = true
  }

  protected getContext(): ServiceContext {
    return this.contextProvider(this)
  }
}

/**
 * Factory used by tests and (later) by buildServiceRegistry in main.ts.
 * Falls back to a noop context if the caller does not provide one — the
 * registry only invokes contextProvider during startAll.
 */
export function createServiceRegistry(
  options?: Partial<ServiceRegistryOptions>,
): ServiceRegistryImpl {
  const contextProvider =
    options?.contextProvider ??
    ((registry: ServiceRegistry): ServiceContext => ({
      logger: createNullLogger(),
      dataRepo: { __placeholder: undefined },
      eventBus: { __placeholder: undefined },
      registry,
      metrics: { __placeholder: undefined },
      tracer: { __placeholder: undefined },
      permissionGuard: { __placeholder: undefined },
      processRuntime: { __placeholder: undefined },
    }))
  return new ServiceRegistryImpl({ contextProvider })
}

function createNullLogger(): ServiceContext["logger"] {
  const noop = () => {
    /* intentional no-op for skeleton */
  }
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  }
  return logger
}

export { createNullLogger as _createNullLoggerForTests }
