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
import { makeUnrefTimeout } from "../lib"
import { createDataRepository } from "../data-repo/repository"
import { createEventBus } from "../event-bus/bus"
import { createMetricsRegistry, createTracer } from "../observability"
import { createMainProcessRuntime } from "../process/runtime"
import {
  InMemoryAuditSink,
  createPermissionGuard,
} from "../security/permission-guard"
import type {
  DegradedServiceFailure,
  ServiceContext,
  ServiceDescriptor,
  ServiceInspectEntry,
  ServiceProcessKind,
  ServiceRegistry,
  ServiceStartupPhase,
  ServiceStatus,
  StartAllResult,
} from "./types"

export interface RegistryEntry {
  readonly descriptor: ServiceDescriptor<unknown>
  status: ServiceStatus
  instance?: unknown
  lastError?: Error
  startedAt?: number
  startupDurationMs?: number
}

export interface ServiceRegistryOptions {
  /** Returns a per-startAll context. Called once and cached for the run. */
  readonly contextProvider: (registry: ServiceRegistry) => ServiceContext
  /** SPEC §4: per-service stop timeout default 5000ms; tests override. */
  readonly perServiceStopTimeoutMs?: number
}

const DEFAULT_PER_SERVICE_STOP_TIMEOUT_MS = 5000
const MIN_STOP_TIMEOUT_AFTER_DEADLINE_MS = 100
const SLOW_SERVICE_START_MS = 1_000

export class ServiceRegistryImpl implements ServiceRegistry {
  protected readonly entries = new Map<string, RegistryEntry>()
  protected readonly order: string[] = []
  protected readonly contextProvider: (registry: ServiceRegistry) => ServiceContext
  protected readonly perServiceStopTimeoutMs: number
  protected sealed = false
  protected cachedContext: ServiceContext | null = null
  private blockingStartPromise: Promise<StartAllResult> | null = null
  private backgroundStartPromise: Promise<StartAllResult> | null = null
  private allStartPromise: Promise<StartAllResult> | null = null

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
        startupPhase: entry.descriptor.startupPhase ?? "blocking",
        dependsOn: entry.descriptor.dependsOn ?? [],
        startAfter: entry.descriptor.startAfter ?? [],
        runIn,
        startupDurationMs: entry.startupDurationMs,
        lastError: entry.lastError,
      }
    })
  }

  planStartOrder(): readonly ServiceDescriptor<unknown>[] {
    const nodes = this.order.map((id) => descriptorAsNode(this.requireEntry(id).descriptor))
    const sorted = topoSort(nodes)
    return sorted.map((n) => this.requireEntry(n.id).descriptor)
  }

  startBlocking(): Promise<StartAllResult> {
    this.blockingStartPromise ??= this.startPhase("blocking")
    return this.blockingStartPromise
  }

  startBackground(): Promise<StartAllResult> {
    this.backgroundStartPromise ??= (async () => {
      await this.startBlocking()
      return this.startPhase("background")
    })()
    return this.backgroundStartPromise
  }

  startAll(): Promise<StartAllResult> {
    this.allStartPromise ??= (async () => {
      const blocking = await this.startBlocking()
      const background = await this.startBackground()
      return { degraded: [...blocking.degraded, ...background.degraded] }
    })()
    return this.allStartPromise
  }

  private async startPhase(phase: ServiceStartupPhase): Promise<StartAllResult> {
    this.sealed = true
    const order = this.planStartOrder()
    const context = this.getContext()

    const degraded: DegradedServiceFailure[] = []
    const failedFatalIds = new Set<string>()
    const failedOrSkippedIds = new Set<string>()

    for (const descriptor of order) {
      if ((descriptor.startupPhase ?? "blocking") !== phase) continue
      const entry = this.requireEntry(descriptor.id)

      // Only hard dependency failures propagate. startAfter edges constrain
      // ordering without propagating a degraded failure through this edge.
      const depFailed = (descriptor.dependsOn ?? []).some((dep) =>
        failedOrSkippedIds.has(dep) || this.requireEntry(dep).status === "failed",
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
      const startTime = Date.now()
      context.logger.info("Service startup started.", {
        serviceId: descriptor.id,
        startupPhase: phase,
      })
      try {
        const instance = await descriptor.create(context)
        entry.instance = instance
        if (descriptor.start) {
          await descriptor.start(instance, context)
        }
        entry.status = "running"
        entry.startedAt = Date.now()
        entry.startupDurationMs = entry.startedAt - startTime
        const log = entry.startupDurationMs >= SLOW_SERVICE_START_MS
          ? context.logger.warn.bind(context.logger)
          : context.logger.info.bind(context.logger)
        log("Service startup completed.", {
          serviceId: descriptor.id,
          startupPhase: phase,
          durationMs: entry.startupDurationMs,
        })
      } catch (rawErr) {
        const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr))
        entry.status = "failed"
        entry.lastError = err
        entry.startupDurationMs = Date.now() - startTime
        context.logger.warn("Service startup failed.", {
          serviceId: descriptor.id,
          startupPhase: phase,
          durationMs: entry.startupDurationMs,
          ...errorLogMeta(err),
        })
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
    // If startAll succeeded the graph must be valid, so we don't have a real
    // "invalid graph at stop time" path. The fallback below covers the
    // pathological case where stopAll is called without a prior successful
    // startAll (e.g. tests that exercise stopAll on a partially-registered
    // registry); we surface it via lastError on the first entry so callers
    // can find it via inspect() afterwards.
    let order: ServiceDescriptor<unknown>[]
    try {
      order = [...reverseTopoSort(this.order.map((id) => descriptorAsNode(this.requireEntry(id).descriptor)))].map(
        (n) => this.requireEntry(n.id).descriptor,
      )
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error(String(err))
      if (this.order.length > 0) {
        const firstEntry = this.entries.get(this.order[0]!)
        if (firstEntry) firstEntry.lastError = wrapped
      }
      order = [...this.order].reverse().map((id) => this.requireEntry(id).descriptor)
    }

    const context = this.getContext()
    const deadline = Date.now() + timeoutMs
    const perServiceTimeout = Math.max(1, this.perServiceStopTimeoutMs)

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
      const limit =
        remaining === 0
          ? Math.min(perServiceTimeout, MIN_STOP_TIMEOUT_AFTER_DEADLINE_MS)
          : Math.min(perServiceTimeout, remaining)

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
        context.logger.error("ServiceRegistry stop failed.", {
          serviceId: descriptor.id,
          ...errorLogMeta(err),
        })
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
  let cancel: () => void = () => {}
  const timeout = new Promise<never>((_, reject) => {
    cancel = makeUnrefTimeout(timeoutMs, () => reject(buildTimeoutError()))
  })
  try {
    return await Promise.race([fn(), timeout])
  } finally {
    cancel()
  }
}

export function createServiceRegistry(
  options?: Partial<ServiceRegistryOptions>,
): ServiceRegistryImpl {
  const contextProvider =
    options?.contextProvider ??
    ((registry: ServiceRegistry): ServiceContext => ({
      logger: createNullLogger(),
      dataRepo: createDataRepository(),
      eventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      registry,
      metrics: createMetricsRegistry(),
      tracer: createTracer(),
      permissionGuard: createPermissionGuard(),
      auditSink: new InMemoryAuditSink(),
      processRuntime: createMainProcessRuntime(),
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

function errorLogMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessageLength: error.message.length,
      stackLength: error.stack?.length ?? 0,
    }
  }
  return {
    errorName: typeof error,
    errorMessageLength: String(error).length,
    stackLength: 0,
  }
}
