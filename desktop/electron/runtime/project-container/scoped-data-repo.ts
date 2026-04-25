/**
 * Phase 0.5 — ProjectScopedDataRepo implementation.
 *
 * Phase 0.5 lands a thin pass-through that re-exposes the underlying
 * namespace. Real per-project on-disk layout (e.g. `projects/<id>/conversations.db`)
 * lands in M1 when project-scoped data starts being written.
 */

import type { DataNamespace, DataRepository } from "../data-repo/types"
import type { ProjectScopedDataRepo } from "./types"

export class ProjectScopedDataRepoImpl implements ProjectScopedDataRepo {
  readonly projectId: string
  readonly underlying: DataRepository

  constructor(projectId: string, underlying: DataRepository) {
    this.projectId = projectId
    this.underlying = underlying
  }

  namespace<T>(name: string): DataNamespace<T> {
    // M1 will introduce true scoping (e.g. `projects/${projectId}/${name}`).
    // Phase 0.5 is structural-only.
    return this.underlying.namespace<T>(name)
  }
}
