import { describe, expect, it, vi } from "vitest"

import {
  createPermissionGuard,
  userInitiatedAllowPolicy,
  type AuditSink,
  type PermissionGuard,
} from "../../../../electron/runtime/security"
import { TERMINAL_CAPABILITY_CATALOG } from "../../shared/capability"
import { createTerminalCapabilityDispatcher } from "../dispatcher"
import { TerminalLaunchValidationError } from "../environment"
import type { TerminalService } from "../service"

const localMcpContext = {
  source: "mcp-stdio" as const,
  actor: { kind: "user" as const, id: "mcp-client:synapse-mcp/stdio" },
  clientId: "mcp-install:test",
  controllerInstanceId: "controller:test",
}

function serviceStub(overrides: Record<string, unknown> = {}): TerminalService {
  return {
    terminalDomainRevision: 7,
    lastPersistError: undefined,
    listGroups: vi.fn(() => []),
    listSessions: vi.fn(() => []),
    getSessionState: vi.fn(() => ({
      sessionId: "11111111-1111-4111-8111-111111111111",
      lifecycle: "running",
      attention: { state: "unknown" },
      lease: { occupied: false, leaseRevision: 0 },
      stateRevision: 1,
      throughOutputSeq: 0,
      inputRevision: 0,
      sizeRevision: 1,
    })),
    sendSemanticInput: vi.fn(() => ({ operationId: "op", inputRevisionAfter: 1 })),
    observe: vi.fn(() => ({ changed: false })),
    runIdempotentOperation: vi.fn((
      _clientId: string,
      _capability: string,
      _key: string,
      _request: unknown,
      operation: () => Promise<unknown>,
    ) => operation()),
    ...overrides,
  } as unknown as TerminalService
}

function allowingSecurity() {
  const permissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => ({ allowed: true as const })),
  } satisfies PermissionGuard
  const auditSink = {
    record: vi.fn(), list: vi.fn(() => []), clearForTests: vi.fn(),
  } satisfies AuditSink
  return { permissionGuard, auditSink }
}

