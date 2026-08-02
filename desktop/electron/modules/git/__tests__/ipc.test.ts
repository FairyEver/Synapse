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
    expect(gitIpcModule.methods.listRepositories.operationId).toBe("app.git.repositories.list")
    expect(gitIpcModule.methods.listRepositorySummaries.operationId).toBe("app.git.repositories.list_summaries")
    expect(gitIpcModule.methods.getSnapshot.operationId).toBe("app.git.status.get_snapshot")
    expect(gitIpcModule.methods.commit.operationId).toBe("app.git.commit.create")
  })

  it("declares access channels", () => {
    expect(gitIpcModule.methods.checkAccess.operationId).toBe("app.git.access.check")
    expect(gitIpcModule.methods.configureCredentialHelper.operationId).toBe("app.git.access.configure_credential_helper")
    expect(gitIpcModule.methods.saveHttpsCredential.operationId).toBe("app.git.access.save_https_credential")
    expect(gitIpcModule.methods.clearHttpsCredential.operationId).toBe("app.git.access.clear_https_credential")
    expect(gitIpcModule.methods.generateSshKey.operationId).toBe("app.git.access.generate_ssh_key")
    expect(gitIpcModule.methods.testSshConnection.operationId).toBe("app.git.access.test_ssh_connection")
  })

  it("rejects arbitrary git command payloads", () => {
    expect(gitIpcModule.methods.getSnapshot.request.safeParse({ repositoryId: "repo-1", args: ["status"] }).success).toBe(false)
  })

  it("accepts HTTP clone results and rejects option-like commit hashes", () => {
    const cloneResponse = gitIpcModule.methods.cloneRepository.response
    expect(cloneResponse).toBeDefined()
    expect(cloneResponse?.safeParse({
      repository: { id: "repo-1", name: "Docs", localPath: "/repo", addedAt: "now", lastOpenedAt: null },
      remoteKind: "http",
    }).success).toBe(true)

    expect(gitIpcModule.methods.getCommit.request.safeParse({
      repositoryId: "repo-1",
      hash: "--output=/tmp/synapse-owned",
    }).success).toBe(false)
    expect(gitIpcModule.methods.getCommit.request.safeParse({
      repositoryId: "repo-1",
      hash: "a".repeat(40),
    }).success).toBe(true)
  })

  it("accepts only a repository id for removal", () => {
    expect(gitIpcModule.methods.removeRepository.request.safeParse({ repositoryId: "repo-1" }).success).toBe(true)
    expect(gitIpcModule.methods.removeRepository.request.safeParse({ repositoryId: "repo-1", mode: "keep-local" }).success).toBe(false)
    expect(gitIpcModule.methods.removeRepository.request.safeParse({ repositoryId: "repo-1", mode: "trash-local" }).success).toBe(false)
  })

  it("rejects unsafe access payloads", () => {
    expect(gitIpcModule.methods.saveHttpsCredential.request.safeParse({
      host: "github.com",
      password: "token",
      protocol: "https",
      username: "writer",
    }).success).toBe(true)
    expect(gitIpcModule.methods.saveHttpsCredential.request.safeParse({
      host: "github.com",
      password: "token",
      protocol: "ssh",
      username: "writer",
    }).success).toBe(false)
    expect(gitIpcModule.methods.saveHttpsCredential.request.safeParse({
      host: "github.com",
      password: "token",
      persistInSynapse: true,
      protocol: "https",
      username: "writer",
    }).success).toBe(false)
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
    const coordinator = { read: vi.fn(async (_key: string, task: () => Promise<unknown>) => task()) }

    const result = await gitIpcModule.methods.listRepositorySummaries.handler(createContext({
      "git.repository-registry": registry,
      "git.status-service": statusService,
      "git.operation-coordinator": coordinator,
    }), undefined)

    expect(statusService.listSummaries).toHaveBeenCalledWith([repository], expect.any(Function))
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
      { repositoryId: "repo-1" },
    )

    expect(registry.remove).toHaveBeenCalledWith("repo-1")
  })

  it("routes access calls through git access service", async () => {
    const access = {
      check: vi.fn().mockResolvedValue({
        checkedAt: "2026-06-19T10:00:00.000Z",
        credentialHelper: { helper: "osxkeychain", safe: true, source: "global" },
        hosts: [],
        providerLinks: {
          generic: { credentialHelpUrl: null, sshKeysUrl: null, tokenUrl: null },
          gitee: { credentialHelpUrl: null, sshKeysUrl: "https://gitee.com/profile/sshkeys", tokenUrl: null },
          github: { credentialHelpUrl: "https://docs.github.com", sshKeysUrl: "https://github.com/settings/keys", tokenUrl: "https://github.com/settings/tokens" },
          gitlab: { credentialHelpUrl: null, sshKeysUrl: "https://gitlab.com/-/user_settings/ssh_keys", tokenUrl: null },
        },
        ssh: {
          available: true,
          publicKeyComment: "writer@example.com",
          publicKeyFingerprint: "SHA256:test",
          publicKeyPath: "/Users/writer/.ssh/id_ed25519.pub",
          publicKeyType: "ssh-ed25519",
        },
      }),
      clearHttpsCredential: vi.fn().mockResolvedValue(undefined),
      configureCredentialHelper: vi.fn().mockResolvedValue(undefined),
      generateSshKey: vi.fn().mockResolvedValue(undefined),
      saveHttpsCredential: vi.fn().mockResolvedValue(undefined),
      testSshConnection: vi.fn().mockResolvedValue({
        detail: null,
        host: "github.com",
        ok: true,
        title: "SSH 可用",
      }),
    }
    const ctx = createContext({ "git.access-service": access })

    await gitIpcModule.methods.checkAccess.handler(ctx, { hosts: [{ host: "github.com", protocol: "https", provider: "github" }] })
    await gitIpcModule.methods.configureCredentialHelper.handler(ctx, { helper: "osxkeychain" })
    await gitIpcModule.methods.saveHttpsCredential.handler(ctx, { host: "github.com", password: "token", protocol: "https", username: "writer" })
    await gitIpcModule.methods.clearHttpsCredential.handler(ctx, { host: "github.com", protocol: "https", username: "writer" })
    await gitIpcModule.methods.generateSshKey.handler(ctx, { email: "writer@example.com" })
    await gitIpcModule.methods.testSshConnection.handler(ctx, { host: "github.com", provider: "github" })

    expect(access.check).toHaveBeenCalledWith({ hosts: [{ host: "github.com", protocol: "https", provider: "github" }] })
    expect(access.configureCredentialHelper).toHaveBeenCalledWith({ helper: "osxkeychain" })
    expect(access.saveHttpsCredential).toHaveBeenCalledWith({ host: "github.com", password: "token", protocol: "https", username: "writer" })
    expect(access.clearHttpsCredential).toHaveBeenCalledWith({ host: "github.com", protocol: "https", username: "writer" })
    expect(access.generateSshKey).toHaveBeenCalledWith({ email: "writer@example.com" })
    expect(access.testSshConnection).toHaveBeenCalledWith({ host: "github.com", provider: "github" })
  })
})
