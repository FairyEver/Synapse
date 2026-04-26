import path from "node:path"
import { realpath, stat } from "node:fs/promises"

import type { DataNamespace, WorkspaceBindingEntryV1 } from "../../runtime/data-repo"

export type WorkspaceBindingScope = "project" | "shared"

export interface WorkspaceBindingRepositoryDeps {
  readonly bindings: DataNamespace<WorkspaceBindingEntryV1>
  readonly now?: () => Date
}

export interface WorkspaceBindingInput {
  readonly projectId?: string
  readonly scope: WorkspaceBindingScope
  readonly platform: "feishu"
  readonly channelKey: string
  readonly channelName?: string
  readonly workspacePath: string
  readonly baseDir?: string
  readonly boundBy?: string
}

export interface WorkspaceBindingLookup {
  readonly binding: WorkspaceBindingEntryV1
  readonly scope: WorkspaceBindingScope
}

export class WorkspaceBindingRepository {
  private readonly bindings: DataNamespace<WorkspaceBindingEntryV1>
  private readonly now: () => Date

  constructor(deps: WorkspaceBindingRepositoryDeps) {
    this.bindings = deps.bindings
    this.now = deps.now ?? (() => new Date())
  }

  async bind(input: WorkspaceBindingInput): Promise<WorkspaceBindingEntryV1> {
    if (input.scope === "project" && !input.projectId) {
      throw new Error("Project workspace binding requires projectId")
    }
    const normalizedPath = await normalizeWorkspacePath(input.workspacePath)
    const existing = await this.get(input.scope, input.channelKey, input.projectId)
    const now = this.isoNow()
    const entry: WorkspaceBindingEntryV1 = {
      id: bindingId(input.scope, input.channelKey, input.projectId),
      schemaVersion: 1,
      projectId: input.scope === "project" ? input.projectId : undefined,
      scope: input.scope,
      platform: input.platform,
      channelKey: input.channelKey,
      channelName: input.channelName,
      workspacePath: normalizedPath,
      baseDir: input.baseDir,
      boundBy: input.boundBy,
      boundAt: existing?.boundAt ?? now,
      updatedAt: now,
    }
    await this.bindings.upsert(entry)
    return entry
  }

  async unbind(
    scope: WorkspaceBindingScope,
    channelKey: string,
    projectId?: string,
  ): Promise<boolean> {
    const id = bindingId(scope, channelKey, projectId)
    const existing = await this.bindings.get(id)
    if (!existing) return false
    await this.bindings.remove(id)
    return true
  }

  get(
    scope: WorkspaceBindingScope,
    channelKey: string,
    projectId?: string,
  ): Promise<WorkspaceBindingEntryV1 | null> {
    return this.bindings.get(bindingId(scope, channelKey, projectId))
  }

  async lookupEffective(
    projectId: string,
    channelKey: string,
  ): Promise<WorkspaceBindingLookup | null> {
    const project = await this.get("project", channelKey, projectId)
    if (project) return { binding: project, scope: "project" }
    const shared = await this.get("shared", channelKey)
    if (shared) return { binding: shared, scope: "shared" }
    return null
  }

  listProject(projectId: string): Promise<WorkspaceBindingEntryV1[]> {
    return this.bindings.list({
      projectId,
      scope: "project",
      platform: "feishu",
    } as Partial<WorkspaceBindingEntryV1>)
  }

  listShared(): Promise<WorkspaceBindingEntryV1[]> {
    return this.bindings.list({
      scope: "shared",
      platform: "feishu",
    } as Partial<WorkspaceBindingEntryV1>)
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

export async function normalizeWorkspacePath(workspacePath: string): Promise<string> {
  const cleaned = path.resolve(path.normalize(workspacePath))
  try {
    return await realpath(cleaned)
  } catch {
    return cleaned
  }
}

export async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory()
  } catch {
    return false
  }
}

export function bindingId(
  scope: WorkspaceBindingScope,
  channelKey: string,
  projectId?: string,
): string {
  const owner = scope === "project" ? projectId ?? "" : "shared"
  const raw = `${scope}:${owner}:${channelKey}`
  return `workspace-binding:${Buffer.from(raw).toString("base64url")}`
}
