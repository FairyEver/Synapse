/**
 * Phase 0.1 — ServiceRegistry public types.
 * SPEC §4.
 *
 * Phase 0.7 — ServiceContext now carries real runtime infrastructure
 * interfaces instead of placeholders so project-scoped CC Connect services can
 * depend on typed DataRepository/EventBus/PermissionGuard/ProcessRuntime.
 */

import type { DataRepository } from "../data-repo/types"
import type { EventBus } from "../event-bus/types"
import type { MetricsRegistry, Tracer } from "../observability"
import type { ProcessRuntime } from "../process/runtime"
import type { AuditSink, PermissionGuard } from "../security/permission-guard"

/** Phase 0.6 — unified StructuredLogger interface (also re-exported by runtime/logging). */
export interface StructuredLogger {
  trace(message: string, meta?: Record<string, unknown> | unknown): void
  debug(message: string, meta?: Record<string, unknown> | unknown): void
  info(message: string, meta?: Record<string, unknown> | unknown): void
  warn(message: string, meta?: Record<string, unknown> | unknown): void
  error(message: string, meta?: Record<string, unknown> | unknown): void
  fatal(message: string, meta?: Record<string, unknown> | unknown): void
  child(prefix: string, bindings?: Record<string, unknown>): StructuredLogger
}

/** Phase 0.6 — replaced by runtime/observability/health.ts. */
export interface HealthStatus {
  readonly status: "healthy" | "degraded" | "unhealthy"
  readonly message?: string
  readonly details?: Record<string, unknown>
}

export type ServiceCriticality = "fatal" | "degraded"

export type ServiceStatus =
  | "pending"
  | "starting"
  | "running"
  | "stopped"
  | "failed"

export type ServiceProcessKind = "main" | "utility" | "worker"

export interface ServiceContext {
  readonly logger: StructuredLogger
  readonly dataRepo: DataRepository
  readonly eventBus: EventBus
  readonly registry: ServiceRegistry
  readonly metrics: MetricsRegistry
  readonly tracer: Tracer
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly processRuntime: ProcessRuntime
}

export interface ServiceDescriptor<Instance = unknown> {
  readonly id: string
  /** Hard dependencies control start order and propagate startup failures. */
  readonly dependsOn?: readonly string[]
  /**
   * Order-only dependencies must be registered and start first, but their
   * degraded startup failures do not propagate through this edge. A fatal
   * service failure still aborts the registry startup.
   */
  readonly startAfter?: readonly string[]
  readonly criticality: ServiceCriticality
  /** Default "main". `utility` / `worker` consumed by ProcessRuntime in Phase 0.5+. */
  readonly runIn?: ServiceProcessKind
  create(ctx: ServiceContext): Instance | Promise<Instance>
  start?(instance: Instance, ctx: ServiceContext): Promise<void> | void
  stop?(instance: Instance, ctx: ServiceContext, timeoutMs: number): Promise<void> | void
  reload?(instance: Instance, ctx: ServiceContext): Promise<void> | void
  /** Phase 0.6 HealthCheckAggregator polls this. */
  checkHealth?(instance: Instance): Promise<HealthStatus> | HealthStatus
}

export interface ServiceInspectEntry {
  readonly id: string
  readonly status: ServiceStatus
  readonly criticality: ServiceCriticality
  readonly dependsOn: readonly string[]
  readonly startAfter: readonly string[]
  readonly runIn: ServiceProcessKind
  readonly lastError?: Error
}

export interface DegradedServiceFailure {
  readonly id: string
  readonly error: Error
}

export interface StartAllResult {
  readonly degraded: readonly DegradedServiceFailure[]
}

export interface ServiceRegistry {
  register<T>(descriptor: ServiceDescriptor<T>): void
  startAll(): Promise<StartAllResult>
  stopAll(timeoutMs: number): Promise<void>
  get<T>(id: string): T
  reload(id: string): Promise<void>
  inspect(): readonly ServiceInspectEntry[]
}
