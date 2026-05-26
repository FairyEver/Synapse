import { describe, expect, it } from "vitest"

import type { DataChangeListener, DataNamespace, RunAsConfigEntryV1, RunAsPreflightEntryV1 } from "../../../runtime/data-repo"
import type { ControlledProcessRunner } from "../../../runtime/process"
import type { PermissionGuard, PermissionRequest, PermissionResult } from "../../../runtime/security"
import { InMemoryAuditSink } from "../../../runtime/security"
import { ExecutionIsolationService } from "../execution-isolation-service"

describe("ExecutionIsolationService", () => {
  const isWindows = process.platform === "win32"

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
      permissionGuard: permissionGuard({ allowed: true }),
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

  it("blocks enabling run-as until preflight has passed", async () => {
    const configs = new MemoryNamespace<RunAsConfigEntryV1>("run-as.config")
    await configs.upsert({
      id: "run-as:project-1",
      schemaVersion: 1,
      projectId: "project-1",
      enabled: false,
      user: "safe-user",
      envAllowlist: ["LANG"],
      requirePreflight: true,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
    })
    const auditSink = new InMemoryAuditSink()
    const service = new ExecutionIsolationService({
      configs,
      preflights: new MemoryNamespace<RunAsPreflightEntryV1>("run-as.preflights"),
      processRunner: {} as ControlledProcessRunner,
      permissionGuard: permissionGuard({ allowed: true }),
      auditSink,
    })

    if (isWindows) {
      await expect(service.updateConfig({
        projectId: "project-1",
        enabled: true,
      })).resolves.toMatchObject({
        enabled: false,
        supported: false,
        lastError: "run_as_user is not supported on Windows",
      })
    } else {
      await expect(service.updateConfig({
        projectId: "project-1",
        enabled: true,
      })).rejects.toThrow("run_as_user preflight must pass before enabling run-as or disabling preflight")
    }

    await expect(configs.get("run-as:project-1")).resolves.toMatchObject({
      enabled: false,
    })
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        resource: "run_as_user:config",
        outcome: isWindows ? "allowed" : "failed",
      }),
    ])
  })

  it("records permission denial before updating run-as config", async () => {
    const configs = new MemoryNamespace<RunAsConfigEntryV1>("run-as.config")
    const auditSink = new InMemoryAuditSink()
    const service = new ExecutionIsolationService({
      configs,
      preflights: new MemoryNamespace<RunAsPreflightEntryV1>("run-as.preflights"),
      processRunner: {} as ControlledProcessRunner,
      permissionGuard: permissionGuard({
        allowed: false,
        reason: "denied by test",
        policyId: "test",
      }),
      auditSink,
    })

    await expect(service.updateConfig({
      projectId: "project-1",
      enabled: true,
    })).rejects.toThrow("denied by test")

    await expect(configs.get("run-as:project-1")).resolves.toBeNull()
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        resource: "run_as_user:config",
        outcome: "denied",
      }),
    ])
  })

  it("audits allowed run-as config updates", async () => {
    const configs = new MemoryNamespace<RunAsConfigEntryV1>("run-as.config")
    await configs.upsert({
      id: "run-as:project-1",
      schemaVersion: 1,
      projectId: "project-1",
      enabled: false,
      user: "safe-user",
      envAllowlist: ["LANG"],
      requirePreflight: true,
      lastPreflightStatus: "pass",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
    })
    const auditSink = new InMemoryAuditSink()
    const checked: PermissionRequest[] = []
    const service = new ExecutionIsolationService({
      configs,
      preflights: new MemoryNamespace<RunAsPreflightEntryV1>("run-as.preflights"),
      processRunner: {} as ControlledProcessRunner,
      permissionGuard: permissionGuard({ allowed: true }, checked),
      auditSink,
    })

    await expect(service.updateConfig({
      projectId: "project-1",
      enabled: true,
    })).resolves.toMatchObject({
      enabled: !isWindows,
    })

    expect(checked).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        resource: "run_as_user:config",
      }),
    ])
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        resource: "run_as_user:config",
        outcome: "allowed",
      }),
    ])
  })
})

function permissionGuard(result: PermissionResult, requests: PermissionRequest[] = []): PermissionGuard {
  return {
    registerPolicy: () => () => {},
    check: async (request) => {
      requests.push(request)
      return result
    },
  }
}

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
