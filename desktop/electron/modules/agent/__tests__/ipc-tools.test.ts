import { beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"

const electronMock = vi.hoisted(() => ({
  shell: {
    openPath: vi.fn(),
  },
}))
const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn((_cmd: string, _args: readonly string[], _opts: unknown, cb?: (err: Error | null) => void) => {
    if (cb) {
      cb(new Error("ENOENT"))
    }
  }),
}))
const fsPromisesMock = vi.hoisted(() => ({
  realpath: vi.fn(async (value: string) => value),
}))
const logStoreMock = vi.hoisted(() => ({
  logger: {
    warn: vi.fn(),
  },
}))

vi.mock("electron", () => electronMock)
vi.mock("node:child_process", () => childProcessMock)
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    default: {
      ...actual,
      realpath: fsPromisesMock.realpath,
    },
    realpath: fsPromisesMock.realpath,
  }
})
vi.mock("../../../services/log-store", () => ({
  createMainLogger: vi.fn(() => logStoreMock.logger),
}))

import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import type { ProjectContainer, ProjectContainerRegistry } from "../../../runtime/project-container"
import { AGENT_RUNTIME_SERVICE_ID } from "../../../services/agent-runtime"
import { configStore } from "../../../services/config-store"
import { PROVIDER_SERVICE_ID } from "../../../services/provider"
import { toolMethods } from "../ipc-tools"

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(),
  },
}))

