/**
 * Phase 0.5 — ProjectContainerRegistry implementation.
 * SPEC §8.
 */

import type { ServiceRegistry, StructuredLogger } from "../service-registry/types"
import type { EventBus } from "../event-bus/types"
import type { DataRepository } from "../data-repo/types"
import type {
  ProjectContainer,
  ProjectContainerRegistry,
  ProjectContext,
  ProjectMetadata,
  ProjectQuota,
  ProjectScopedService,
} from "./types"
import { ScopedEventBusImpl } from "./scoped-event-bus"
import { ProjectScopedDataRepoImpl } from "./scoped-data-repo"

export interface ProjectContainerRegistryDeps {
  readonly globalRegistry: ServiceRegistry
  readonly globalEventBus: EventBus
  readonly globalDataRepo: DataRepository
  readonly buildLogger: (projectId: string) => StructuredLogger
}

interface ContainerEntry {
  readonly container: ProjectContainerImpl
  readonly openedAt: string
  quota?: ProjectQuota
}

export class ProjectContainerRegistryImpl implements ProjectContainerRegistry {
  private readonly deps: ProjectContainerRegistryDeps
  private readonly serviceTemplates: ProjectScopedService[] = []
  private readonly containers = new Map<string, ContainerEntry>()
  private readonly pendingOpens = new Map<string, Promise<ProjectContainer>>()

  constructor(deps: ProjectContainerRegistryDeps) {
    this.deps = deps
  }

  registerService(service: ProjectScopedService): void {
    if (this.serviceTemplates.find((t) => t.id === service.id)) {
      throw new Error(`ProjectScopedService "${service.id}" already registered`)
    }
    this.serviceTemplates.push(service)
  }

  peek(projectId: string): ProjectContainer | undefined {
    return this.containers.get(projectId)?.container
  }

  async open(projectId: string, metadata: Partial<ProjectMetadata> = {}): Promise<ProjectContainer> {
    const existing = this.containers.get(projectId)
    if (existing) return existing.container
    const pending = this.pendingOpens.get(projectId)
    if (pending) return pending

    const opening = this.createAndStartContainer(projectId, metadata)
    this.pendingOpens.set(projectId, opening)
    try {
      return await opening
    } finally {
      if (this.pendingOpens.get(projectId) === opening) {
        this.pendingOpens.delete(projectId)
      }
    }
  }

  private async createAndStartContainer(
    projectId: string,
    metadata: Partial<ProjectMetadata>,
  ): Promise<ProjectContainer> {
    const projectMeta: ProjectMetadata = {
      id: projectId,
      name: metadata.name ?? projectId,
      workspacePath: metadata.workspacePath,
      managedKnowledgeBase: metadata.managedKnowledgeBase,
      createdAt: metadata.createdAt ?? new Date().toISOString(),
    }
    const ctx: ProjectContext = {
      projectId,
      projectMeta,
      logger: this.deps.buildLogger(projectId),
      dataRepo: new ProjectScopedDataRepoImpl(projectId, this.deps.globalDataRepo),
      eventBus: new ScopedEventBusImpl(projectId, this.deps.globalEventBus),
      globalRegistry: this.deps.globalRegistry,
    }

    const container = new ProjectContainerImpl(projectId, this.serviceTemplates.slice(), ctx)
    await container.start()
    this.containers.set(projectId, {
      container,
      openedAt: new Date().toISOString(),
    })

    ctx.eventBus.emit({
      domain: "project",
      type: "activated",
      payload: { projectId },
      timestamp: new Date().toISOString(),
    })

    return container
  }

