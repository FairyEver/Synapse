import { describe, expect, it, vi } from "vitest"

import { createDefaultConfig } from "../../../src/lib/config"
import type { SynapseConfig, SynapseConfigPatch } from "../../../src/types/config"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createVariableCapabilityDispatcher } from "../variable-dispatcher"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"

function configFixture(patch: Partial<SynapseConfig> = {}): SynapseConfig {
  return {
    ...createDefaultConfig(),
    ...patch,
  }
}

function createHarness(
  config: SynapseConfig,
  options: {
    readonly loadConfig?: () => Promise<SynapseConfig>
  } = {},
) {
  let current = structuredClone(config)
  const auditEvents: Parameters<AuditSink["record"]>[0][] = []
  const emitted: unknown[] = []
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => ({ allowed: true as const })),
  }
  const auditSink: AuditSink = {
    record: (event) => {
      auditEvents.push(event)
    },
    list: () => [],
    clearForTests: () => undefined,
  }
  const updateConfig = vi.fn(async (patch: SynapseConfigPatch) => {
    current = {
      ...current,
      ...patch,
      repositories: patch.repositories ?? current.repositories,
      global: { ...current.global, ...patch.global },
      agent: { ...current.agent, ...patch.agent },
    }
    return structuredClone(current)
  })
  const dispatcher = createVariableCapabilityDispatcher({
    loadConfig: options.loadConfig ?? (async () => structuredClone(current)),
    updateConfig,
    permissionGuard,
    auditSink,
    eventBus: {
      emit: (event: unknown) => {
        emitted.push(event)
      },
    },
    actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
  })
  return { auditEvents, dispatcher, emitted, permissionGuard, updateConfig, getConfig: () => current }
}

const baseConfig = configFixture({
  global: {
    ...createDefaultConfig().global,
    variables: [
      { name: "TOKEN", value: "secret", description: "api token" },
      { name: "EMPTY", value: "" },
    ],
  },
})

