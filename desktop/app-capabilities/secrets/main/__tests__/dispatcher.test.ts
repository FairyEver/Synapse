import { describe, expect, it, vi } from "vitest"

import type { AuditSink, PermissionGuard } from "../../../../electron/runtime/security"
import { mcpClientActorForSource } from "../../../../synapse-capabilities/shared/types"
import {
  SECRETS_ITEM_CREATE_CAPABILITY_ID,
  SECRETS_ITEM_DELETE_CAPABILITY_ID,
  SECRETS_ITEM_GET_CAPABILITY_ID,
  SECRETS_ITEM_LIST_CAPABILITY_ID,
  SECRETS_ITEM_UPDATE_CAPABILITY_ID,
  SECRETS_ITEM_UPSERT_CAPABILITY_ID,
} from "../../shared/capability"
import type { SecretSafeView } from "../../shared/schema"
import { createSecretsCapabilityDispatcher } from "../dispatcher"
import type { SecretsService } from "../service"

const secretFixture: SecretSafeView = {
  id: "secret-1",
  name: "TOKEN",
  description: "api token",
  hasValue: true,
}

function createHarness(options: {
  readonly service?: Partial<SecretsService>
  readonly allow?: boolean
} = {}) {
  const auditEvents: Parameters<AuditSink["record"]>[0][] = []
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => options.allow === false
      ? { allowed: false as const, reason: "denied before service", policyId: "test-deny" }
      : { allowed: true as const }),
  }
  const auditSink: AuditSink = {
    record: (event) => {
      auditEvents.push(event)
    },
    list: () => [],
    clearForTests: () => undefined,
  }
  const service = {
    events: { on: vi.fn(), emit: vi.fn() },
    initialize: vi.fn(),
    list: vi.fn(async () => ({ secrets: [secretFixture], total: 1 })),
    get: vi.fn(async () => secretFixture),
    create: vi.fn(async () => secretFixture),
    update: vi.fn(async () => secretFixture),
    upsert: vi.fn(async () => ({ secret: secretFixture, created: false })),
    delete: vi.fn(async () => secretFixture),
    ...options.service,
  } as unknown as SecretsService
  const dispatcher = createSecretsCapabilityDispatcher({
    service,
    permissionGuard,
    auditSink,
    actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
  })
  return { auditEvents, dispatcher, permissionGuard, service }
}

describe("createSecretsCapabilityDispatcher", () => {
  it("lists secrets without values and audits only inventory count", async () => {
    const { auditEvents, dispatcher, permissionGuard } = createHarness()

    await expect(dispatcher.dispatch(SECRETS_ITEM_LIST_CAPABILITY_ID, {}, {
      source: "mcp-http",
      actor: mcpClientActorForSource("mcp-http"),
    })).resolves.toEqual({
      ok: true,
      data: { secrets: [secretFixture], total: 1 },
      total: 1,
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "secret.read",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "secret:user:*",
      context: {
        source: "mcp-http",
        secretAction: SECRETS_ITEM_LIST_CAPABILITY_ID,
        includeValue: false,
      },
    })
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "allowed",
      resource: "secret:user:*",
      metadata: expect.objectContaining({ secretCount: 1 }),
    }))
    expect(JSON.stringify(auditEvents)).not.toContain("api token")
    expect(JSON.stringify(auditEvents)).not.toContain("TOKEN")
  })

  it("gets values only when includeValue is true and keeps audit redacted", async () => {
    const service = {
      get: vi.fn(async () => ({ ...secretFixture, value: "super-secret" })),
    }
    const { auditEvents, dispatcher, permissionGuard } = createHarness({ service })

    await expect(
      dispatcher.dispatch(SECRETS_ITEM_GET_CAPABILITY_ID, { name: "TOKEN", includeValue: true }, { source: "mcp-http" }),
    ).resolves.toEqual({
      ok: true,
      data: { secret: { ...secretFixture, value: "super-secret" } },
    })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.read",
      resource: "secret:user:TOKEN",
      context: expect.objectContaining({
        secretAction: SECRETS_ITEM_GET_CAPABILITY_ID,
        includeValue: true,
      }),
    }))
    expect(service.get).toHaveBeenCalledWith({ name: "TOKEN", includeValue: true })
    expect(JSON.stringify(auditEvents)).not.toContain("super-secret")
    expect(JSON.stringify(auditEvents)).not.toContain('"value"')
  })

  it("routes mutations through secret.write and never audits raw values", async () => {
    const { auditEvents, dispatcher, permissionGuard, service } = createHarness()

    await expect(dispatcher.dispatch(SECRETS_ITEM_CREATE_CAPABILITY_ID, {
      name: "BARK_TOKEN",
      value: "new-secret",
      description: "phone push",
    }, { source: "mcp-http" })).resolves.toMatchObject({
      ok: true,
      data: { secret: secretFixture, created: true },
      affected: 1,
    })
    await expect(dispatcher.dispatch(SECRETS_ITEM_UPDATE_CAPABILITY_ID, {
      name: "BARK_TOKEN",
      newName: "BARK_ID",
      value: "changed-secret",
    }, { source: "mcp-http" })).resolves.toMatchObject({ ok: true, affected: 1 })
    await expect(dispatcher.dispatch(SECRETS_ITEM_UPSERT_CAPABILITY_ID, {
      name: "BARK_ID",
      value: "upsert-secret",
    }, { source: "mcp-http" })).resolves.toMatchObject({ ok: true, affected: 1 })
    await expect(dispatcher.dispatch(SECRETS_ITEM_DELETE_CAPABILITY_ID, {
      name: "BARK_ID",
    }, { source: "mcp-http" })).resolves.toMatchObject({ ok: true, affected: 1 })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      resource: "secret:user:BARK_TOKEN",
    }))
    expect(service.create).toHaveBeenCalledWith({
      name: "BARK_TOKEN",
      value: "new-secret",
      description: "phone push",
    })
    const auditJson = JSON.stringify(auditEvents)
    expect(auditJson).not.toContain("new-secret")
    expect(auditJson).not.toContain("changed-secret")
    expect(auditJson).not.toContain("upsert-secret")
    expect(auditJson).not.toContain("phone push")
  })

  it("audits failures without raw error messages", async () => {
    const { auditEvents, dispatcher } = createHarness({
      service: {
        get: vi.fn(async () => {
          throw new Error("failed with token=super-secret at /Users/me/.secret")
        }),
      },
    })

    await expect(
      dispatcher.dispatch(SECRETS_ITEM_GET_CAPABILITY_ID, { name: "TOKEN", includeValue: true }, { source: "mcp-http" }),
    ).rejects.toThrow("failed with token=super-secret")

    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "failed",
      resource: "secret:user:TOKEN",
      metadata: expect.objectContaining({
        errorName: "Error",
        errorLength: "Error: failed with token=super-secret at /Users/me/.secret".length,
      }),
    }))
    expect(JSON.stringify(auditEvents)).not.toContain("token=super-secret")
    expect(JSON.stringify(auditEvents)).not.toContain("/Users/me")
  })

  it("stops before service access when permission is denied", async () => {
    const { auditEvents, dispatcher, service } = createHarness({ allow: false })

    await expect(
      dispatcher.dispatch(SECRETS_ITEM_GET_CAPABILITY_ID, { name: "TOKEN", includeValue: true }, { source: "mcp-http" }),
    ).rejects.toThrow("denied before service")

    expect(service.get).not.toHaveBeenCalled()
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "denied",
      resource: "secret:user:TOKEN",
      metadata: expect.objectContaining({
        reason: "denied before service",
        policyId: "test-deny",
      }),
    }))
  })
})
