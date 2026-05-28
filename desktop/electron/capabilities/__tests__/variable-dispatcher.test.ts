import { describe, expect, it, vi } from "vitest"

import { createDefaultConfig } from "../../../src/lib/config"
import type { SynapseConfig, SynapseConfigPatch } from "../../../src/types/config"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createVariableCapabilityDispatcher } from "../variable-dispatcher"

function configFixture(patch: Partial<SynapseConfig> = {}): SynapseConfig {
  return {
    ...createDefaultConfig(),
    ...patch,
  }
}

function createHarness(config: SynapseConfig) {
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
    loadConfig: async () => structuredClone(current),
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
  activeRepoUuid: "repo-1",
  repositories: [
    {
      uuid: "repo-1",
      name: "Main",
      localPath: "/repo/main",
      contentDirs: {},
      variables: [
        { name: "TOKEN", value: "secret", description: "api token" },
        { name: "EMPTY", value: "" },
      ],
    },
    {
      uuid: "repo-2",
      name: "Other",
      localPath: "/repo/other",
      contentDirs: {},
      variables: [{ name: "OTHER", value: "other-secret" }],
    },
  ],
})

describe("variable capability dispatcher", () => {
  it("lists variables in the active repository without values", async () => {
    const { dispatcher } = createHarness(baseConfig)

    await expect(dispatcher.dispatch("variable.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: {
        repository: { uuid: "repo-1", name: "Main", isActive: true },
        variables: [
          { name: "TOKEN", description: "api token", hasValue: true },
          { name: "EMPTY", hasValue: false },
        ],
        total: 2,
      },
      total: 2,
    })
  })

  it("uses repositoryUuid when provided", async () => {
    const { dispatcher } = createHarness(baseConfig)
    const result = await dispatcher.dispatch("variable.item.list", { repositoryUuid: "repo-2" }, { source: "api" })

    expect(result).toMatchObject({
      data: {
        repository: { uuid: "repo-2", name: "Other", isActive: false },
        variables: [{ name: "OTHER", hasValue: true }],
      },
    })
  })

  it("gets one variable without value by default", async () => {
    const { dispatcher, permissionGuard } = createHarness(baseConfig)

    await expect(dispatcher.dispatch("variable.item.get", { name: "token" }, { source: "api" })).resolves.toMatchObject({
      data: {
        variable: { name: "TOKEN", description: "api token", hasValue: true },
      },
    })
    expect(permissionGuard.check).not.toHaveBeenCalled()
  })

  it("requires secret.read and audits when includeValue is true", async () => {
    const { auditEvents, dispatcher, permissionGuard } = createHarness(baseConfig)

    await expect(
      dispatcher.dispatch("variable.item.get", { name: "TOKEN", includeValue: true }, { source: "mcp-http" }),
    ).resolves.toMatchObject({
      data: {
        variable: { name: "TOKEN", value: "secret", hasValue: true },
      },
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "secret.read",
      actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
      resource: "variable:repo-1:TOKEN",
      context: {
        source: "mcp-http",
        variableAction: "variable.item.get",
        repositoryUuid: "repo-1",
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
      resource: "variable:repo-1:TOKEN",
    }))
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

    expect(getConfig().repositories[0]?.variables?.map((variable) => variable.name)).toEqual(["TOKEN", "EMPTY"])
    expect(updateConfig).toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({ action: "secret.write" }))
    expect(JSON.stringify(auditEvents)).not.toContain("new-secret")
    expect(JSON.stringify(auditEvents)).not.toContain("changed-secret")
    expect(emitted).toContainEqual(expect.objectContaining({
      domain: "repository",
      type: "repository.updated",
      payload: expect.objectContaining({
        repositoryUuid: "repo-1",
        operation: "variables",
      }),
    }))
  })

  it("preserves concurrent creates in the same repository", async () => {
    const { dispatcher, getConfig } = createHarness(configFixture({
      activeRepoUuid: "repo-1",
      repositories: [
        {
          uuid: "repo-1",
          name: "Main",
          localPath: "/repo/main",
          contentDirs: {},
        },
      ],
    }))

    await Promise.all([
      dispatcher.dispatch("variable.item.create", { name: "FIRST", value: "one" }, { source: "mcp-http" }),
      dispatcher.dispatch("variable.item.create", { name: "SECOND", value: "two" }, { source: "mcp-http" }),
    ])

    expect(getConfig().repositories[0]?.variables?.map((variable) => variable.name)).toEqual(["FIRST", "SECOND"])
  })

  it("records failed instead of allowed when a secret write persist fails", async () => {
    const { auditEvents, dispatcher, getConfig, updateConfig } = createHarness(baseConfig)
    updateConfig.mockRejectedValueOnce(new Error("disk unavailable"))

    await expect(
      dispatcher.dispatch("variable.item.create", { name: "BROKEN", value: "secret" }, { source: "mcp-http" }),
    ).rejects.toThrow("disk unavailable")

    expect(getConfig().repositories[0]?.variables?.map((variable) => variable.name)).toEqual(["TOKEN", "EMPTY"])
    expect(auditEvents).not.toContainEqual(expect.objectContaining({
      action: "secret.write",
      outcome: "allowed",
      resource: "variable:repo-1:BROKEN",
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.write",
      outcome: "failed",
      resource: "variable:repo-1:BROKEN",
      metadata: expect.objectContaining({
        errorName: "Error",
      }),
    }))
  })

  it("rejects invalid scopes names duplicates and missing creation values", async () => {
    const { dispatcher } = createHarness(configFixture({
      activeRepoUuid: null,
      repositories: baseConfig.repositories,
    }))

    await expect(dispatcher.dispatch("variable.item.list", {}, { source: "api" })).rejects.toThrow("No active repository")
    await expect(dispatcher.dispatch("variable.item.list", { repositoryUuid: "missing" }, { source: "api" })).rejects.toThrow(
      "Repository not found",
    )
    await expect(
      dispatcher.dispatch("variable.item.create", { repositoryUuid: "repo-1", name: "bad-name", value: "x" }, { source: "api" }),
    ).rejects.toThrow("Variable name")
    await expect(
      dispatcher.dispatch("variable.item.create", { repositoryUuid: "repo-1", name: "token", value: "x" }, { source: "api" }),
    ).rejects.toThrow("already exists")
    await expect(
      dispatcher.dispatch("variable.item.upsert", { repositoryUuid: "repo-1", name: "NEW_ONE" }, { source: "api" }),
    ).rejects.toThrow("requires 'value'")
    await expect(
      dispatcher.dispatch("variable.item.update", { repositoryUuid: "repo-1", name: "missing", value: "x" }, { source: "api" }),
    ).rejects.toThrow("Variable not found")
    await expect(
      dispatcher.dispatch("variable.item.delete", { repositoryUuid: "repo-1", name: "missing" }, { source: "api" }),
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
})
