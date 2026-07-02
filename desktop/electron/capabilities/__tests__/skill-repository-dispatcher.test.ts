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
  owner: { id: "user-1", handle: "liyang", displayName: "Liyang" },
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
