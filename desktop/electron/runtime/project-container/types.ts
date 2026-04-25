/**
 * Phase 0.5 — ProjectContainer types.
 * SPEC §8.
 *
 * ProjectContainerRegistry holds per-project scoped service instances. Global
 * services (configStore, updateService, etc.) live in the global
 * ServiceRegistry; project-scoped services (Agent runtime, session manager,
 * connector binding, cron scheduler) live in a ProjectContainer that's
 * created lazily when a project is activated and torn down when closed.
 */

import type {
  ServiceRegistry,
  StructuredLogger,
} from "../service-registry/types"
import type {
  DomainEvent,
  EventBus,
  EventScope,
  EventDomain,
  Unsubscribe,
} from "../event-bus/types"
import type { DataNamespace, DataRepository } from "../data-repo/types"

export interface ProjectMetadata {
  readonly id: string
  readonly name: string
  readonly workspacePath?: string
  readonly createdAt: string
}

/**
 * Per-project context passed into ProjectScopedService factories.
 * The dataRepo and eventBus here are SCOPED — every operation inherits the
 * projectId automatically.
 */
export interface ProjectContext {
  readonly projectId: string
  readonly projectMeta: ProjectMetadata
  readonly logger: StructuredLogger
  readonly dataRepo: ProjectScopedDataRepo
  readonly eventBus: ScopedEventBus
  readonly globalRegistry: ServiceRegistry
}

export interface ProjectScopedService<Instance = unknown> {
  readonly id: string
  readonly dependsOn?: readonly string[]
  create(ctx: ProjectContext): Instance | Promise<Instance>
  start?(instance: Instance, ctx: ProjectContext): Promise<void> | void
  stop?(instance: Instance, ctx: ProjectContext): Promise<void> | void
}

export interface ProjectContainer {
  readonly projectId: string
  get<T>(id: string): T
  inspect(): ReadonlyArray<{ id: string; status: "pending" | "running" | "stopped" | "failed" }>
  dispose(): Promise<void>
}

export interface ProjectQuota {
  readonly maxConcurrentSessions?: number
  readonly maxConnectorConnections?: number
  readonly maxMonthlyTokens?: number
  readonly diskQuotaBytes?: number
}

export interface ProjectContainerRegistry {
  open(projectId: string, metadata?: Partial<ProjectMetadata>): Promise<ProjectContainer>
  close(projectId: string): Promise<void>
  list(): ReadonlyArray<{ projectId: string; openedAt: string }>
  registerService(service: ProjectScopedService): void
  setQuota(projectId: string, quota: ProjectQuota): void
}

/**
 * Wraps an EventBus so emit() automatically fills `scope.projectId`. on/onType
 * are pass-through (subscribers still see all events; scope filtering is the
 * subscriber's job, or use `onScoped` directly on the underlying bus).
 */
export interface ScopedEventBus {
  readonly projectId: string
  emit<D extends EventDomain>(event: Omit<DomainEvent<D>, "scope"> & { scope?: Omit<EventScope, "projectId"> }): void
  on<D extends EventDomain>(domain: D, listener: (event: DomainEvent<D>) => void): Unsubscribe
  /** Underlying global bus for cases where the consumer needs cross-project visibility. */
  readonly underlying: EventBus
}

/**
 * Wraps a DataRepository so namespace handles are project-scoped at the
 * persistence layer. The implementation prefixes namespace data with
 * `projects/<projectId>/`. For SQLite namespaces the wrapper sets the
 * projectId column on every read/write.
 *
 * Phase 0.5 lands the interface + a thin in-memory implementation that
 * returns the underlying handle directly. Real per-project on-disk layout
 * comes in M1 when actual project-scoped data shows up.
 */
export interface ProjectScopedDataRepo {
  readonly projectId: string
  namespace<T>(name: string): DataNamespace<T>
  /** Underlying global repo for cases where the consumer needs unrestricted access. */
  readonly underlying: DataRepository
}
