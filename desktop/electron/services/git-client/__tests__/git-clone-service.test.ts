import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createGitCloneService, detectRemoteKind } from "../git-clone-service"

describe("detectRemoteKind", () => {
  it("detects https and ssh URLs", () => {
    expect(detectRemoteKind("https://git.example.com/team/docs.git")).toBe("https")
    expect(detectRemoteKind("git@git.example.com:team/docs.git")).toBe("ssh")
    expect(detectRemoteKind("file:///tmp/repo")).toBe("unknown")
  })
})

describe("git clone service", () => {
  it("clones into the selected target and registers the repository", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const addLocal = vi.fn().mockResolvedValue({
      id: "repo-1",
      name: "docs",
      localPath: "/work/docs",
      addedAt: "2026-06-17T10:00:00.000Z",
      lastOpenedAt: null,
    })
    const service = createGitCloneService({
      commandRunner: { run },
      registry: { addLocal },
      pathExists: async () => false,
    })

    const result = await service.clone({
      remoteUrl: "https://git.example.com/team/docs.git",
      targetPath: "/work/docs",
      name: "docs",
    })

    const targetPath = path.resolve("/work/docs")
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: path.dirname(targetPath),
      args: ["clone", "--progress", "https://git.example.com/team/docs.git", targetPath],
      operation: "git.clone",
      operationId: expect.any(String),
      timeoutMs: 300000,
    }))
    expect(result.repository.id).toBe("repo-1")
  })

  it("does not overwrite existing targets", async () => {
    const service = createGitCloneService({
      commandRunner: { run: vi.fn() },
      registry: { addLocal: vi.fn() },
      pathExists: async () => true,
    })

    await expect(service.clone({
      remoteUrl: "https://git.example.com/team/docs.git",
      targetPath: "/work/docs",
      name: "docs",
    })).rejects.toThrow("目标目录已存在。请选择空目录。")
  })
})
