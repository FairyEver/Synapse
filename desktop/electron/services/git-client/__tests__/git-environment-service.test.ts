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
      platform: "win32",
    })

    const state = await service.check()
    expect(state.gitAvailable).toBe(false)
    expect(state.installHint).toBe("安装 Git for Windows 后重新检测。")
  })

  it("writes global identity", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createGitEnvironmentService({
      commandRunner: { run },
      homeDir: "/Users/writer",
      pathExists: async () => false,
      platform: "darwin",
    })

    await service.configureIdentity({ userName: "Writer", userEmail: "writer@example.com" })

    expect(run).toHaveBeenCalledWith({ cwd: "/Users/writer", args: ["config", "--global", "user.name", "Writer"] })
    expect(run).toHaveBeenCalledWith({ cwd: "/Users/writer", args: ["config", "--global", "user.email", "writer@example.com"] })
  })
})
