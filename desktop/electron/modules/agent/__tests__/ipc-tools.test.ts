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
import {
  AGENT_REFERENCE_ACTION_SERVICE_ID,
  type AgentReferenceActionService,
} from "../../../services/agent-reference-action-service"
import { AGENT_REFERENCE_MAX_CODE_POINTS } from "../../../../src/types/agent-reference-action"
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

  it("opens an opaque committed attachment reference without exposing its path", async () => {
    const auditSink = fakeAuditSink()
    const controlledPath = path.resolve("/controlled/attachment-1/original.md")
    const resolveAttachmentOpenPath = vi.fn().mockResolvedValue(controlledPath)

    await expect(toolMethods.openReference.handler(createContext({
      auditSink,
      agentRuntime: { resolveAttachmentOpenPath },
    }), {
      projectId: "project-1",
      reference: "synapse-agent-attachment://local/attachment-1",
    })).resolves.toEqual({ ok: true, path: controlledPath })

    expect(resolveAttachmentOpenPath).toHaveBeenCalledWith("attachment-1")
    expect(electronMock.shell.openPath).toHaveBeenCalledWith(controlledPath)
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

  it("publishes two strict Agent reference action contracts", () => {
    expect(toolMethods.openReferenceDefault.operationId).toBe("app.agent.reference.open_default")
    expect(toolMethods.showReferenceInFolder.operationId).toBe("app.agent.reference.show_in_folder")
    expect(toolMethods.openReferenceDefault.request.safeParse({
      projectId: "project-1",
      reference: "src/app.ts",
      mode: "open",
    }).success).toBe(false)
    expect(toolMethods.openReferenceDefault.response?.safeParse({ ok: true, path: "/private/path" }).success)
      .toBe(false)
    expect(toolMethods.showReferenceInFolder.response?.parse({
      ok: false,
      code: "symbolic_link_not_supported",
    })).toEqual({
      ok: false,
      code: "symbolic_link_not_supported",
    })
  })

  it("delegates each Agent reference action to its dedicated service method", async () => {
    const auditSink = fakeAuditSink()
    const service = {
      validateInput: vi.fn(() => ({ ok: true as const })),
      openDefault: vi.fn(async () => ({ ok: true as const })),
      showInFolder: vi.fn(async () => ({
        ok: false as const,
        code: "not_found_or_inaccessible" as const,
      })),
    }
    const context = createContext({ auditSink, referenceActionService: service })

    await expect(toolMethods.openReferenceDefault.handler(context, {
      projectId: "project-1",
      reference: "src/app.ts:12",
    })).resolves.toEqual({ ok: true })
    await expect(toolMethods.showReferenceInFolder.handler(context, {
      projectId: "project-1",
      reference: "src/app.ts:12",
    })).resolves.toEqual({ ok: false, code: "not_found_or_inaccessible" })

    expect(service.openDefault).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      projectRoot: "/repo",
      reference: "src/app.ts:12",
      actor: { kind: "user", id: "renderer" },
    }))
    expect(service.showInFolder).toHaveBeenCalledOnce()
  })

  it("rejects an over-limit reference before resolving a project or service", async () => {
    const auditSink = fakeAuditSink()
    const service = {
      validateInput: vi.fn(() => ({ ok: true as const })),
      openDefault: vi.fn(),
      showInFolder: vi.fn(),
    }

    await expect(toolMethods.openReferenceDefault.handler(
      createContext({ auditSink, referenceActionService: service }),
      {
        projectId: "project-1",
        reference: "😀".repeat(AGENT_REFERENCE_MAX_CODE_POINTS + 1),
      },
    )).resolves.toEqual({ ok: false, code: "invalid_reference" })

    expect(configStore.load).not.toHaveBeenCalled()
    expect(service.openDefault).not.toHaveBeenCalled()
  })

  it("returns invalid_reference from service validation before project resolution", async () => {
    const auditSink = fakeAuditSink()
    const rawReference = "\\\\?\\C:\\private\\secret.txt"
    const service = {
      validateInput: vi.fn(() => ({ ok: false as const, code: "invalid_reference" as const })),
      openDefault: vi.fn(),
      showInFolder: vi.fn(),
    }

    await expect(toolMethods.openReferenceDefault.handler(
      createContext({ auditSink, referenceActionService: service }),
      { projectId: "project-1", reference: rawReference },
    )).resolves.toEqual({ ok: false, code: "invalid_reference" })

    expect(configStore.load).not.toHaveBeenCalled()
    expect(auditSink.record).not.toHaveBeenCalled()
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain(rawReference)
  })

  it("redacts an unexpected service rejection behind the safe IPC invariant error", async () => {
    const auditSink = fakeAuditSink()
    const sensitiveFailure = new Error("unexpected failure for /private/secret.txt")
    const service = {
      validateInput: vi.fn(() => ({ ok: true as const })),
      openDefault: vi.fn(async () => {
        throw sensitiveFailure
      }),
      showInFolder: vi.fn(),
    }

    let rejection: unknown
    try {
      await toolMethods.openReferenceDefault.handler(
        createContext({ auditSink, referenceActionService: service }),
        { projectId: "project-1", reference: "src/app.ts" },
      )
    } catch (error) {
      rejection = error
    }
    expect(rejection).toMatchObject({
      message: "Agent reference action failed unexpectedly.",
    })
    expect(rejection).not.toHaveProperty("cause")

    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Agent reference action IPC invariant failure.",
      {
        action: "open_default",
        result: "ipc_failure",
        errorName: "Error",
      },
    )
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain(sensitiveFailure.message)
  })

  it("binds the invoking sender lifecycle until the action completes", async () => {
    const auditSink = fakeAuditSink()
    let destroy: (() => void) | undefined
    const dispose = vi.fn()
    const sender = {
      id: 42,
      isDestroyed: vi.fn(() => false),
      onDestroyed: vi.fn((listener: () => void) => {
        destroy = listener
        return dispose
      }),
    }
    const service = {
      validateInput: vi.fn(() => ({ ok: true as const })),
      openDefault: vi.fn(async (input: { abortSignal?: AbortSignal }) => {
        destroy?.()
        expect(input.abortSignal?.aborted).toBe(true)
        return { ok: false as const, code: "cancelled_before_submission" as const }
      }),
      showInFolder: vi.fn(),
    }

    await expect(toolMethods.openReferenceDefault.handler(
      createContext({ auditSink, referenceActionService: service, sender }),
      { projectId: "project-1", reference: "src/app.ts" },
    )).resolves.toEqual({ ok: false, code: "cancelled_before_submission" })

    expect(sender.onDestroyed).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

function createContext(options: {
  readonly auditSink: AuditSink
  readonly agentRuntime?: {
    resolveAttachmentOpenPath(attachmentId: string): Promise<string>
  }
  readonly permissionGuard?: PermissionGuard
  readonly referenceActionService?: Pick<
    AgentReferenceActionService,
    "validateInput" | "openDefault" | "showInFolder"
  >
  readonly sender?: {
    readonly id: number
    isDestroyed(): boolean
    onDestroyed(listener: () => void): () => void
  }
}) {
  const permissionGuard = options.permissionGuard ?? fakePermissionGuard()
  const container = {
    get: vi.fn((serviceId: string) => {
      if (serviceId === AGENT_RUNTIME_SERVICE_ID) return options.agentRuntime ?? {}
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
    sender: options.sender,
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "core.project-containers") return containers as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return options.auditSink as T
      if (serviceId === AGENT_REFERENCE_ACTION_SERVICE_ID && options.referenceActionService) {
        return options.referenceActionService as T
      }
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
