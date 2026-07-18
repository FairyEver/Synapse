import { describe, expect, it, vi } from "vitest"
import type { SkillRepositoryItemDto } from "@synapse/shared" with { "resolution-mode": "import" }

import { createSkillRepositoryCapabilityDispatcher } from "../skill-repository-dispatcher"
import type { AuditSink, PermissionGuard } from "../../runtime/security"

const repository = {
  id: "repo-1",
  name: "demo",
  title: "Demo",
  description: null,
  visibility: "private",
  status: "active",
  owner: { id: "user-1", handle: "liyang" },
  forkedFromRepositoryId: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  lastSyncedAt: null,
} satisfies SkillRepositoryItemDto

function createDeps(
  overrides: Partial<Parameters<typeof createSkillRepositoryCapabilityDispatcher>[0]> = {},
): Parameters<typeof createSkillRepositoryCapabilityDispatcher>[0] {
  const deps: Parameters<typeof createSkillRepositoryCapabilityDispatcher>[0] = {
    accountService: {
      listSkillRepositories: vi.fn(async () => [repository]),
      getSkillRepository: vi.fn(async () => ({ ...repository, files: [] })),
      updateSkillRepository: vi.fn(async (_repositoryId, input) => ({
        ...repository,
        visibility: input.visibility ?? repository.visibility,
        files: [],
      })),
      forkSkillRepository: vi.fn(async () => ({
        repository: {
          ...repository,
          id: "repo-fork",
          name: "demo-fork",
          forkedFromRepositoryId: "repo-1",
          files: [],
        },
        managementUrl: "https://synapse.example.test/console/skill-repositories/repo-fork",
      })),
      createSkillRepositoryInstallSession: vi.fn(async () => ({
        id: "install-session-1",
        repositoryId: "repo-1",
        repositoryName: "demo",
        ownerHandle: "liyang",
        title: "Demo",
        packageSha256: "a".repeat(64),
        packageSize: 128,
        expiresAt: "2026-07-01T00:05:00.000Z",
        deepLinkUrl: "synapse://skill-install?session=install-session-1",
      })),
    },
    uploadService: {
      importLocal: vi.fn(async () => ({
        repositoryId: "repo-1",
        name: "demo",
        owner: "liyang",
        managementUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
        identityWritten: true,
        identityMigrated: false,
        sourceImportSummary: {
          controlFilesExcluded: [],
          fileCount: 1,
          hiddenEntryCount: 0,
          runtimeEnvExcluded: false,
          symlinkCount: 0,
          totalBytes: 128,
        },
      })),
    },
    publicAppUrl: "https://synapse.example.test",
    openExternal: vi.fn(async () => undefined),
  }
  return { ...deps, ...overrides }
}