  async close(projectId: string): Promise<void> {
    const entry = this.containers.get(projectId)
    if (!entry) return
    try {
      await entry.container.dispose()
    } catch (err) {
      const logger = this.deps.buildLogger(projectId)
      logger.error("Project container dispose encountered errors.", {
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
    this.containers.delete(projectId)
  }

  list(): ReadonlyArray<{ projectId: string; openedAt: string }> {
    return [...this.containers.values()].map((e) => ({
      projectId: e.container.projectId,
      openedAt: e.openedAt,
    }))
  }

  setQuota(projectId: string, quota: ProjectQuota): void {
    const entry = this.containers.get(projectId)
    if (!entry) {
      throw new Error(`Cannot set quota for unopened project "${projectId}"`)
    }
    entry.quota = quota
  }

  getQuota(projectId: string): ProjectQuota | undefined {
    return this.containers.get(projectId)?.quota
  }
}

interface ServiceState {
  readonly template: ProjectScopedService
  status: "pending" | "running" | "stopped" | "failed"
  instance?: unknown
  lastError?: Error
}

class ProjectContainerImpl implements ProjectContainer {
  readonly projectId: string
  private readonly states: ServiceState[]
  private readonly ctx: ProjectContext

  constructor(projectId: string, templates: ProjectScopedService[], ctx: ProjectContext) {
    this.projectId = projectId
    this.states = templates.map((template) => ({ template, status: "pending" }))
    this.ctx = ctx
  }

  get<T>(id: string): T {
    const state = this.states.find((s) => s.template.id === id)
    if (!state) {
      throw new Error(`Project-scoped service "${id}" not registered`)
    }
    if (state.status !== "running") {
      throw new Error(`Project-scoped service "${id}" not running (status=${state.status})`)
    }
    return state.instance as T
  }

  inspect(): ReadonlyArray<{ id: string; status: ServiceState["status"] }> {
    return this.states.map((s) => ({ id: s.template.id, status: s.status }))
  }

  async start(): Promise<void> {
    for (const state of this.sortByDeps()) {
      try {
        const instance = await Promise.resolve(state.template.create(this.ctx))
        state.instance = instance
        if (state.template.start) {
          await Promise.resolve(state.template.start(instance, this.ctx))
        }
        state.status = "running"
      } catch (rawErr) {
        const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr))
        state.status = "failed"
        state.lastError = err
        await this.dispose().catch((disposeErr) => {
          this.ctx.logger.error("Cleanup of already-started services failed during start() rollback.", {
            error: disposeErr instanceof Error ? disposeErr.message : String(disposeErr),
          })
        })
        throw err
      }
    }
  }

  async dispose(): Promise<void> {
    const errors: Array<{ id: string; error: Error }> = []
    // Reverse order.
    for (const state of [...this.sortByDeps()].reverse()) {
      if (state.status !== "running") continue
      try {
        if (state.template.stop) {
          await Promise.resolve(state.template.stop(state.instance, this.ctx))
        }
        state.status = "stopped"
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        state.status = "failed"
        state.lastError = error
        errors.push({ id: state.template.id, error })
        this.ctx.logger.error(`Service "${state.template.id}" stop failed.`, { error: error.message })
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors.map((e) => e.error),
        `${errors.length} project service(s) failed to stop: ${errors.map((e) => e.id).join(", ")}`,
      )
    }
  }

  private sortByDeps(): ServiceState[] {
    // Simple topological sort. Cycles aren't expected (and would have been
    // detected at registration if we wanted to be paranoid).
    const order: ServiceState[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (state: ServiceState) => {
      if (visited.has(state.template.id)) return
      if (visiting.has(state.template.id)) {
        throw new Error(`Circular project-scoped service dependency at "${state.template.id}"`)
      }
      visiting.add(state.template.id)
      for (const depId of state.template.dependsOn ?? []) {
        const dep = this.states.find((s) => s.template.id === depId)
        if (!dep) {
          throw new Error(`Project-scoped service "${state.template.id}" depends on unknown "${depId}"`)
        }
        visit(dep)
      }
      visiting.delete(state.template.id)
      visited.add(state.template.id)
      order.push(state)
    }

    for (const state of this.states) visit(state)
    return order
  }
}

export function createProjectContainerRegistry(
  deps: ProjectContainerRegistryDeps,
): ProjectContainerRegistryImpl {
  return new ProjectContainerRegistryImpl(deps)
}