describe("agent tool IPC methods", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    childProcessMock.execFile.mockImplementation((_cmd: string, _args: readonly string[], _opts: unknown, cb?: (err: Error | null) => void) => {
      if (cb) {
        cb(new Error("ENOENT"))
      }
    })
    fsPromisesMock.realpath.mockImplementation(async (value: string) => value)
    electronMock.shell.openPath.mockResolvedValue("")
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "project-1",
        name: "Project One",
        localPath: "/repo",
        contentDirs: {},
      }],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
  })

  it("checks and audits shell execution when opening an Agent reference", async () => {
    const auditSink = fakeAuditSink()
    const permissionGuard = fakePermissionGuard()
    const expectedPath = path.resolve("/repo", "src/app.ts")

    await expect(toolMethods.openReference.handler(createContext({ auditSink, permissionGuard }), {
      projectId: "project-1",
      reference: "src/app.ts:12",
    })).resolves.toEqual({ ok: true, path: expectedPath })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "shell.exec",
      actor: { kind: "user", id: "renderer" },
      resource: expectedPath,
      context: {
        projectId: "project-1",
        command: "open-reference",
        line: 12,
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      outcome: "allowed",
      resource: expectedPath,
      metadata: expect.objectContaining({
        projectId: "project-1",
        command: "open-reference",
        line: 12,
      }),
    }))
  })

  it("opens an absolute Agent file reference outside the project", async () => {
    const auditSink = fakeAuditSink()
    const outsidePath = path.resolve("/outside/Easy Worklog/待发送/工作总结.md")

    await expect(toolMethods.openReference.handler(createContext({ auditSink }), {
      projectId: "project-1",
      reference: outsidePath,
    })).resolves.toEqual({ ok: true, path: outsidePath })

    expect(electronMock.shell.openPath).toHaveBeenCalledWith(outsidePath)
  })

  it("escapes Windows editor shim line jump targets before cmd parses them", async () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    const auditSink = fakeAuditSink()
    const expectedPath = path.resolve("/repo", "src/a&b%caret^file.ts")
    childProcessMock.execFile.mockImplementation((cmd: string, _args: readonly string[], _opts: unknown, cb?: (err: Error | null) => void) => {
      if (cb) {
        cb(cmd === "cmd.exe" ? null : new Error("ENOENT"))
      }
    })

    try {
      await expect(toolMethods.openReference.handler(createContext({ auditSink }), {
        projectId: "project-1",
        reference: "src/a&b%caret^file.ts:12",
      })).resolves.toEqual({ ok: true, path: expectedPath })
    } finally {
      platform.mockRestore()
    }

    const cmdCall = childProcessMock.execFile.mock.calls.find(([cmd]) => cmd === "cmd.exe")
    const command = cmdCall?.[1]?.[3]
    expect(command).toEqual(expect.stringMatching(/^cursor\.cmd --goto ".+"$/))
    expect(command).toContain("^&")
    expect(command).toContain("%%")
    expect(command).toContain("^^")
    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
  })

  it("blocks Agent reference opens when shell execution is denied", async () => {
    const auditSink = fakeAuditSink()
    const permissionGuard = fakePermissionGuard()
    permissionGuard.check
      .mockResolvedValueOnce({ allowed: true as const })
      .mockResolvedValueOnce({ allowed: false as const, reason: "shell blocked", policyId: "policy-shell" })
    const expectedPath = path.resolve("/repo", "src/app.ts")

    await expect(toolMethods.openReference.handler(createContext({ auditSink, permissionGuard }), {
      projectId: "project-1",
      reference: "src/app.ts:12",
    })).rejects.toThrow("shell blocked")

    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      outcome: "denied",
      resource: expectedPath,
      metadata: expect.objectContaining({
        projectId: "project-1",
        command: "open-reference",
        line: 12,
        reason: "shell blocked",
        policyId: "policy-shell",
      }),
    }))
  })

  it("records a failed audit when opening an Agent reference rejects", async () => {
    const auditSink = fakeAuditSink()
    const expectedPath = path.resolve("/repo", "src/app.ts")
    electronMock.shell.openPath.mockRejectedValue(new Error("shell failed for /repo/src/app.ts"))

    await expect(toolMethods.openReference.handler(createContext({ auditSink }), {
      projectId: "project-1",
      reference: "src/app.ts:12",
    })).rejects.toThrow("shell failed for /repo/src/app.ts")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "failed",
      resource: expectedPath,
      metadata: expect.objectContaining({
        projectId: "project-1",
        command: "open-reference",
        line: 12,
        errorName: "Error",
        errorLength: "shell failed for /repo/src/app.ts".length,
      }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls[0]?.[0]?.metadata)).not.toContain("/repo/src/app.ts")
  })

  it("records sanitized audit metadata when opening an Agent reference returns an error", async () => {
    const auditSink = fakeAuditSink()
    const expectedPath = path.resolve("/repo", "src/app.ts")
    const rawError = "shell failed for /repo/src/app.ts token=sk-secret"
    electronMock.shell.openPath.mockResolvedValue(rawError)

    await expect(toolMethods.openReference.handler(createContext({ auditSink }), {
      projectId: "project-1",
      reference: "src/app.ts:12",
    })).rejects.toThrow(rawError)

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "failed",
      resource: expectedPath,
      metadata: expect.objectContaining({
        projectId: "project-1",
        command: "open-reference",
        line: 12,
        boundary: "agent.ipc.open-reference.shell",
        errorName: "string",
        errorLength: rawError.length,
      }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls[0]?.[0]?.metadata)).not.toContain("/repo/src/app.ts")
    expect(JSON.stringify(auditSink.record.mock.calls[0]?.[0]?.metadata)).not.toContain("sk-secret")
  })

  it("logs invalid Agent reference opens without recording the raw reference", async () => {
    const auditSink = fakeAuditSink()
    const rawReference = "https://example.com/private?token=sk-secret"

    await expect(toolMethods.openReference.handler(createContext({ auditSink }), {
      projectId: "project-1",
      reference: rawReference,
    })).rejects.toThrow("Reference is outside the workspace or invalid.")

    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Agent open reference IPC failed.",
      expect.objectContaining({
        projectId: "project-1",
        boundary: "agent.open-reference.ipc",
        referenceLength: rawReference.length,
        errorName: "Error",
        errorLength: "Reference is outside the workspace or invalid.".length,
      }),
    )
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain(rawReference)
    expect(auditSink.record).not.toHaveBeenCalled()
  })
})

function createContext(options: {
  readonly auditSink: AuditSink
  readonly permissionGuard?: PermissionGuard
}) {
  const permissionGuard = options.permissionGuard ?? fakePermissionGuard()
  const container = {
    get: vi.fn((serviceId: string) => {
      if (serviceId === AGENT_RUNTIME_SERVICE_ID) return {}
      if (serviceId === PROVIDER_SERVICE_ID) return {}
      throw new Error(`Unknown service: ${serviceId}`)
    }),
  } as unknown as ProjectContainer
  const containers: ProjectContainerRegistry = {
    open: vi.fn(async () => container),
    peek: vi.fn(() => undefined),
    close: vi.fn(),
    list: vi.fn(() => []),
    registerService: vi.fn(),
    setQuota: vi.fn(),
  }

  return {
    moduleId: "agent",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "core.project-containers") return containers as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return options.auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    },
  }
}

function fakePermissionGuard(): PermissionGuard & { check: ReturnType<typeof vi.fn> } {
  return {
    registerPolicy: () => () => {},
    check: vi.fn(async () => ({ allowed: true as const })),
  }
}

function fakeAuditSink(): AuditSink & { record: ReturnType<typeof vi.fn> } {
  const record = vi.fn<AuditSink["record"]>()
  return {
    record,
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
}
