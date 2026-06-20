import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { buildAccessProcessEnvironment, createGitAccessService } from "../git-access-service"

function createService(overrides: Partial<Parameters<typeof createGitAccessService>[0]> = {}) {
  return createGitAccessService({
    commandRunner: {
      run: vi.fn().mockResolvedValue({ stdout: "osxkeychain\n", stderr: "" }),
    },
    homeDir: "/Users/writer",
    now: () => new Date("2026-06-20T08:00:00.000Z"),
    pathExists: async () => false,
    platform: "darwin",
    readFile: async () => "",
    ...overrides,
  })
}

describe("git access service", () => {
  it("checks credential helper, hosts, provider links, and SSH public key state", async () => {
    const publicKeyPath = path.join("/Users/writer", ".ssh", "id_ed25519.pub")
    const run = vi.fn().mockResolvedValue({ stdout: "osxkeychain\n", stderr: "" })
    const service = createService({
      commandRunner: { run },
      pathExists: async (filePath) => filePath === publicKeyPath,
      readFile: async () => "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA writer@example.com\n",
    })

    await expect(service.check({
      hosts: [
        { host: "GitHub.com", protocol: "https" },
        { host: "gitee.com", protocol: "ssh", provider: "gitee" },
      ],
    })).resolves.toMatchObject({
      checkedAt: "2026-06-20T08:00:00.000Z",
      credentialHelper: {
        helper: "osxkeychain",
        safe: true,
        source: "global",
      },
      hosts: [
        { host: "github.com", protocol: "https", provider: "github", lastFailure: null },
        { host: "gitee.com", protocol: "ssh", provider: "gitee", lastFailure: null },
      ],
      providerLinks: {
        github: {
          credentialHelpUrl: "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git",
          sshKeysUrl: "https://github.com/settings/keys",
          tokenUrl: "https://github.com/settings/tokens",
        },
      },
      ssh: {
        available: true,
        publicKeyPath,
        publicKeyType: "ssh-ed25519",
      },
    })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/Users/writer",
      args: ["config", "--global", "--get-all", "credential.helper"],
      logFailure: false,
      operation: "git.access.check",
    }))
  })

  it("marks credential helper unsafe when any configured helper is unsafe", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "store\nosxkeychain\n", stderr: "" })
    const service = createService({ commandRunner: { run } })

    const state = await service.check()

    expect(state.credentialHelper.helper).toBe("store, osxkeychain")
    expect(state.credentialHelper.safe).toBe(false)
  })

  it("marks credential helper unsafe when it is not safe on the current platform", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "wincred\n", stderr: "" })
    const service = createService({ commandRunner: { run }, platform: "darwin" })

    const state = await service.check()

    expect(state.credentialHelper).toMatchObject({
      helper: "wincred",
      safe: false,
    })
  })

  it("replaces existing credential helpers before configuring a safe helper", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await service.configureCredentialHelper({ helper: "manager-core" })

    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cwd: "/Users/writer",
      args: ["config", "--global", "--unset-all", "credential.helper"],
      logFailure: false,
      operation: "git.access.configureCredentialHelper",
    }))
    expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cwd: "/Users/writer",
      args: ["config", "--global", "--add", "credential.helper", "manager-core"],
      logFailure: false,
      operation: "git.access.configureCredentialHelper",
    }))
  })

  it("ignores missing credential helper while replacing old helpers", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("fatal: no such key: credential.helper"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await service.configureCredentialHelper({ helper: "manager" })

    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({
      args: ["config", "--global", "--add", "credential.helper", "manager"],
    }))
  })

  it.each([
    Object.assign(new Error("exit 5"), { exitCode: 5 }),
    new Error("fatal: no such section: credential"),
    new Error("fatal: no such key: credential.helper"),
  ])("continues when old credential helper is missing", async (unsetError) => {
    const run = vi.fn()
      .mockRejectedValueOnce(unsetError)
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await service.configureCredentialHelper({ helper: "manager" })

    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({
      args: ["config", "--global", "--add", "credential.helper", "manager"],
    }))
  })

  it("blocks helper configuration when old credential helper cleanup fails", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("could not lock config file Permission denied"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await expect(service.configureCredentialHelper({ helper: "manager" })).rejects.toThrow("无法清理旧的凭证保存配置。")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("blocks helper configuration when old credential helper cleanup reports invalid config", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("fatal: invalid key: credential.helper"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await expect(service.configureCredentialHelper({ helper: "manager" })).rejects.toThrow("无法清理旧的凭证保存配置。")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each([
    "git not found",
    "helper backend not found",
  ])("blocks helper configuration when cleanup reports %s", async (message) => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await expect(service.configureCredentialHelper({ helper: "manager" })).rejects.toThrow("无法清理旧的凭证保存配置。")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["darwin", "wincred"],
    ["win32", "osxkeychain"],
    ["linux", "osxkeychain"],
  ] as const)("rejects credential helper %s does not support: %s", async (platform, helper) => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run }, platform })

    await expect(service.configureCredentialHelper({ helper })).rejects.toThrow("不支持此凭证保存方式。")
    expect(run).not.toHaveBeenCalled()
  })

  it("rejects plaintext credential store", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await expect(service.configureCredentialHelper({ helper: "store" })).rejects.toThrow("不能使用明文凭证保存方式。")
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    "manager-core --socket /tmp/git.sock",
    "/tmp/git-credential-helper",
    "./git-credential-helper",
    "!f() { echo username=writer; }; f",
    "cache",
    "unknown-helper",
  ])("rejects unsupported credential helper %s", async (helper) => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await expect(service.configureCredentialHelper({ helper })).rejects.toThrow("不支持此凭证保存方式。")
    expect(run).not.toHaveBeenCalled()
  })

  it("saves HTTPS credentials through git credential approve without logging the password", async () => {
    const password = "test-password-value"
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ logger, runGitCredential })

    await service.saveHttpsCredential({
      host: "github.com",
      password,
      protocol: "https",
      username: "writer",
    })

    expect(runGitCredential).toHaveBeenCalledWith({
      action: "approve",
      cwd: "/Users/writer",
      stdin: "protocol=https\nhost=github.com\nusername=writer\npassword=test-password-value\n\n",
    })
    const serializedLogs = JSON.stringify([logger.error.mock.calls, logger.info.mock.calls, logger.warn.mock.calls])
    expect(serializedLogs).not.toContain(password)
  })

  it("checks credential helper safety before saving HTTPS credentials", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "store\n", stderr: "" })
    const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({
      commandRunner: { run },
      runGitCredential,
    })

    await expect(service.saveHttpsCredential({
      host: "github.com",
      password: "test-password-value",
      protocol: "https",
      username: "writer",
    })).rejects.toThrow("请先设置安全的凭证保存方式。")
    expect(runGitCredential).not.toHaveBeenCalled()
  })

  it("rejects credential values with line breaks before saving", async () => {
    const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ runGitCredential })

    await expect(service.saveHttpsCredential({
      host: "github.com",
      password: "line-one\nline-two",
      protocol: "https",
      username: "writer",
    })).rejects.toThrow("凭证内容包含不支持的换行或控制字符。")
    expect(runGitCredential).not.toHaveBeenCalled()
  })

  it("clears HTTPS credentials through git credential reject", async () => {
    const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ runGitCredential })

    await service.clearHttpsCredential({
      host: "github.com",
      protocol: "https",
      username: "writer",
    })

    expect(runGitCredential).toHaveBeenCalledWith({
      action: "reject",
      cwd: "/Users/writer",
      stdin: "protocol=https\nhost=github.com\nusername=writer\n\n",
    })
  })

  it("rejects credential values with control characters before clearing", async () => {
    const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ runGitCredential })

    await expect(service.clearHttpsCredential({
      host: "github.com",
      protocol: "https",
      username: "writer\radmin",
    })).rejects.toThrow("凭证内容包含不支持的换行或控制字符。")
    expect(runGitCredential).not.toHaveBeenCalled()
  })

  it("generates an ed25519 SSH key when the public key is missing", async () => {
    const runSshKeygen = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const ensureDirectory = vi.fn().mockResolvedValue(undefined)
    const service = createService({
      ensureDirectory,
      pathExists: async () => false,
      runSshKeygen,
    })

    await service.generateSshKey({ email: "writer@example.com" })

    expect(runSshKeygen).toHaveBeenCalledWith({
      args: ["-t", "ed25519", "-C", "writer@example.com", "-f", path.join("/Users/writer", ".ssh", "id_ed25519"), "-N", ""],
      cwd: "/Users/writer",
    })
    expect(ensureDirectory).toHaveBeenCalledWith(path.join("/Users/writer", ".ssh"), {
      mode: 0o700,
      recursive: true,
    })
  })

  it("does not overwrite an existing ed25519 SSH key", async () => {
    const runSshKeygen = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const publicKeyPath = path.join("/Users/writer", ".ssh", "id_ed25519.pub")
    const service = createService({
      pathExists: async (filePath) => filePath === publicKeyPath,
      runSshKeygen,
    })

    await service.generateSshKey({ email: "writer@example.com" })

    expect(runSshKeygen).not.toHaveBeenCalled()
  })

  it("does not overwrite an existing ed25519 private key when the public key is missing", async () => {
    const runSshKeygen = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const privateKeyPath = path.join("/Users/writer", ".ssh", "id_ed25519")
    const service = createService({
      pathExists: async (filePath) => filePath === privateKeyPath,
      runSshKeygen,
    })

    await service.generateSshKey({ email: "writer@example.com" })

    expect(runSshKeygen).not.toHaveBeenCalled()
  })

  it("tests SSH host connectivity", async () => {
    const runSshTest = vi.fn().mockResolvedValue({
      detail: "Hi writer! You've successfully authenticated.",
      ok: true,
    })
    const service = createService({ runSshTest })

    await expect(service.testSshConnection({ host: "github.com", provider: "github" })).resolves.toEqual({
      detail: "Hi writer! You've successfully authenticated.",
      host: "github.com",
      ok: true,
      title: "SSH 可用",
    })
    expect(runSshTest).toHaveBeenCalledWith({
      cwd: "/Users/writer",
      host: "github.com",
      provider: "github",
    })
  })

  it("treats default SSH test authentication success text as ok when ssh exits non-zero", async () => {
    const runProcess = vi.fn().mockRejectedValue({
      stderr: "Hi writer! You've successfully authenticated, but GitHub does not provide shell access.\n",
      stdout: "",
      message: "ssh exited with code 1.",
    })
    const service = createService({ runProcess })

    await expect(service.testSshConnection({ host: "github.com", provider: "github" })).resolves.toEqual({
      detail: "Hi writer! You've successfully authenticated, but GitHub does not provide shell access.",
      host: "github.com",
      ok: true,
      title: "SSH 可用",
    })
    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: "ssh",
      args: ["-T", "git@github.com"],
      cwd: "/Users/writer",
      timeoutMs: 15_000,
    }))
  })

  it("preserves default SSH test failure output detail", async () => {
    const runProcess = vi.fn().mockRejectedValue({
      stderr: "git@gitee.com: Permission denied (publickey).\n",
      stdout: "",
      message: "ssh exited with code 255.",
    })
    const service = createService({ runProcess })

    await expect(service.testSshConnection({ host: "gitee.com", provider: "gitee" })).resolves.toEqual({
      detail: "git@gitee.com: Permission denied (publickey).",
      host: "gitee.com",
      ok: false,
      title: "SSH 访问失败",
    })
  })

  it("builds process environment with effective PATH", () => {
    const env = buildAccessProcessEnvironment({
      baseEnv: { PATH: "/usr/bin", Path: "C:\\Windows" },
      effectivePath: "/opt/homebrew/bin:/usr/bin",
      platform: "darwin",
    })

    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin")
    expect(env.GIT_TERMINAL_PROMPT).toBe("0")
    expect(env.LANG).toBe("C")
    expect(env.LC_ALL).toBe("C")
  })

  it("builds Windows process environment with effective Path", () => {
    const env = buildAccessProcessEnvironment({
      baseEnv: { PATH: "/usr/bin", path: "C:\\lower", PaTh: "C:\\mixed", Path: "C:\\Windows" },
      effectivePath: "C:\\Git\\cmd;C:\\Windows",
      platform: "win32",
    })

    expect(env.Path).toBe("C:\\Git\\cmd;C:\\Windows")
    expect(env.PATH).toBeUndefined()
    expect(env.path).toBeUndefined()
    expect(env.PaTh).toBeUndefined()
  })
})
