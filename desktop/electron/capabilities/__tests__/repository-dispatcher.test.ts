import { describe, expect, it, vi } from "vitest"

import { createDefaultConfig } from "../../../src/lib/config"
import type { SynapseConfig } from "../../../src/types/config"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createRepositoryCapabilityDispatcher } from "../repository-dispatcher"

function configFixture(patch: Partial<SynapseConfig> = {}): SynapseConfig {
  return {
    ...createDefaultConfig(),
    ...patch,
  }
}

describe("repository capability dispatcher", () => {
  it("checks permission and audits repository list access", async () => {
    const { auditEvents, auditSink, permissionGuard } = createSecurityHarness()
    const dispatcher = createRepositoryCapabilityDispatcher({
      loadConfig: async () => configFixture(),
      permissionGuard,
      auditSink,
    })

    await expect(dispatcher.dispatch("repository.item.list", {}, { source: "mcp-http" })).resolves.toMatchObject({
      ok: true,
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
      resource: "repository:list",
      context: {
        source: "mcp-http",
        repositoryAction: "repository.item.list",
      },
    })
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
      resource: "repository:list",
    }))
  })

  it("blocks repository list access when permission is denied", async () => {
    const { auditEvents, auditSink, permissionGuard } = createSecurityHarness()
    vi.mocked(permissionGuard.check).mockResolvedValueOnce({
      allowed: false,
      reason: "denied by policy",
      policyId: "test-policy",
    })
    const dispatcher = createRepositoryCapabilityDispatcher({
      loadConfig: async () => configFixture(),
      permissionGuard,
      auditSink,
    })

    await expect(dispatcher.dispatch("repository.item.list", {}, { source: "api" }))
      .rejects.toThrow("denied by policy")
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "denied",
      resource: "repository:list",
      metadata: expect.objectContaining({
        reason: "denied by policy",
        policyId: "test-policy",
      }),
    }))
  })

  it("lists configured repositories and marks the active repository", async () => {
    const dispatcher = createRepositoryCapabilityDispatcher({
      loadConfig: async () =>
        configFixture({
          activeRepoUuid: "repo-2",
          repositories: [
            {
              uuid: "repo-1",
              name: "One",
              localPath: "/repo/one",
              contentDirs: {},
            },
            {
              uuid: "repo-2",
              name: "Two",
              localPath: "/repo/two",
              contentDirs: {},
            },
          ],
        }),
    })

    await expect(dispatcher.dispatch("repository.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: {
        activeRepositoryUuid: "repo-2",
        repositories: [
          {
            uuid: "repo-1",
            name: "One",
            localPath: "/repo/one",
            isActive: false,
          },
          {
            uuid: "repo-2",
            name: "Two",
            localPath: "/repo/two",
            isActive: true,
          },
        ],
      },
      total: 2,
    })
  })

  it("rejects unknown repository actions", async () => {
    const dispatcher = createRepositoryCapabilityDispatcher({
      loadConfig: async () => configFixture(),
    })

    await expect(dispatcher.dispatch("repository.item.delete", {}, { source: "api" })).rejects.toThrow(
      "Unknown repository action",
    )
  })
})

function createSecurityHarness() {
  const auditEvents: Parameters<AuditSink["record"]>[0][] = []
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

  return { auditEvents, auditSink, permissionGuard }
}
