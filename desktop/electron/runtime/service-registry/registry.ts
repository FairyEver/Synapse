/**
 * Phase 0.1 — ServiceRegistry runtime.
 * SPEC §4.
 */

import {
  DuplicateServiceError,
  FatalServiceFailureError,
  ServiceNotFoundError,
  ServiceNotRunningError,
  ServiceStopTimeoutError,
} from "./errors"
import { descriptorAsNode, reverseTopoSort, topoSort } from "./topo"
import type {
  DegradedServiceFailure,
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
  /** Returns a per-startAll context. Called once and cached for the run. */
  readonly contextProvider: (registry: ServiceRegistry) => ServiceContext
  /** SPEC §4: per-service stop timeout default 5000ms; tests override. */
  readonly perServiceStopTimeoutMs?: number
}

const DEFAULT_PER_SERVICE_STOP_TIMEOUT_MS = 5000

export class ServiceRegistryImpl implements ServiceRegistry {
  protected readonly entries = new Map<string, RegistryEntry>()
  protected readonly order: string[] = []
  protected readonly contextProvider: (registry: ServiceRegistry) => ServiceContext
  protected readonly perServiceStopTimeoutMs: number
  protected sealed = false
  protected cachedContext: ServiceContext | null = null

  constructor(options: ServiceRegistryOptions) {
    this.contextProvider = options.contextProvider
    this.perServiceStopTimeoutMs =
      options.perServiceStopTimeoutMs ?? DEFAULT_PER_SERVICE_STOP_TIMEOUT_MS
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
      const entry = this.requireEntry(id)
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

  planStartOrder(): readonly ServiceDescriptor<unknown>[] {
    const nodes = this.order.map((id) => descriptorAsNode(this.requireEntry(id).descriptor))
    const sorted = topoSort(nodes)
    return sorted.map((n) => this.requireEntry(n.id).descriptor)
  }

  async startAll(): Promise<StartAllResult> {
    this.sealed = true
    const order = this.planStartOrder()
    const context = this.getContext()

    const degraded: DegradedServiceFailure[] = []
    const failedFatalIds = new Set<string>()
    const failedOrSkippedIds = new Set<string>()

    for (const descriptor of order) {
      const entry = this.requireEntry(descriptor.id)

      // If any of this service's deps failed (fatal-failed or degraded-failed),
      // propagate.
      const depFailed = (descriptor.dependsOn ?? []).some((dep) =>
        failedOrSkippedIds.has(dep),
      )
      if (depFailed) {
        const cause = new Error(`dependency failed for "${descriptor.id}"`)
        entry.status = "failed"
        entry.lastError = cause
        if (descriptor.criticality === "fatal") {
          failedFatalIds.add(descriptor.id)
          failedOrSkippedIds.add(descriptor.id)
          throw new FatalServiceFailureError(descriptor.id, "create", cause)
        }
        failedOrSkippedIds.add(descriptor.id)
        degraded.push({ id: descriptor.id, error: cause })
        continue
      }

      entry.status = "starting"
      try {
        const instance = await descriptor.create(context)
        entry.instance = instance
        if (descriptor.start) {
          await descriptor.start(instance, context)
        }
        entry.status = "running"
        entry.startedAt = Date.now()
      } catch (rawErr) {
        const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr))
        entry.status = "failed"
        entry.lastError = err
        if (descriptor.criticality === "fatal") {
          failedFatalIds.add(descriptor.id)
          failedOrSkippedIds.add(descriptor.id)
          throw new FatalServiceFailureError(
            descriptor.id,
            entry.instance === undefined ? "create" : "start",
            err,
          )
        }
        failedOrSkippedIds.add(descriptor.id)
        degraded.push({ id: descriptor.id, error: err })
      }
    }

    return { degraded }
  }

  async stopAll(timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) {
      throw new Error("stopAll timeoutMs must be > 0")
    }

    // Reverse topo order, but include any partially-running services.
    let order: ServiceDescriptor<unknown>[]
    try {
      order = [...reverseTopoSort(this.order.map((id) => descriptorAsNode(this.requireEntry(id).descriptor)))].map(
        (n) => this.requireEntry(n.id).descriptor,
      )
    } catch {
      // If the graph is invalid (shouldn't happen after startAll, but be defensive),
      // fall back to insertion-order reverse.
      order = [...this.order].reverse().map((id) => this.requireEntry(id).descriptor)
    }

    const context = this.getContext()
    const deadline = Date.now() + timeoutMs
    const perServiceTimeout = this.perServiceStopTimeoutMs

    for (const descriptor of order) {
      const entry = this.requireEntry(descriptor.id)
      if (entry.status !== "running" && entry.status !== "starting") {
        // Already stopped/failed/pending. Mark stopped if it was created but never started.
        if (entry.instance !== undefined && entry.status !== "stopped") {
          entry.status = "stopped"
        }
        continue
      }

      const remaining = Math.max(0, deadline - Date.now())
      const limit = Math.min(perServiceTimeout, remaining || perServiceTimeout)

      try {
        if (descriptor.stop && entry.instance !== undefined) {
          await runWithTimeout(
            () => Promise.resolve(descriptor.stop!(entry.instance, context, limit)),
            limit,
            () => new ServiceStopTimeoutError(descriptor.id, limit),
          )
        }
        entry.status = "stopped"
      } catch (rawErr) {
        const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr))
        entry.status = "failed"
        entry.lastError = err
        // SPEC §4: stop errors are logged but never re-thrown — they must not
        // block other services from shutting down. The caller can inspect()
        // afterwards.
      }
    }
  }

  async reload(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) {
      throw new ServiceNotFoundError(id)
    }
    if (entry.status !== "running") {
      throw new ServiceNotRunningError(id, entry.status)
    }
    if (!entry.descriptor.reload) {
      throw new Error(`Service "${id}" does not declare reload()`)
    }
    const context = this.getContext()
    await entry.descriptor.reload(entry.instance, context)
  }

  // -------- helpers ----------------------------------------------------

  protected requireEntry(id: string): RegistryEntry {
    const entry = this.entries.get(id)
    if (!entry) {
      throw new Error(`registry order/entries out of sync at id="${id}"`)
    }
    return entry
  }

  protected getContext(): ServiceContext {
    if (!this.cachedContext) {
      this.cachedContext = this.contextProvider(this)
    }
    return this.cachedContext
  }
}

async function runWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  buildTimeoutError: () => Error,
): Promise<T> {
  if (timeoutMs <= 0) {
    throw buildTimeoutError()
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(buildTimeoutError()), timeoutMs)
    // Avoid keeping the event loop alive for tests.
    if (timer && typeof timer.unref === "function") timer.unref()
  })
  try {
    return await Promise.race([fn(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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
  return new ServiceRegistryImpl({
    contextProvider,
    perServiceStopTimeoutMs: options?.perServiceStopTimeoutMs,
  })
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