describe("Terminal capability dispatcher", () => {
  it("reports missing transport identity as caller context rather than authentication", async () => {
    const dispatcher = createTerminalCapabilityDispatcher({ service: serviceStub() })
    const result = await dispatcher.dispatch("app.terminal.capabilities.get", {}, { source: "mcp-http" })
    expect(result).toMatchObject({
      ok: false,
      error: { code: "caller_identity_required", category: "caller_context" },
    })
  })

  it("allows local HTTP capability discovery without authentication", async () => {
    const dispatcher = createTerminalCapabilityDispatcher({ service: serviceStub() })
    const result = await dispatcher.dispatch("app.terminal.capabilities.get", {}, {
      source: "mcp-http",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http" },
      clientId: "mcp-install:synapse-mcp/http",
    })
    expect(result).toMatchObject({ ok: true })
  })

  it("allows the local HTTP MCP user to create a terminal without a separate grant", async () => {
    const created = {
      id: "11111111-1111-4111-8111-111111111111",
      groupId: "22222222-2222-4222-8222-222222222222",
      title: "Terminal",
      status: "running",
      creationSource: "mcp",
      stateRevision: 1,
      lastOutputSeq: 0,
      inputRevision: 0,
      launchFacts: {},
    }
    const createMcpSession = vi.fn(async () => created)
    const permissionGuard = createPermissionGuard()
    permissionGuard.registerPolicy(userInitiatedAllowPolicy)
    const dispatcher = createTerminalCapabilityDispatcher({
      service: serviceStub({ createMcpSession }),
      permissionGuard,
    })
    const result = await dispatcher.dispatch("app.terminal.session.create", {
      idempotencyKey: "019f8a39-0000-7000-8000-000000000001",
    }, {
      source: "mcp-http",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http" },
      clientId: "mcp-install:synapse-mcp/http",
    })

    expect(result).toMatchObject({ ok: true, data: { sessionId: created.id, inputRevision: 0 } })
    expect(createMcpSession).toHaveBeenCalledWith(expect.anything(), "mcp-install:synapse-mcp/http")
  })

  it("returns the complete capability baseline without object or grant data", async () => {
    const dispatcher = createTerminalCapabilityDispatcher({ service: serviceStub(), platform: "win32" })
    const result = await dispatcher.dispatch("app.terminal.capabilities.get", {}, localMcpContext)
    expect(result).toMatchObject({
      ok: true,
      data: {
        capabilities: expect.any(Array),
        termination: { forceStopSupported: false },
        raw: { arbitraryBinaryTransparent: false },
      },
    })
    if (!result.ok) throw new Error("Expected a successful capability response")
    const capabilityData = result.data as { capabilities: unknown[] }
    expect(capabilityData.capabilities).toHaveLength(TERMINAL_CAPABILITY_CATALOG.length)
    expect(result.data).toMatchObject({ hardBounds: { globalRunningSessions: 32 } })
    expect(JSON.stringify(result)).not.toContain("clientRunningSessions")
    expect(JSON.stringify(result)).not.toContain("sessionCount")
    expect(JSON.stringify(result)).not.toContain("clientId")
  })

  it("does not turn diagnostics into an object-count side channel", async () => {
    const security = allowingSecurity()
    const dispatcher = createTerminalCapabilityDispatcher({
      service: serviceStub({ listGroups: vi.fn(() => [{ id: "hidden-group" }]), listSessions: vi.fn(() => [{ id: "hidden-session" }]) }),
      ...security,
    })
    const result = await dispatcher.dispatch("app.terminal.diagnostics.get", {}, localMcpContext)
    expect(result).toMatchObject({ ok: true, data: { objectCountsUnavailable: true } })
    expect(JSON.stringify(result)).not.toContain("sessionCount")
    expect(JSON.stringify(result)).not.toContain("groupCount")
  })

  it("reads and updates global launch settings without exposing environment values", async () => {
    const current = {
      revision: 3,
      updatedAt: "2026-08-08T00:00:00.000Z",
      settings: { shell: "/bin/zsh", environment: { GROK_SCROLL_MODE: "wheel", BLOCKED: null } },
    }
    const updateGlobalLaunchSettings = vi.fn(async (input) => ({
      revision: 4,
      updatedAt: "2026-08-08T00:01:00.000Z",
      settings: input.settings,
    }))
    const security = allowingSecurity()
    const dispatcher = createTerminalCapabilityDispatcher({
      service: serviceStub({
        getGlobalLaunchSettings: vi.fn(() => current),
        updateGlobalLaunchSettings,
      }),
      ...security,
    })

    const read = await dispatcher.dispatch("app.terminal.global_launch.get", {}, localMcpContext)
    expect(read).toMatchObject({
      ok: true,
      data: {
        revision: 3,
        shell: "/bin/zsh",
        environment: [
          { key: "BLOCKED", action: "unset", source: "global" },
          { key: "GROK_SCROLL_MODE", action: "set", source: "global" },
        ],
      },
    })
    expect(JSON.stringify(read)).not.toContain("wheel")

    const updated = await dispatcher.dispatch("app.terminal.global_launch.update", {
      expectedRevision: 3,
      settings: {
        environment: { GROK_SCROLL_LINES: "9" },
        inheritEnvironmentKeys: ["BLOCKED"],
      },
      idempotencyKey: "019f8a39-0000-7000-8000-000000000099",
    }, localMcpContext)
    expect(updated).toMatchObject({ ok: true, data: { afterRevision: 4 } })
    expect(updateGlobalLaunchSettings).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 3,
      settings: expect.objectContaining({ environment: {
        GROK_SCROLL_MODE: "wheel",
        GROK_SCROLL_LINES: "9",
      } }),
    }))
    expect(security.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "terminal.settings.manage",
      resource: "terminal:domain",
    }))
    expect(JSON.stringify(updated)).not.toContain("wheel")
    expect(JSON.stringify(updated)).not.toContain('"9"')
  })

  it("reports launch-setting validation failures without exposing environment values", async () => {
    const security = allowingSecurity()
    const dispatcher = createTerminalCapabilityDispatcher({
      service: serviceStub({
        getGlobalLaunchSettings: vi.fn(() => ({ revision: 3, settings: {} })),
        updateGlobalLaunchSettings: vi.fn(() => {
          throw new TerminalLaunchValidationError("Protected Terminal environment key")
        }),
      }),
      ...security,
    })

    const result = await dispatcher.dispatch("app.terminal.global_launch.update", {
      expectedRevision: 3,
      settings: { environment: { TERM_PROGRAM: "sensitive-value" } },
      idempotencyKey: "019f8a39-0000-7000-8000-000000000100",
    }, localMcpContext)

    expect(result).toMatchObject({
      ok: false,
      error: { code: "validation_error", category: "validation", retryable: false },
    })
    expect(JSON.stringify(result)).not.toContain("sensitive-value")
    expect(JSON.stringify(result)).not.toContain("Protected Terminal environment key")
    expect(security.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      metadata: expect.objectContaining({ stage: "result", result: "validation_error" }),
    }))
  })

  it("checks state permission before resolving a session and never returns output", async () => {
    const service = serviceStub()
    const security = allowingSecurity()
    const dispatcher = createTerminalCapabilityDispatcher({ service, ...security })
    const result = await dispatcher.dispatch("app.terminal.session_state.get", {
      sessionId: "11111111-1111-4111-8111-111111111111",
    }, localMcpContext)
    expect(result).toMatchObject({ ok: true })
    expect(security.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "terminal.state.read",
      resource: "terminal:session:11111111-1111-4111-8111-111111111111",
    }))
    expect(JSON.stringify(result)).not.toContain("chunks")
  })

  it("requires both state and output permissions for output observation", async () => {
    const security = allowingSecurity()
    const dispatcher = createTerminalCapabilityDispatcher({ service: serviceStub(), ...security })
    await dispatcher.dispatch("app.terminal.session_output.observe", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      afterStateRevision: 0,
      afterOutputSeq: 0,
      maxWaitMs: 0,
      limitBytes: 1024,
    }, localMcpContext)
    expect(security.permissionGuard.check.mock.calls.map(([request]) => request.action)).toEqual([
      "terminal.state.read",
      "terminal.output.read",
    ])
  })

  it("filters batch state results through per-session discover and state grants", async () => {
    const allowedId = "11111111-1111-4111-8111-111111111111"
    const deniedId = "22222222-2222-4222-8222-222222222222"
    const service = serviceStub({
      listSessions: vi.fn(() => [
        { id: allowedId, groupId: "33333333-3333-4333-8333-333333333333", title: "Allowed", createdAt: "2026-07-22T00:00:00.000Z", status: "running", creationSource: "ui" },
        { id: deniedId, groupId: "33333333-3333-4333-8333-333333333333", title: "Denied", createdAt: "2026-07-22T00:00:01.000Z", status: "running", creationSource: "ui" },
      ]),
      getSessionState: vi.fn((sessionId: string) => ({ sessionId, lifecycle: "running", attention: { state: "unknown" } })),
    })
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async (request) => request.resource === "terminal:domain" || request.resource.endsWith(allowedId)
        ? { allowed: true as const }
        : { allowed: false as const, reason: "scope" }),
    } satisfies PermissionGuard
    const dispatcher = createTerminalCapabilityDispatcher({ service, permissionGuard })
    const result = await dispatcher.dispatch("app.terminal.session_state.list", {}, localMcpContext)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error("Expected a successful state list response")
    const stateList = result.data as { items: Array<{ sessionId: string }> }
    expect(stateList.items.map((item) => item.sessionId)).toEqual([allowedId])
    expect(service.getSessionState).not.toHaveBeenCalledWith(deniedId, expect.anything())
  })

  it("binds semantic input to the trusted controller context, not a tool parameter", async () => {
    const service = serviceStub()
    const security = allowingSecurity()
    const dispatcher = createTerminalCapabilityDispatcher({ service, ...security })
    const result = await dispatcher.dispatch("app.terminal.session_input.send", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      leaseId: "22222222-2222-4222-8222-222222222222",
      expectedInputRevision: 0,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000001",
      actions: [{ type: "text", text: "pwd" }, { type: "key", key: "Enter" }],
    }, localMcpContext)
    expect(result).toMatchObject({ ok: true })
    expect(service.sendSemanticInput).toHaveBeenCalledWith(expect.anything(), {
      clientId: "mcp-install:test",
      controllerInstanceId: "controller:test",
      actorKind: "user",
    })
    expect(JSON.stringify(security.auditSink.record.mock.calls)).not.toContain("pwd")
  })

  it("returns permission_denied without probing object existence", async () => {
    const service = serviceStub({ getSessionState: vi.fn(() => { throw new Error("must not run") }) })
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: false as const, reason: "denied" })),
    } satisfies PermissionGuard
    const dispatcher = createTerminalCapabilityDispatcher({ service, permissionGuard })
    const result = await dispatcher.dispatch("app.terminal.session_state.get", {
      sessionId: "11111111-1111-4111-8111-111111111111",
    }, localMcpContext)
    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } })
    expect(service.getSessionState).not.toHaveBeenCalled()
  })

  it("accepts the current contract without version negotiation", async () => {
    const dispatcher = createTerminalCapabilityDispatcher({ service: serviceStub(), ...allowingSecurity() })
    const result = await dispatcher.dispatch("app.terminal.session.list", {}, localMcpContext)
    expect(result).toMatchObject({ ok: true })
  })
})
