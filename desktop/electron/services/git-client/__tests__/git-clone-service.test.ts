import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createGitCloneService, detectRemoteKind } from "../git-clone-service"

describe("detectRemoteKind", () => {
  it("detects HTTP, HTTPS, and SSH URLs", () => {
    expect(detectRemoteKind("http://git.example.com:8080/team/docs.git")).toBe("http")
    expect(detectRemoteKind("https://git.example.com/team/docs.git")).toBe("https")
    expect(detectRemoteKind("git@git.example.com:team/docs.git")).toBe("ssh")
    expect(detectRemoteKind("file:///tmp/repo")).toBe("unknown")
  })
})

describe("git clone service", () => {
  it("clones into a repository directory below the selected parent", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const addLocal = vi.fn().mockResolvedValue({
      id: "repo-1",
      name: "docs",
      localPath: "/work/docs",
      addedAt: "2026-06-17T10:00:00.000Z",
      lastOpenedAt: null,
    })
    const service = createGitCloneService({
      commandRunner: { run },
      logger,
      registry: { addLocal },
      pathExists: async () => false,
    })

    const result = await service.clone({
      remoteUrl: "https://user:secret@git.example.com/team/docs.git?token=raw-token",
      parentDirectory: "/work",
      directoryName: "docs",
    })

    const targetPath = path.resolve("/work/docs")
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: path.dirname(targetPath),
      args: ["clone", "--progress", "https://user:secret@git.example.com/team/docs.git?token=raw-token", targetPath],
      operation: "git.clone",
      operationId: expect.any(String),
      remoteUrl: "https://user:secret@git.example.com/team/docs.git?token=raw-token",
      timeoutMs: 300000,
    }))
    expect(result.repository.id).toBe("repo-1")
    const serialized = JSON.stringify(logger.info.mock.calls)
    expect(serialized).not.toContain("secret")
    expect(serialized).not.toContain("raw-token")
    expect(serialized).not.toContain("user:secret")
  })

  it("does not overwrite existing targets", async () => {
    const service = createGitCloneService({
      commandRunner: { run: vi.fn() },
      registry: { addLocal: vi.fn() },
      pathExists: async () => true,
    })

    await expect(service.clone({
      remoteUrl: "https://git.example.com/team/docs.git",
      parentDirectory: "/work",
      directoryName: "docs",
    })).rejects.toThrow("目标目录已存在。请选择空目录。")
  })

  it("rejects repository directory names that escape the selected parent", async () => {
    const service = createGitCloneService({
      commandRunner: { run: vi.fn() },
      registry: { addLocal: vi.fn() },
      pathExists: async () => false,
    })

    await expect(service.clone({
      remoteUrl: "https://git.example.com/team/docs.git",
      parentDirectory: "/work",
      directoryName: "../outside",
    })).rejects.toThrow("仓库目录名无效。")
  })
})
