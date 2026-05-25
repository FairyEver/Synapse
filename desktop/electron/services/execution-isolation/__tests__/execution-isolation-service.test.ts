import { describe, expect, it } from "vitest"

import type { DataChangeListener, DataNamespace, RunAsConfigEntryV1, RunAsPreflightEntryV1 } from "../../../runtime/data-repo"
import type { ControlledProcessRunner } from "../../../runtime/process"
import { ExecutionIsolationService } from "../execution-isolation-service"

describe("ExecutionIsolationService", () => {
  it("invalidates a passing preflight when the target user changes", async () => {
    const configs = new MemoryNamespace<RunAsConfigEntryV1>("run-as.config")
    await configs.upsert({
      id: "run-as:project-1",
      schemaVersion: 1,
      projectId: "project-1",
      enabled: true,
      user: "safe-user",
      envAllowlist: ["LANG"],
      requirePreflight: true,
      lastPreflightAt: "2026-05-21T00:00:00.000Z",
      lastPreflightStatus: "pass",
      lastError: "old error",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
    })
    const service = new ExecutionIsolationService({
      configs,
      preflights: new MemoryNamespace<RunAsPreflightEntryV1>("run-as.preflights"),
      processRunner: {} as ControlledProcessRunner,
    })

    await expect(service.updateConfig({
      projectId: "project-1",
      user: "other-user",
    })).resolves.toMatchObject({
      user: "other-user",
      lastPreflightAt: undefined,
      lastPreflightStatus: undefined,
      lastError: undefined,
    })
    if (process.platform !== "win32") {
      await expect(service.resolveProcessIsolation("project-1"))
        .rejects
        .toThrow("run_as_user preflight has not passed")
    }
  })
})

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  private readonly items = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return this.items.values().next().value ?? null
  }

  async setSingleton(value: T): Promise<void> {
    this.items.set(value.id, value)
  }

  async list(): Promise<T[]> {
    return [...this.items.values()]
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

  onChange(_listener: DataChangeListener<T>): () => void {
    return () => {}
  }
}
