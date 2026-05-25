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
  EventBusEmitOptions,
  EventScope,
  EventDomain,
  Unsubscribe,
} from "../event-bus/types"
import type { DataNamespace, DataRepository } from "../data-repo/types"

export interface ProjectMetadata {
  readonly id: string
  readonly name: string
  readonly workspacePath?: string
  readonly managedKnowledgeBase?: boolean
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
  /** Synchronously return an already-opened container, or undefined if not open. */
  peek(projectId: string): ProjectContainer | undefined
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
  emit<D extends EventDomain>(
    event: Omit<DomainEvent<D>, "scope"> & { scope?: Omit<EventScope, "projectId"> },
    options?: EventBusEmitOptions,
  ): void
  on<D extends EventDomain>(domain: D, listener: (event: DomainEvent<D>) => void): Unsubscribe
  /** Underlying global bus for cases where the consumer needs cross-project visibility. */
  readonly underlying: EventBus
}

/**
 * Wraps a DataRepository so selected namespace handles are project-scoped at
 * the persistence layer. Phase 0.7 uses field-level isolation: project-scoped
 * namespaces automatically write and filter `projectId`, while global
 * namespaces pass through to the underlying repository.
 */
export interface ProjectScopedDataRepo {
  readonly projectId: string
  namespace<T>(name: string): DataNamespace<T>
  /** Underlying global repo for cases where the consumer needs unrestricted access. */
  readonly underlying: DataRepository
}
