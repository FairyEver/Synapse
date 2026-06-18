import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createGitEnvironmentService } from "../git-environment-service"

const shellEnvironment = {
  processPath: "/usr/bin",
  shellPath: "/opt/homebrew/bin:/usr/bin",
  effectivePath: "/usr/bin:/opt/homebrew/bin",
  processNodePath: "/usr/bin/node",
  shellNodePath: "/opt/homebrew/bin/node",
  effectiveNodePath: "/usr/bin/node",
  processGitPath: "/usr/bin/git",
  shellGitPath: "/opt/homebrew/bin/git",
  effectiveGitPath: "/usr/bin/git",
  nodeRuntimeBinPath: null,
}

describe("git environment service", () => {
  it("reports Git and identity state", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "git version 2.50.0\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "ssh -V output\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "Writer\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "writer@example.com\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "file:/Users/writer/.gitconfig\tWriter\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "file:/Users/writer/.gitconfig\twriter@example.com\n", stderr: "" })

    const service = createGitEnvironmentService({
      commandRunner: { run },
      homeDir: "/Users/writer",
      pathExists: async (filePath) => filePath.endsWith("id_ed25519.pub"),
      readFile: async () => "ssh-ed25519 YWJj writer@example.com\n",
      platform: "darwin",
      shellEnvironment,
      now: () => new Date("2026-06-18T10:00:00.000Z"),
    })

    await expect(service.check()).resolves.toEqual({
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
      sshPublicKeyFingerprint: "SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0",
      installHint: null,
    })
  })

  it("returns install hint when Git is missing", async () => {
    const service = createGitEnvironmentService({
      commandRunner: { run: vi.fn().mockRejectedValue(new Error("ENOENT")) },
      homeDir: "/Users/writer",
      pathExists: async (filePath) => filePath.endsWith("id_rsa.pub"),
      readFile: async () => "ssh-rsa YWJj writer@example.com",
      platform: "win32",
      shellEnvironment: {
        ...shellEnvironment,
        effectiveGitPath: null,
      },
      now: () => new Date("2026-06-18T10:00:00.000Z"),
    })

    const state = await service.check()
    expect(state.gitAvailable).toBe(false)
    expect(state.installHint).toBe("安装 Git for Windows 后重新检测。")
    expect(state.effectivePath).toBe("/usr/bin:/opt/homebrew/bin")
    expect(state.sshPublicKeyPath).toBe(path.join("/Users/writer", ".ssh", "id_rsa.pub"))
  })

  it("keeps environment checks available when SSH public key cannot be read", async () => {
    const service = createGitEnvironmentService({
      commandRunner: { run: vi.fn().mockRejectedValue(new Error("ENOENT")) },
      homeDir: "/Users/writer",
      pathExists: async (filePath) => filePath.endsWith("id_ed25519.pub"),
      readFile: async () => {
        throw new Error("permission denied")
      },
      platform: "darwin",
      shellEnvironment,
    })

    const state = await service.check()
    expect(state.gitAvailable).toBe(false)
    expect(state.sshPublicKeyPath).toBeNull()
  })

  it("writes global identity", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createGitEnvironmentService({
      commandRunner: { run },
      homeDir: "/Users/writer",
      pathExists: async () => false,
      readFile: async () => "",
      platform: "darwin",
      shellEnvironment,
    })

    await service.configureIdentity({ userName: "Writer", userEmail: "writer@example.com" })

    expect(run).toHaveBeenCalledWith({ cwd: "/Users/writer", args: ["config", "--global", "user.name", "Writer"] })
    expect(run).toHaveBeenCalledWith({ cwd: "/Users/writer", args: ["config", "--global", "user.email", "writer@example.com"] })
  })

  it("reads the first common SSH public key", async () => {
    const expectedKeyPath = path.join("/Users/writer", ".ssh", "id_rsa.pub")
    const service = createGitEnvironmentService({
      commandRunner: { run: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }) },
      homeDir: "/Users/writer",
      pathExists: async (filePath) => filePath.endsWith("id_rsa.pub"),
      readFile: async (filePath) => `ssh-rsa public-key ${filePath}`,
      platform: "darwin",
      shellEnvironment,
    })

    await expect(service.getSshPublicKey()).resolves.toEqual({
      path: expectedKeyPath,
      content: `ssh-rsa public-key ${expectedKeyPath}`,
    })
  })
})
