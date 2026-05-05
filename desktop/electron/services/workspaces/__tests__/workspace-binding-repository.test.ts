import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import type { DataNamespace, WorkspaceBindingEntryV1 } from "../../../runtime/data-repo"
import { WorkspaceBindingRepository, isDirectory } from "../workspace-binding-repository"

describe("WorkspaceBindingRepository", () => {
  it("prefers project bindings over shared bindings", async () => {
    const repo = new WorkspaceBindingRepository({
      bindings: new MemoryNamespace<WorkspaceBindingEntryV1>("workspace.bindings"),
      now: () => new Date("2026-04-26T00:00:00.000Z"),
    })

    await repo.bind({
      scope: "shared",
      platform: "feishu",
      channelKey: "feishu:oc_group",
      workspacePath: "/shared",
    })
    await repo.bind({
      projectId: "project-1",
      scope: "project",
      platform: "feishu",
      channelKey: "feishu:oc_group",
      workspacePath: "/project",
    })

    await expect(repo.lookupEffective("project-1", "feishu:oc_group"))
      .resolves.toEqual(expect.objectContaining({
        scope: "project",
        binding: expect.objectContaining({ workspacePath: path.resolve("/project") }),
      }))
    await expect(repo.lookupEffective("project-2", "feishu:oc_group"))
      .resolves.toEqual(expect.objectContaining({
        scope: "shared",
        binding: expect.objectContaining({ workspacePath: path.resolve("/shared") }),
      }))
  })

  it("keeps Feishu channel keys isolated and supports unbind/list", async () => {
    const repo = new WorkspaceBindingRepository({
      bindings: new MemoryNamespace<WorkspaceBindingEntryV1>("workspace.bindings"),
    })

    await repo.bind({
      projectId: "project-1",
      scope: "project",
      platform: "feishu",
      channelKey: "feishu:C1",
      workspacePath: "/feishu",
    })
    await repo.bind({
      scope: "shared",
      platform: "feishu",
      channelKey: "feishu:oc_other",
      workspacePath: "/other",
    })

    expect(await repo.lookupEffective("project-1", "feishu:C1")).toBeTruthy()
    expect(await repo.lookupEffective("project-1", "feishu:oc_other")).toBeTruthy()
    expect(await repo.lookupEffective("project-1", "feishu:C2")).toBeNull()
    expect(await repo.listProject("project-1")).toHaveLength(1)
    expect(await repo.unbind("project", "feishu:C1", "project-1")).toBe(true)
    expect(await repo.lookupEffective("project-1", "feishu:C1")).toBeNull()
  })

  it("checks directory existence", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-binding-"))
    await mkdir(dir, { recursive: true })
    await expect(isDirectory(dir)).resolves.toBe(true)
    await expect(isDirectory(path.join(dir, "missing"))).resolves.toBe(false)
  })
})

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  private readonly items = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(_value: T): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.items.values()]
    if (!filter) return values
    return values.filter((item) =>
      Object.entries(filter).every(([key, value]) => item[key as keyof T] === value)
    )
  }

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    this.items.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id)
  }

  onChange(): () => void {
    return () => {}
  }
}