describe("variable capability dispatcher", () => {
  it("lists user variables without values", async () => {
    const { auditEvents, dispatcher, permissionGuard } = createHarness(baseConfig)

    await expect(dispatcher.dispatch("variable.item.list", {}, {
      source: "mcp-http",
      actor: mcpClientActorForSource("mcp-http"),
    })).resolves.toEqual({
      ok: true,
      data: {
        variables: [
          { name: "TOKEN", description: "api token", hasValue: true },
          { name: "EMPTY", hasValue: false },
        ],
        total: 2,
      },
      total: 2,
    })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "secret.read",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "variable:user:*",
      context: {
        source: "mcp-http",
        variableAction: "variable.item.list",
        includeValue: false,
      },
    })
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "allowed",
      resource: "variable:user:*",
      metadata: expect.objectContaining({
        variableCount: 2,
      }),
    }))
    const auditJson = JSON.stringify(auditEvents)
    expect(auditJson).not.toContain("api token")
    expect(auditJson).not.toContain("TOKEN")
  })

  it("rejects repositoryUuid because variables are user scoped", async () => {
    const { dispatcher } = createHarness(baseConfig)

    await expect(
      dispatcher.dispatch("variable.item.list", { repositoryUuid: "repo-2" }, { source: "api" }),
    ).rejects.toThrow("repositoryUuid is no longer supported")
  })

  it("gets one variable without value by default", async () => {
    const { auditEvents, dispatcher, permissionGuard } = createHarness(baseConfig)

    await expect(dispatcher.dispatch("variable.item.get", { name: "token" }, { source: "api" })).resolves.toMatchObject({
      data: {
        variable: { name: "TOKEN", description: "api token", hasValue: true },
      },
    })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "secret.read",
      actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
      resource: "variable:user:token",
      context: {
        source: "api",
        variableAction: "variable.item.get",
        variableName: "token",
        includeValue: false,
      },
    })
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "allowed",
      resource: "variable:user:token",
    }))
  })

  it("requires secret.read and audits when includeValue is true", async () => {
    const { auditEvents, dispatcher, permissionGuard } = createHarness(baseConfig)

    await expect(
      dispatcher.dispatch("variable.item.get", { name: "TOKEN", includeValue: true }, {
        source: "mcp-http",
        actor: mcpClientActorForSource("mcp-http"),
      }),
    ).resolves.toMatchObject({
      data: {
        variable: { name: "TOKEN", value: "secret", hasValue: true },
      },
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "secret.read",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "variable:user:TOKEN",
      context: {
        source: "mcp-http",
        variableAction: "variable.item.get",
        variableName: "TOKEN",
        includeValue: true,
      },
    })
    const auditJson = JSON.stringify(auditEvents)
    expect(auditJson).not.toContain('"value"')
    expect(auditJson).not.toContain('"secret"')
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "allowed",
      resource: "variable:user:TOKEN",
    }))
  })

  it("audits variable get failures after secret read authorization", async () => {
    const loadConfig = vi.fn(async () => {
      throw new Error("config read failed with token=secret at /Users/example/secrets.json")
    })
    const { auditEvents, dispatcher, permissionGuard, updateConfig } = createHarness(baseConfig, { loadConfig })

    await expect(
      dispatcher.dispatch("variable.item.get", { name: "TOKEN", includeValue: true }, { source: "mcp-http" }),
    ).rejects.toThrow("config read failed")

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.read",
      resource: "variable:user:TOKEN",
    }))
    expect(updateConfig).not.toHaveBeenCalled()
    expect(auditEvents).not.toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "allowed",
      resource: "variable:user:TOKEN",
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "failed",
      resource: "variable:user:TOKEN",
      metadata: expect.objectContaining({
        variableAction: "variable.item.get",
        variableName: "TOKEN",
        includeValue: true,
        errorName: "Error",
        errorLength: "Error: config read failed with token=secret at /Users/example/secrets.json".length,
      }),
    }))
    expect(JSON.stringify(auditEvents)).not.toContain("token=secret")
    expect(JSON.stringify(auditEvents)).not.toContain("/Users/example")
  })

  it("creates updates upserts and deletes variables without echoing values", async () => {
    const { auditEvents, dispatcher, emitted, getConfig, permissionGuard, updateConfig } = createHarness(baseConfig)

    await expect(
      dispatcher.dispatch(
        "variable.item.create",
        {
          name: "BARK_ID",
          value: "new-secret",
          description: "phone push",
        },
        { source: "mcp-http" },
      ),
    ).resolves.toMatchObject({
      data: {
        variable: { name: "BARK_ID", description: "phone push", hasValue: true },
        created: true,
      },
    })

    await expect(
      dispatcher.dispatch(
        "variable.item.update",
        {
          name: "BARK_ID",
          newName: "BARK_TOKEN",
          value: "changed-secret",
          description: "",
        },
        { source: "mcp-http" },
      ),
    ).resolves.toMatchObject({
      data: {
        variable: { name: "BARK_TOKEN", hasValue: true },
        updated: true,
      },
    })

    await expect(
      dispatcher.dispatch(
        "variable.item.upsert",
        {
          name: "BARK_TOKEN",
          description: "renamed token",
        },
        { source: "mcp-http" },
      ),
    ).resolves.toMatchObject({
      data: {
        variable: { name: "BARK_TOKEN", description: "renamed token", hasValue: true },
        created: false,
        updated: true,
      },
    })

    await expect(
      dispatcher.dispatch("variable.item.delete", { name: "BARK_TOKEN" }, { source: "mcp-http" }),
    ).resolves.toMatchObject({
      data: {
        variable: { name: "BARK_TOKEN", description: "renamed token", hasValue: true },
        deleted: true,
      },
    })

    expect(getConfig().global.variables.map((variable) => variable.name)).toEqual(["TOKEN", "EMPTY"])
    expect(updateConfig).toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({ action: "secret.write" }))
    expect(JSON.stringify(auditEvents)).not.toContain("new-secret")
    expect(JSON.stringify(auditEvents)).not.toContain("changed-secret")
    expect(emitted).toContainEqual(expect.objectContaining({
      domain: "repository",
      type: "repository.updated",
      payload: expect.objectContaining({
        operation: "variables",
      }),
    }))
  })

  it("preserves concurrent user variable creates", async () => {
    const { dispatcher, getConfig } = createHarness(configFixture({
      global: {
        ...createDefaultConfig().global,
        variables: [],
      },
    }))

    await Promise.all([
      dispatcher.dispatch("variable.item.create", { name: "FIRST", value: "one" }, { source: "mcp-http" }),
      dispatcher.dispatch("variable.item.create", { name: "SECOND", value: "two" }, { source: "mcp-http" }),
    ])

    expect(getConfig().global.variables.map((variable) => variable.name)).toEqual(["FIRST", "SECOND"])
  })

  it("records failed instead of allowed when a secret write persist fails", async () => {
    const { auditEvents, dispatcher, getConfig, updateConfig } = createHarness(baseConfig)
    updateConfig.mockRejectedValueOnce(new Error("disk unavailable"))

    await expect(
      dispatcher.dispatch("variable.item.create", { name: "BROKEN", value: "secret" }, { source: "mcp-http" }),
    ).rejects.toThrow("disk unavailable")

    expect(getConfig().global.variables.map((variable) => variable.name)).toEqual(["TOKEN", "EMPTY"])
    expect(auditEvents).not.toContainEqual(expect.objectContaining({
      action: "secret.write",
      outcome: "allowed",
      resource: "variable:user:BROKEN",
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.write",
      outcome: "failed",
      resource: "variable:user:BROKEN",
      metadata: expect.objectContaining({
        errorName: "Error",
      }),
    }))
  })

  it("records failed audit when an authorized secret write fails validation", async () => {
    const { auditEvents, dispatcher, getConfig, permissionGuard, updateConfig } = createHarness(baseConfig)

    await expect(
      dispatcher.dispatch("variable.item.create", { name: "token", value: "new-secret" }, { source: "mcp-http" }),
    ).rejects.toThrow("already exists")

    expect(updateConfig).not.toHaveBeenCalled()
    expect(getConfig().global.variables.map((variable) => variable.name)).toEqual(["TOKEN", "EMPTY"])
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      resource: "variable:user:token",
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.write",
      outcome: "failed",
      resource: "variable:user:token",
      metadata: expect.objectContaining({
        variableAction: "variable.item.create",
        variableName: "token",
        errorName: "Error",
      }),
    }))
    expect(JSON.stringify(auditEvents)).not.toContain("new-secret")
  })

  it("audits failed variable permission checks without raw error text", async () => {
    const { auditEvents, dispatcher, permissionGuard, updateConfig } = createHarness(baseConfig)
    vi.mocked(permissionGuard.check).mockRejectedValueOnce(
      new Error("policy backend failed token=secret at /Users/example/secrets.json"),
    )

    await expect(
      dispatcher.dispatch("variable.item.get", { name: "TOKEN", includeValue: true }, { source: "mcp-http" }),
    ).rejects.toThrow("policy backend failed")

    expect(updateConfig).not.toHaveBeenCalled()
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "failed",
      resource: "variable:user:TOKEN",
      metadata: expect.objectContaining({
        variableAction: "variable.item.get",
        variableName: "TOKEN",
        reason: "permission-check-error",
        errorName: "Error",
      }),
    }))
    expect(JSON.stringify(auditEvents)).not.toContain("token=secret")
    expect(JSON.stringify(auditEvents)).not.toContain("/Users/example")
  })

  it("authorizes and audits variable renames against the old and new variable names", async () => {
    const { auditEvents, dispatcher, permissionGuard } = createHarness(baseConfig)

    await expect(
      dispatcher.dispatch(
        "variable.item.update",
        { name: "TOKEN", newName: "RENAMED_TOKEN" },
        { source: "mcp-http", actor: mcpClientActorForSource("mcp-http") },
      ),
    ).resolves.toMatchObject({
      data: {
        variable: { name: "RENAMED_TOKEN", hasValue: true },
        updated: true,
      },
    })

    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
      action: "secret.write",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "variable:user:TOKEN",
      context: {
        source: "mcp-http",
        variableAction: "variable.item.update",
        variableName: "TOKEN",
        includeValue: false,
      },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
      action: "secret.write",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "variable:user:RENAMED_TOKEN",
      context: {
        source: "mcp-http",
        variableAction: "variable.item.update",
        variableName: "RENAMED_TOKEN",
        includeValue: false,
      },
    })
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.write",
      outcome: "allowed",
      resource: "variable:user:TOKEN",
      metadata: expect.objectContaining({
        variableName: "TOKEN",
        fromVariableName: "TOKEN",
        toVariableName: "RENAMED_TOKEN",
      }),
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.write",
      outcome: "allowed",
      resource: "variable:user:RENAMED_TOKEN",
      metadata: expect.objectContaining({
        variableName: "RENAMED_TOKEN",
        fromVariableName: "TOKEN",
        toVariableName: "RENAMED_TOKEN",
      }),
    }))
  })

  it("rejects variable renames when the old variable name cannot be written", async () => {
    const { auditEvents, dispatcher, getConfig, permissionGuard, updateConfig } = createHarness(baseConfig)
    vi.mocked(permissionGuard.check).mockImplementation(async ({ resource }) => {
      if (resource === "variable:user:TOKEN") {
        return { allowed: false as const, reason: "old variable denied", policyId: "old-variable-policy" }
      }
      return { allowed: true as const }
    })

    await expect(
      dispatcher.dispatch(
        "variable.item.update",
        { name: "TOKEN", newName: "RENAMED_TOKEN" },
        { source: "mcp-http" },
      ),
    ).rejects.toThrow("old variable denied")

    expect(updateConfig).not.toHaveBeenCalled()
    expect(getConfig().global.variables.map((variable) => variable.name)).toEqual(["TOKEN", "EMPTY"])
    expect(permissionGuard.check).toHaveBeenCalledTimes(1)
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.write",
      outcome: "denied",
      resource: "variable:user:TOKEN",
      metadata: expect.objectContaining({
        variableName: "TOKEN",
        reason: "old variable denied",
        policyId: "old-variable-policy",
      }),
    }))
    expect(auditEvents).not.toContainEqual(expect.objectContaining({
      action: "secret.write",
      resource: "variable:user:RENAMED_TOKEN",
    }))
  })

  it("rejects invalid scopes names duplicates and missing creation values", async () => {
    const { dispatcher } = createHarness(baseConfig)

    await expect(dispatcher.dispatch("variable.item.list", { repositoryUuid: "missing" }, { source: "api" })).rejects.toThrow(
      "repositoryUuid is no longer supported",
    )
    await expect(
      dispatcher.dispatch("variable.item.create", { name: "bad-name", value: "x" }, { source: "api" }),
    ).rejects.toThrow("Variable name")
    await expect(
      dispatcher.dispatch("variable.item.create", { name: "token", value: "x" }, { source: "api" }),
    ).rejects.toThrow("already exists")
    await expect(
      dispatcher.dispatch("variable.item.upsert", { name: "NEW_ONE" }, { source: "api" }),
    ).rejects.toThrow("requires 'value'")
    await expect(
      dispatcher.dispatch("variable.item.update", { name: "missing", value: "x" }, { source: "api" }),
    ).rejects.toThrow("Variable not found")
    await expect(
      dispatcher.dispatch("variable.item.delete", { name: "missing" }, { source: "api" }),
    ).rejects.toThrow("Variable not found")
  })

  it("blocks secret operations when permission is denied", async () => {
    const { dispatcher, permissionGuard } = createHarness(baseConfig)
    vi.mocked(permissionGuard.check).mockResolvedValueOnce({
      allowed: false,
      reason: "denied by test",
      policyId: "test",
    })

    await expect(
      dispatcher.dispatch("variable.item.get", { name: "TOKEN", includeValue: true }, { source: "mcp-http" }),
    ).rejects.toThrow("denied by test")
  })

  it("checks secret permissions before variable inventory probes", async () => {
    const { auditEvents, dispatcher, permissionGuard, updateConfig } = createHarness(baseConfig)
    vi.mocked(permissionGuard.check).mockResolvedValue({
      allowed: false,
      reason: "denied before inventory",
      policyId: "test",
    })

    await expect(dispatcher.dispatch("variable.item.get", { name: "missing" }, { source: "mcp-http" })).rejects.toThrow("denied before inventory")
    await expect(dispatcher.dispatch("variable.item.create", { name: "TOKEN", value: "x" }, { source: "mcp-http" })).rejects.toThrow("denied before inventory")
    await expect(dispatcher.dispatch("variable.item.update", { name: "missing", value: "x" }, { source: "mcp-http" })).rejects.toThrow("denied before inventory")
    await expect(dispatcher.dispatch("variable.item.upsert", { name: "NEW_ONE" }, { source: "mcp-http" })).rejects.toThrow("denied before inventory")
    await expect(dispatcher.dispatch("variable.item.delete", { name: "missing" }, { source: "mcp-http" })).rejects.toThrow("denied before inventory")

    expect(updateConfig).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledTimes(5)
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "denied",
      resource: "variable:user:missing",
      metadata: expect.objectContaining({ variableAction: "variable.item.get" }),
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.write",
      outcome: "denied",
      resource: "variable:user:TOKEN",
      metadata: expect.objectContaining({ variableAction: "variable.item.create" }),
    }))
    expect(JSON.stringify(auditEvents)).not.toContain("\"value\":\"x\"")
  })
})
