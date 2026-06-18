import { describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../runtime/ipc/types"
import { gitIpcModule } from "../ipc"

function createContext(resolveMap: Record<string, unknown>): IpcHandlerContext {
  return {
    moduleId: "git",
    resolve: <T,>(key: string): T => {
      const service = resolveMap[key]
      if (!service) throw new Error(`Unexpected service id: ${key}`)
      return service as T
    },
  }
}

describe("gitIpcModule", () => {
  it("declares structured channels", () => {
    expect(gitIpcModule.id).toBe("git")
    expect(gitIpcModule.methods.listRepositories.channel).toBe("synapse:git:repositories:list")
    expect(gitIpcModule.methods.listRepositorySummaries.channel).toBe("synapse:git:repositories:list-summaries")
    expect(gitIpcModule.methods.getSnapshot.channel).toBe("synapse:git:status:get-snapshot")
    expect(gitIpcModule.methods.commit.channel).toBe("synapse:git:commit:create")
  })

  it("rejects arbitrary git command payloads", () => {
    expect(gitIpcModule.methods.getSnapshot.request.safeParse({ repositoryId: "repo-1", args: ["status"] }).success).toBe(false)
  })

  it("accepts only supported repository removal modes", () => {
    expect(gitIpcModule.methods.removeRepository.request.safeParse({ repositoryId: "repo-1", mode: "keep-local" }).success).toBe(true)
    expect(gitIpcModule.methods.removeRepository.request.safeParse({ repositoryId: "repo-1", mode: "trash-local" }).success).toBe(true)
    expect(gitIpcModule.methods.removeRepository.request.safeParse({ repositoryId: "repo-1", mode: "delete-local" }).success).toBe(false)
    expect(gitIpcModule.methods.removeRepository.request.safeParse({ repositoryId: "repo-1", mode: "keep-local", extra: true }).success).toBe(false)
  })

  it("returns extended Git environment diagnostics", () => {
    const responseSchema = gitIpcModule.methods.checkEnvironment.response
    expect(responseSchema).toBeDefined()
    if (!responseSchema) throw new Error("Missing checkEnvironment response schema.")

    expect(responseSchema.safeParse({
      checkedAt: "2026-06-18T10:00:00.000Z",
      platform: "darwin",
      homeDir: "/Users/writer",
      gitAvailable: true,
      gitVersion: "git version 2.50.0",
      gitPath: "/usr/bin/git",
      processPath: "/usr/bin",
      shellPath: "/opt/homebrew/bin:/usr/bin",
      effectivePath: "/usr/bin:/opt/homebrew/bin",
      processGitPath: "/usr/bin/git",
      shellGitPath: "/opt/homebrew/bin/git",
      effectiveGitPath: "/usr/bin/git",
      sshAvailable: true,
      userName: "Writer",
      userEmail: "writer@example.com",
      userNameSource: "file:/Users/writer/.gitconfig",
      userEmailSource: "file:/Users/writer/.gitconfig",
      commonSshKeyExists: true,
      sshPublicKeyPath: "/Users/writer/.ssh/id_ed25519.pub",
      sshPublicKeyType: "ssh-ed25519",
      sshPublicKeyComment: "writer@example.com",
      sshPublicKeyFingerprint: "SHA256:test",
      installHint: null,
    }).success).toBe(true)
  })

  it("lists repositories through the registry service", async () => {
    const registry = {
      list: vi.fn().mockResolvedValue([
        { id: "repo-1", name: "Docs", localPath: "/repo", addedAt: "now", lastOpenedAt: null },
      ]),
    }
    const result = await gitIpcModule.methods.listRepositories.handler(createContext({ "git.repository-registry": registry }), undefined)

    expect(result).toHaveLength(1)
  })

  it("lists repository summaries through registry and status services", async () => {
    const repository = { id: "repo-1", name: "Docs", localPath: "/repo", addedAt: "now", lastOpenedAt: null }
    const registry = {
      list: vi.fn().mockResolvedValue([repository]),
    }
    const statusService = {
      listSummaries: vi.fn().mockResolvedValue([{ repository, snapshot: null, error: "not ready" }]),
    }

    const result = await gitIpcModule.methods.listRepositorySummaries.handler(createContext({
      "git.repository-registry": registry,
      "git.status-service": statusService,
    }), undefined)

    expect(statusService.listSummaries).toHaveBeenCalledWith([repository])
    expect(result).toEqual([{ repository, snapshot: null, error: "not ready" }])
  })

  it("reads SSH public key through environment service", async () => {
    const environment = {
      getSshPublicKey: vi.fn().mockResolvedValue({
        path: "/Users/writer/.ssh/id_ed25519.pub",
        content: "ssh-ed25519 public-key",
      }),
    }

    const result = await gitIpcModule.methods.getSshPublicKey.handler(createContext({
      "git.environment-service": environment,
    }), undefined)

    expect(result).toEqual({
      path: "/Users/writer/.ssh/id_ed25519.pub",
      content: "ssh-ed25519 public-key",
    })
  })

  it("removes repositories through the registry service", async () => {
    const registry = {
      remove: vi.fn().mockResolvedValue(undefined),
    }

    await gitIpcModule.methods.removeRepository.handler(
      createContext({ "git.repository-registry": registry }),
      { repositoryId: "repo-1", mode: "trash-local" },
    )

    expect(registry.remove).toHaveBeenCalledWith({ repositoryId: "repo-1", mode: "trash-local" })
  })
})
