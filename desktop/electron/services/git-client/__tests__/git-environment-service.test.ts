import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createGitEnvironmentService } from "../git-environment-service"

const shellEnvironment = {
  processPath: "/usr/bin",
  shellPath: "/opt/homebrew/bin:/usr/bin",
  effectivePath: "/opt/homebrew/bin:/usr/bin",
  processNodePath: null,
  shellNodePath: null,
  effectiveNodePath: null,
  processGitPath: null,
  shellGitPath: "/opt/homebrew/bin/git",
  effectiveGitPath: "/opt/homebrew/bin/git",
  nodeRuntimeBinPath: null,
}

describe("git environment service", () => {
  it("reports Git and identity state", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "git version 2.50.0\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "Writer\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "writer@example.com\n", stderr: "" })
    const runSshVersion = vi.fn().mockResolvedValue(undefined)

    const service = createGitEnvironmentService({
      commandRunner: { run },
      homeDir: "/Users/writer",
      pathExists: async (filePath) => filePath.endsWith("id_ed25519.pub"),
      readFile: async () => "ssh-ed25519 public-key writer@example.com\n",
      platform: "darwin",
      runSshVersion,
      shellEnvironment,
    })

    await expect(service.check()).resolves.toMatchObject({
      checkedAt: expect.any(String),
      platform: "darwin",
      homeDir: "/Users/writer",
      gitAvailable: true,
      gitVersion: "git version 2.50.0",
      gitPath: "/opt/homebrew/bin/git",
      processPath: "/usr/bin",
      shellPath: "/opt/homebrew/bin:/usr/bin",
      effectivePath: "/opt/homebrew/bin:/usr/bin",
      processGitPath: null,
      shellGitPath: "/opt/homebrew/bin/git",
      effectiveGitPath: "/opt/homebrew/bin/git",
      sshAvailable: true,
      userName: "Writer",
      userEmail: "writer@example.com",
      userNameSource: null,
      userEmailSource: null,
      commonSshKeyExists: true,
      sshPublicKeyPath: path.join("/Users/writer", ".ssh", "id_ed25519.pub"),
      sshPublicKeyType: "ssh-ed25519",
      installHint: null,
    })
    expect(runSshVersion).toHaveBeenCalledOnce()
  })

  it("does not treat Git availability as SSH availability", async () => {
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => {
      if (input.args[0] === "--version") return { stdout: "git version 2.50.0\n", stderr: "" }
      return { stdout: "", stderr: "" }
    })
    const runSshVersion = vi.fn().mockRejectedValue(new Error("ENOENT"))
    const service = createGitEnvironmentService({
      commandRunner: { run },
      homeDir: "/Users/writer",
      pathExists: async () => false,
      readFile: async () => "",
      platform: "darwin",
      runSshVersion,
      shellEnvironment,
    })

    const state = await service.check()

    expect(state.gitAvailable).toBe(true)
    expect(state.sshAvailable).toBe(false)
    expect(runSshVersion).toHaveBeenCalledOnce()
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["-c", "core.sshCommand=ssh -V", "version"],
    }))
  })

  it("returns install hint when Git is missing", async () => {
    const service = createGitEnvironmentService({
      commandRunner: { run: vi.fn().mockRejectedValue(new Error("ENOENT")) },
      homeDir: "/Users/writer",
      pathExists: async () => false,
      readFile: async () => "",
      platform: "win32",
      shellEnvironment,
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
      shellEnvironment,
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
      shellEnvironment,
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
