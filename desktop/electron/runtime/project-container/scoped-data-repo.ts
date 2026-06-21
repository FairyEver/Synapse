/**
 * Phase 0.5 — ProjectScopedDataRepo implementation.
 *
 * Phase 0.7 upgrades the wrapper to real field-level isolation. Project
 * business namespaces automatically write and filter projectId; global
 * namespaces remain pass-through.
 */

import type {
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
  DataRepository,
} from "../data-repo/types"
import type { ProjectScopedDataRepo } from "./types"

const PROJECT_SCOPED_NAMES = new Set([
  "providers",
  "conversations",
  "outbox",
  "audit",
  "agent.commands",
  "agent.command-settings",
])

export class ProjectScopedDataRepoImpl implements ProjectScopedDataRepo {
  readonly projectId: string
  readonly underlying: DataRepository

  constructor(projectId: string, underlying: DataRepository) {
    this.projectId = projectId
    this.underlying = underlying
  }

  namespace<T>(name: string): DataNamespace<T> {
    const namespace = this.underlying.namespace<T>(name)
    if (!PROJECT_SCOPED_NAMES.has(name)) {
      return namespace
    }
    return new ProjectScopedNamespace(this.projectId, namespace)
  }
}

class ProjectScopedNamespace<T> implements DataNamespace<T> {
  readonly name: string
  readonly schemaVersion: number
  readonly backend: DataNamespace<T>["backend"]
  private readonly projectId: string
  private readonly underlying: DataNamespace<T>

  constructor(projectId: string, underlying: DataNamespace<T>) {
    this.projectId = projectId
    this.underlying = underlying
    this.name = underlying.name
    this.schemaVersion = underlying.schemaVersion
    this.backend = underlying.backend
  }

  async getSingleton(): Promise<T | null> {
    const value = await this.underlying.getSingleton()
    if (!value) return null
    return belongsToProject(value, this.projectId) ? value : null
  }

  async setSingleton(value: T): Promise<void> {
    await this.underlying.setSingleton(this.withProjectId(value))
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    const scopedFilter = {
      ...(filter ?? {}),
      projectId: this.projectId,
    } as unknown as Partial<T>
    return this.underlying.list(scopedFilter)
  }

  async count(filter?: Partial<T>): Promise<number> {
    const scopedFilter = {
      ...(filter ?? {}),
      projectId: this.projectId,
    } as unknown as Partial<T>
    return this.underlying.count
      ? this.underlying.count(scopedFilter)
      : (await this.underlying.list(scopedFilter)).length
  }

  async get(id: string): Promise<T | null> {
    const value = await this.underlying.get(id)
    if (!value) return null
    return belongsToProject(value, this.projectId) ? value : null
  }

  async upsert(item: T & { id: string }): Promise<void> {
    await this.underlying.upsert(this.withProjectId(item) as T & { id: string })
  }

  async remove(id: string): Promise<void> {
    const value = await this.underlying.get(id)
    if (!value || !belongsToProject(value, this.projectId)) return
    await this.underlying.remove(id)
  }

  onChange(listener: DataChangeListener<T>): () => void {
    return this.underlying.onChange((event) => {
      if (
        belongsToProject(event.value, this.projectId)
        || belongsToProject(event.previous, this.projectId)
      ) {
        listener(event as DataChangeEvent<T>)
      }
    })
  }

  private withProjectId<V>(value: V): V {
    if (typeof value !== "object" || value === null) {
      throw new Error(`Project-scoped namespace "${this.name}" only accepts object values`)
    }
    const record = value as Record<string, unknown>
    if (
      typeof record.projectId === "string"
      && record.projectId !== this.projectId
    ) {
      throw new Error(
        `Project-scoped namespace "${this.name}" cannot write projectId "${record.projectId}" from project "${this.projectId}"`,
      )
    }
    return {
      ...record,
      projectId: this.projectId,
    } as V
  }
}

function belongsToProject(value: unknown, projectId: string): boolean {
  if (typeof value !== "object" || value === null) return false
  return (value as { projectId?: unknown }).projectId === projectId
}