describe("skill repository capability dispatcher", () => {
  it("lists private cloud skill repositories", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch("app.skill_repository.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [repository],
      total: 1,
    })
    expect(deps.accountService.listSkillRepositories).toHaveBeenCalledWith()
  })

  it("gets one private cloud skill repository", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.item.get",
      { repositoryId: " repo-1 " },
      { source: "api" },
    )).resolves.toEqual({
      ok: true,
      data: { ...repository, files: [] },
    })
    expect(deps.accountService.getSkillRepository).toHaveBeenCalledWith("repo-1")
  })

  it("authorizes and audits private repository reads without response contents", async () => {
    const { auditSink, permissionGuard } = createSecurity()
    const deps = createDeps({ auditSink, permissionGuard })
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)
    const context = {
      source: "mcp-http" as const,
      actor: { kind: "agent" as const, id: "agent-1" },
    }

    await dispatcher.dispatch("app.skill_repository.item.list", {}, context)
    await dispatcher.dispatch("app.skill_repository.item.get", { repositoryId: "repo-1" }, context)
    await dispatcher.dispatch("app.skill_repository.item.open", { repositoryId: "repo-1" }, context)
    await dispatcher.dispatch("app.skill_repository.public.open", { repositoryId: "repo-1" }, context)

    expect(permissionGuard.check).toHaveBeenCalledTimes(4)
    expect(vi.mocked(permissionGuard.check).mock.calls.map(([request]) => request.context.capabilityAction))
      .toEqual([
        "app.skill_repository.item.list",
        "app.skill_repository.item.get",
        "app.skill_repository.item.open",
        "app.skill_repository.public.open",
      ])
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.read",
      actor: { kind: "agent", id: "agent-1" },
      resource: "skill-repository:repo-1",
      context: expect.objectContaining({
        source: "mcp-http",
        boundary: "skill-repository.mcp",
        repositoryId: "repo-1",
      }),
    }))
    expect(vi.mocked(auditSink.record).mock.calls.filter(([event]) => event.outcome === "allowed"))
      .toHaveLength(4)
    const auditJson = JSON.stringify(vi.mocked(auditSink.record).mock.calls)
    expect(auditJson).not.toContain("files")
    expect(auditJson).not.toContain("Demo")
  })

  it("blocks denied private repository reads before account service access", async () => {
    const { auditSink, permissionGuard } = createSecurity({
      allowed: false,
      reason: "blocked",
      policyId: "policy-1",
    })
    const deps = createDeps({ auditSink, permissionGuard })
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.item.get",
      { repositoryId: "repo-1" },
      { source: "mcp-stdio" },
    )).rejects.toThrow("blocked")

    expect(deps.accountService.getSkillRepository).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.read",
      resource: "skill-repository:repo-1",
      outcome: "denied",
      metadata: expect.objectContaining({ policyId: "policy-1" }),
    }))
  })

  it("audits private repository read failures without error text", async () => {
    const { auditSink, permissionGuard } = createSecurity()
    const deps = createDeps({ auditSink, permissionGuard })
    vi.mocked(deps.accountService.getSkillRepository)
      .mockRejectedValueOnce(new Error("file-content=private-value"))
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.item.get",
      { repositoryId: "repo-1" },
      { source: "mcp-http" },
    )).rejects.toThrow("private-value")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.read",
      resource: "skill-repository:repo-1",
      outcome: "failed",
      metadata: expect.objectContaining({ errorName: "Error" }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls))
      .not.toContain("private-value")
  })

  it("imports a local skill without repositoryId", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.item.import_local",
      {
        sourceDirectoryPath: " /skills/demo ",
        name: "demo",
        title: "Demo",
        description: "Local demo",
        openInBrowser: true,
      },
      { source: "mcp-stdio" },
    )).resolves.toMatchObject({
      ok: true,
      data: {
        repositoryId: "repo-1",
      },
    })
    expect(deps.uploadService.importLocal).toHaveBeenCalledWith({
      sourceDirectoryPath: "/skills/demo",
      name: "demo",
      title: "Demo",
      description: "Local demo",
      openInBrowser: true,
    }, undefined)
  })

  it("updates a local skill with repositoryId", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await dispatcher.dispatch(
      "app.skill_repository.item.update_local",
      {
        repositoryId: " repo-1 ",
        sourceDirectoryPath: "/skills/demo",
      },
      { source: "mcp-http" },
    )

    expect(deps.uploadService.importLocal).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      sourceDirectoryPath: "/skills/demo",
    }, undefined)
  })

  it("returns management URL without opening a browser by default", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.item.open",
      { repositoryId: "repo-1" },
      { source: "api" },
    )).resolves.toEqual({
      ok: true,
      data: {
        repositoryId: "repo-1",
        managementUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
      },
    })
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it("opens the management URL only when requested", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await dispatcher.dispatch(
      "app.skill_repository.item.open",
      { repositoryId: "repo-1", openInBrowser: true },
      { source: "api" },
    )

    expect(deps.openExternal).toHaveBeenCalledWith(
      "https://synapse.example.test/console/skill-repositories/repo-1",
    )
  })

  it("blocks denied management URL reads before opening the browser", async () => {
    const { auditSink, permissionGuard } = createSecurity({
      allowed: false,
      reason: "blocked",
      policyId: "policy-1",
    })
    const deps = createDeps({ auditSink, permissionGuard })
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.item.open",
      { repositoryId: "repo-1", openInBrowser: true },
      { source: "mcp-stdio" },
    )).rejects.toThrow("blocked")

    expect(deps.openExternal).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.read",
      resource: "skill-repository:repo-1",
      outcome: "denied",
      metadata: expect.objectContaining({
        capabilityAction: "app.skill_repository.item.open",
        policyId: "policy-1",
      }),
    }))
  })

  it("sets repository visibility and optionally opens management URL", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.visibility.update",
      { repositoryId: " repo-1 ", visibility: "public", openInBrowser: true },
      { source: "api" },
    )).resolves.toMatchObject({
      ok: true,
      data: {
        repository: {
          id: "repo-1",
          visibility: "public",
        },
        managementUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
      },
    })

    expect(deps.accountService.updateSkillRepository).toHaveBeenCalledWith("repo-1", { visibility: "public" })
    expect(deps.openExternal).toHaveBeenCalledWith("https://synapse.example.test/console/skill-repositories/repo-1")
  })

  it("returns a successful visibility update when opening the browser fails", async () => {
    const { auditSink, permissionGuard } = createSecurity()
    const deps = createDeps({
      auditSink,
      permissionGuard,
      openExternal: vi.fn(async () => { throw new Error("private-url-value") }),
    })
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.visibility.update",
      { repositoryId: "repo-1", visibility: "public", openInBrowser: true },
      { source: "mcp-http" },
    )).resolves.toMatchObject({
      ok: true,
      data: {
        repository: { id: "repo-1", visibility: "public" },
        openWarning: expect.stringContaining("操作已完成"),
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.mutate",
      outcome: "allowed",
      resource: "skill-repository:repo-1",
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("private-url-value")
  })

  it("returns a public URL from repository id", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.public.open",
      { repositoryId: "repo-1" },
      { source: "api" },
    )).resolves.toEqual({
      ok: true,
      data: {
        publicUrl: "https://synapse.example.test/console/skills/liyang/demo",
        ownerHandle: "liyang",
        repositoryName: "demo",
        repositoryId: "repo-1",
      },
    })
    expect(deps.accountService.getSkillRepository).toHaveBeenCalledWith("repo-1")
  })

  it("opens a public URL from owner handle and repository name when requested", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await dispatcher.dispatch(
      "app.skill_repository.public.open",
      { ownerHandle: " liyang ", repositoryName: " demo ", openInBrowser: true },
      { source: "api" },
    )

    expect(deps.openExternal).toHaveBeenCalledWith(
      "https://synapse.example.test/console/skills/liyang/demo",
    )
    expect(deps.accountService.getSkillRepository).not.toHaveBeenCalled()
  })

  it("forks a readable repository", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.fork.create",
      { repositoryId: "repo-1", name: "demo-copy", title: "Demo Copy" },
      { source: "api" },
    )).resolves.toMatchObject({
      ok: true,
      data: {
        repository: {
          id: "repo-fork",
        },
      },
    })
    expect(deps.accountService.forkSkillRepository).toHaveBeenCalledWith("repo-1", {
      name: "demo-copy",
      title: "Demo Copy",
    })
  })

  it("creates and optionally opens a Desktop install session", async () => {
    const deps = createDeps()
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.install_session.create",
      { repositoryId: "repo-1", openInBrowser: true },
      { source: "api" },
    )).resolves.toMatchObject({
      ok: true,
      data: {
        id: "install-session-1",
        deepLinkUrl: "synapse://skill-install?session=install-session-1",
      },
    })
    expect(deps.accountService.createSkillRepositoryInstallSession).toHaveBeenCalledWith("repo-1")
    expect(deps.openExternal).toHaveBeenCalledWith("synapse://skill-install?session=install-session-1")
  })

  it("returns a created install session when opening its deep link fails", async () => {
    const deps = createDeps({
      openExternal: vi.fn(async () => { throw new Error("deep-link-open-failed") }),
    })
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.install_session.create",
      { repositoryId: "repo-1", openInBrowser: true },
      { source: "api" },
    )).resolves.toMatchObject({
      ok: true,
      data: {
        id: "install-session-1",
        openWarning: expect.stringContaining("操作已完成"),
      },
    })
  })

  it("rejects missing or empty required params", async () => {
    const dispatcher = createSkillRepositoryCapabilityDispatcher(createDeps())

    await expect(dispatcher.dispatch("app.skill_repository.item.get", {}, { source: "api" }))
      .rejects.toThrow("repositoryId")
    await expect(dispatcher.dispatch(
      "app.skill_repository.item.import_local",
      { sourceDirectoryPath: " " },
      { source: "api" },
    )).rejects.toThrow("sourceDirectoryPath")
    await expect(dispatcher.dispatch(
      "app.skill_repository.item.update_local",
      { sourceDirectoryPath: "/skills/demo" },
      { source: "api" },
    )).rejects.toThrow("repositoryId")
    await expect(dispatcher.dispatch(
      "app.skill_repository.item.open",
      { repositoryId: "" },
      { source: "api" },
    )).rejects.toThrow("repositoryId")
    await expect(dispatcher.dispatch(
      "app.skill_repository.visibility.update",
      { repositoryId: "repo-1", visibility: "team" },
      { source: "api" },
    )).rejects.toThrow("visibility")
    await expect(dispatcher.dispatch(
      "app.skill_repository.public.open",
      {},
      { source: "api" },
    )).rejects.toThrow("repositoryId")
    await expect(dispatcher.dispatch(
      "app.skill_repository.fork.create",
      {},
      { source: "api" },
    )).rejects.toThrow("repositoryId")
    await expect(dispatcher.dispatch(
      "app.skill_repository.install_session.create",
      {},
      { source: "api" },
    )).rejects.toThrow("repositoryId")
  })

  it("passes upload security when audit and permission dependencies are present", async () => {
    const auditSink: AuditSink = {
      record: vi.fn(),
      list: vi.fn(() => []),
      clearForTests: vi.fn(),
    }
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(),
    }
    const deps = createDeps({ auditSink, permissionGuard })
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await dispatcher.dispatch(
      "app.skill_repository.item.import_local",
      { sourceDirectoryPath: "/skills/demo" },
      { source: "mcp-http" },
    )

    expect(deps.uploadService.importLocal).toHaveBeenCalledWith(
      { sourceDirectoryPath: "/skills/demo" },
      expect.objectContaining({
        actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
        auditSink,
        permissionGuard,
      }),
    )
  })

  it("authorizes and audits every cloud mutation without session details", async () => {
    const { auditSink, permissionGuard } = createSecurity()
    const deps = createDeps({ auditSink, permissionGuard })
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)
    const context = {
      source: "mcp-http" as const,
      actor: { kind: "agent" as const, id: "agent-1" },
    }

    await dispatcher.dispatch(
      "app.skill_repository.item.import_local",
      { sourceDirectoryPath: "/Users/example/private-skill" },
      context,
    )
    await dispatcher.dispatch(
      "app.skill_repository.item.update_local",
      { repositoryId: "repo-1", sourceDirectoryPath: "/Users/example/private-skill" },
      context,
    )
    await dispatcher.dispatch(
      "app.skill_repository.visibility.update",
      { repositoryId: "repo-1", visibility: "public" },
      context,
    )
    await dispatcher.dispatch(
      "app.skill_repository.fork.create",
      { repositoryId: "repo-1", name: "private-fork-name" },
      context,
    )
    await dispatcher.dispatch(
      "app.skill_repository.install_session.create",
      { repositoryId: "repo-1" },
      context,
    )

    expect(permissionGuard.check).toHaveBeenCalledTimes(5)
    expect(vi.mocked(permissionGuard.check).mock.calls.map(([request]) => request.context.capabilityAction))
      .toEqual([
        "app.skill_repository.item.import_local",
        "app.skill_repository.item.update_local",
        "app.skill_repository.visibility.update",
        "app.skill_repository.fork.create",
        "app.skill_repository.install_session.create",
      ])
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.mutate",
      actor: { kind: "agent", id: "agent-1" },
      resource: "skill-repository:repo-1",
      context: expect.objectContaining({
        source: "mcp-http",
        boundary: "skill-repository.mcp",
      }),
    }))
    expect(vi.mocked(auditSink.record).mock.calls.filter(([event]) => event.outcome === "allowed"))
      .toHaveLength(5)
    const auditJson = JSON.stringify(vi.mocked(auditSink.record).mock.calls)
    expect(auditJson).not.toContain("/Users/example/private-skill")
    expect(auditJson).not.toContain("private-fork-name")
    expect(auditJson).not.toContain("install-session-1")
    expect(auditJson).not.toContain("deepLinkUrl")
  })

  it("blocks denied local uploads before the upload service runs", async () => {
    const { auditSink, permissionGuard } = createSecurity({
      allowed: false,
      reason: "blocked",
      policyId: "policy-1",
    })
    const deps = createDeps({ auditSink, permissionGuard })
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.item.import_local",
      { sourceDirectoryPath: "/Users/example/private-skill" },
      { source: "mcp-stdio" },
    )).rejects.toThrow("blocked")
    await expect(dispatcher.dispatch(
      "app.skill_repository.item.update_local",
      { repositoryId: "repo-1", sourceDirectoryPath: "/Users/example/private-skill" },
      { source: "mcp-stdio" },
    )).rejects.toThrow("blocked")

    expect(deps.uploadService.importLocal).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.mutate",
      resource: "skill-repository:new",
      outcome: "denied",
      metadata: expect.objectContaining({ policyId: "policy-1" }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.mutate",
      resource: "skill-repository:repo-1",
      outcome: "denied",
      metadata: expect.objectContaining({ policyId: "policy-1" }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls))
      .not.toContain("/Users/example/private-skill")
  })

  it("blocks denied cloud mutations before account service access", async () => {
    const { auditSink, permissionGuard } = createSecurity({
      allowed: false,
      reason: "blocked",
      policyId: "policy-1",
    })
    const deps = createDeps({ auditSink, permissionGuard })
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.install_session.create",
      { repositoryId: "repo-1" },
      { source: "mcp-stdio" },
    )).rejects.toThrow("blocked")

    expect(deps.accountService.createSkillRepositoryInstallSession).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.mutate",
      resource: "skill-repository:repo-1",
      outcome: "denied",
      metadata: expect.objectContaining({ policyId: "policy-1" }),
    }))
  })

  it("audits cloud mutation failures without error text", async () => {
    const { auditSink, permissionGuard } = createSecurity()
    const deps = createDeps({ auditSink, permissionGuard })
    vi.mocked(deps.accountService.forkSkillRepository)
      .mockRejectedValueOnce(new Error("session=private-session-value"))
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.fork.create",
      { repositoryId: "repo-1" },
      { source: "mcp-http" },
    )).rejects.toThrow("private-session-value")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.mutate",
      resource: "skill-repository:repo-1",
      outcome: "failed",
      metadata: expect.objectContaining({ errorName: "Error" }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls))
      .not.toContain("private-session-value")
  })

  it("audits failed local uploads without source paths, contents, or credentials", async () => {
    const { auditSink, permissionGuard } = createSecurity()
    const deps = createDeps({ auditSink, permissionGuard })
    vi.mocked(deps.uploadService.importLocal)
      .mockRejectedValueOnce(new Error("/Users/example/private-skill token=secret skill-content=private"))
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(
      "app.skill_repository.item.import_local",
      { sourceDirectoryPath: "/Users/example/private-skill" },
      { source: "mcp-http" },
    )).rejects.toThrow("skill-content=private")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.mutate",
      resource: "skill-repository:new",
      outcome: "failed",
      metadata: expect.objectContaining({ errorName: "Error" }),
    }))
    const auditJson = JSON.stringify(vi.mocked(auditSink.record).mock.calls)
    expect(auditJson).not.toContain("/Users/example/private-skill")
    expect(auditJson).not.toContain("token=secret")
    expect(auditJson).not.toContain("skill-content=private")
  })

  it("omits upload security when dependencies are incomplete", async () => {
    const deps = createDeps({
      auditSink: {
        record: vi.fn(),
        list: vi.fn(() => []),
        clearForTests: vi.fn(),
      },
    })
    const dispatcher = createSkillRepositoryCapabilityDispatcher(deps)

    await dispatcher.dispatch(
      "app.skill_repository.item.import_local",
      { sourceDirectoryPath: "/skills/demo" },
      { source: "api" },
    )

    expect(deps.uploadService.importLocal).toHaveBeenCalledWith(
      { sourceDirectoryPath: "/skills/demo" },
      undefined,
    )
  })

  it("rejects unknown skill repository actions", async () => {
    const dispatcher = createSkillRepositoryCapabilityDispatcher(createDeps())

    await expect(dispatcher.dispatch("app.skill_repository.item.delete", {}, { source: "api" }))
      .rejects.toThrow("Unknown skill repository action")
  })
})

function createSecurity(
  permissionResult: Awaited<ReturnType<PermissionGuard["check"]>> = { allowed: true },
) {
  const auditSink: AuditSink = {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => permissionResult),
  }
  return { auditSink, permissionGuard }
}
