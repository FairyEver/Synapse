import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createGitEnvironmentService } from "../git-environment-service"

describe("git environment service", () => {
  it("reports Git and identity state", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "git version 2.50.0\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "ssh -V output\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "Writer\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "writer@example.com\n", stderr: "" })

    const service = createGitEnvironmentService({
      commandRunner: { run },
      homeDir: "/Users/writer",
      pathExists: async (filePath) => filePath.endsWith("id_ed25519.pub"),
      readFile: async () => "ssh-ed25519 public-key writer@example.com\n",
      platform: "darwin",
    })

    await expect(service.check()).resolves.toEqual({
      gitAvailable: true,
      gitVersion: "git version 2.50.0",
      gitPath: null,
      sshAvailable: true,
      userName: "Writer",
      userEmail: "writer@example.com",
      commonSshKeyExists: true,
      installHint: null,
    })
  })

  it("returns install hint when Git is missing", async () => {
    const service = createGitEnvironmentService({
      commandRunner: { run: vi.fn().mockRejectedValue(new Error("ENOENT")) },
      homeDir: "/Users/writer",
      pathExists: async () => false,
      readFile: async () => "",
      platform: "win32",
    })

    const state = await service.check()
    expect(state.gitAvailable).toBe(false)
    expect(state.installHint).toBe("安装 Git for Windows 后重新检测。")
  })

  it("writes global identity", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createGitEnvironmentService({
      commandRunner: { run },
      homeDir: "/Users/writer",
      logger,
      pathExists: async () => false,
      readFile: async () => "",
      platform: "darwin",
    })

    await service.configureIdentity({ userName: "Writer", userEmail: "writer@example.com" })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/Users/writer", args: ["config", "--global", "user.name", "Writer"], logFailure: false }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/Users/writer", args: ["config", "--global", "user.email", "writer@example.com"], logFailure: false }))
    const serialized = JSON.stringify(logger.info.mock.calls)
    expect(serialized).toContain("example.com")
    expect(serialized).not.toContain("writer@example.com")
    expect(serialized).not.toContain("Writer")
  })

  it("reads the first common SSH public key", async () => {
    const expectedKeyPath = path.join("/Users/writer", ".ssh", "id_rsa.pub")
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createGitEnvironmentService({
      commandRunner: { run: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }) },
      homeDir: "/Users/writer",
      logger,
      pathExists: async (filePath) => filePath.endsWith("id_rsa.pub"),
      readFile: async (filePath) => `ssh-rsa public-key ${filePath}`,
      platform: "darwin",
    })

    await expect(service.getSshPublicKey()).resolves.toEqual({
      path: expectedKeyPath,
      content: `ssh-rsa public-key ${expectedKeyPath}`,
    })
    expect(logger.info).toHaveBeenCalledWith("Git SSH public key lookup completed.", expect.objectContaining({
      found: true,
      keyType: "ssh-rsa",
    }))
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("public-key")
  })
})
