import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { buildAccessProcessEnvironment, createGitAccessService, runProcess } from "../git-access-service"

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

const homeDir = "/Users/writer"
const userGitConfigPath = path.join(homeDir, ".gitconfig")
const knownHostsPath = path.join(homeDir, ".ssh", "known_hosts")

function createSecurity(result: { readonly allowed: true } | { readonly allowed: false; readonly reason: string; readonly policyId?: string } = { allowed: true }) {
  return {
    auditSink: { record: vi.fn() },
    permissionGuard: { check: vi.fn().mockResolvedValue(result) },
  }
}

describe("git access service", () => {
  it("checks credential helper, hosts, provider links, and SSH public key state", async () => {
    const publicKeyPath = path.join("/Users/writer", ".ssh", "id_ed25519.pub")
    const run = vi.fn().mockResolvedValue({ stdout: "file:/Users/writer/.gitconfig\tosxkeychain\n", stderr: "" })
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
        source: "file:/Users/writer/.gitconfig",
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
      args: ["config", "--show-origin", "--get-all", "credential.helper"],
      logFailure: false,
      operation: "git.access.check",
    }))
  })

  it("uses an RSA public key when Ed25519 is unavailable", async () => {
    const publicKeyPath = path.join("/Users/writer", ".ssh", "id_rsa.pub")
    const service = createService({
      pathExists: async (filePath) => filePath === publicKeyPath,
      readFile: async () => "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA writer@example.com\n",
    })

    await expect(service.check()).resolves.toMatchObject({
      ssh: {
        available: true,
        publicKeyPath,
        publicKeyType: "ssh-rsa",
      },
    })
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

  it("does not replace an existing safe credential helper", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "osxkeychain\n", stderr: "" })
      .mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await expect(service.configureCredentialHelper({ helper: "manager-core" }))
      .rejects.toThrow("当前安全凭据助手已配置")

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/Users/writer",
      args: ["config", "--show-origin", "--get-all", "credential.helper"],
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
    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({
      args: ["config", "--show-origin", "--get-all", "credential.helper"],
    }))
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
    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({
      args: ["config", "--show-origin", "--get-all", "credential.helper"],
    }))
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({
      args: ["config", "--global", "--add", "credential.helper", "manager"],
    }))
  })

  it("replaces a unique plaintext helper without unsetting the helper chain", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: `file:${userGitConfigPath}\tstore\n`, stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await service.configureCredentialHelper({ helper: "manager" })
    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({
      args: ["config", "--global", "--replace-all", "credential.helper", "manager"],
    }))
  })

  it("does not modify custom or multi-helper chains", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "file:/etc/gitconfig\tcustom-helper\nfile:/Users/writer/.gitconfig\tosxkeychain\n", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await expect(service.configureCredentialHelper({ helper: "manager" })).rejects.toThrow("由外部 Git 配置管理")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each([
    "git not found",
    "helper backend not found",
  ])("blocks helper configuration when reading old helpers reports %s", async (message) => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run } })

    await expect(service.configureCredentialHelper({ helper: "manager" })).rejects.toThrow("无法读取旧的凭证保存配置。")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("restores a plaintext helper when replacing it fails", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: `file:${userGitConfigPath}\tstore\n`, stderr: "" })
      .mockRejectedValueOnce(new Error("could not lock config file Permission denied"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createService({ commandRunner: { run }, logger })

    await expect(service.configureCredentialHelper({ helper: "manager-core" }))
      .rejects.toThrow("无法配置新的凭证保存方式，已恢复旧配置。")

    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({
      args: ["config", "--show-origin", "--get-all", "credential.helper"],
    }))
    expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: ["config", "--global", "--replace-all", "credential.helper", "manager-core"],
    }))
    expect(run).toHaveBeenNthCalledWith(3, expect.objectContaining({
      args: ["config", "--global", "--replace-all", "credential.helper", "store"],
    }))
    expect(logger.warn).toHaveBeenCalledWith(
      "Restored previous Git credential helper after configuration failure.",
      { previousHelperClassification: "plaintext" },
    )
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

  it("checks permission and audits HTTPS credential saves without exposing the password", async () => {
    const password = "test-password-value"
    const security = createSecurity()
    const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ ...security, runGitCredential })

    await service.saveHttpsCredential({
      host: "GitHub.com",
      password,
      protocol: "https",
      username: "writer",
    })

    expect(security.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      resource: "git-credential:https://github.com",
    }))
    expect(security.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "git",
    }))
    expect(security.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      outcome: "allowed",
      resource: "git-credential:https://github.com",
    }))
    expect(JSON.stringify([
      security.permissionGuard.check.mock.calls,
      security.auditSink.record.mock.calls,
    ])).not.toContain(password)
  })

  it("does not save HTTPS credentials when permission is denied", async () => {
    const security = createSecurity({ allowed: false, reason: "denied by policy", policyId: "test-policy" })
    const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ ...security, runGitCredential })

    await expect(service.saveHttpsCredential({
      host: "github.com",
      password: "test-password-value",
      protocol: "https",
      username: "writer",
    })).rejects.toThrow("denied by policy")

    expect(runGitCredential).not.toHaveBeenCalled()
    expect(security.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      outcome: "denied",
      resource: "git-credential:https://github.com",
    }))
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

  it("keeps HTTP protocol and non-default ports in credential approve and reject", async () => {
    const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ runGitCredential })

    await service.saveHttpsCredential({
      host: "git.company.com",
      password: "test-password-value",
      port: 8080,
      protocol: "http",
      username: "writer",
    })
    await service.clearHttpsCredential({
      host: "git.company.com",
      port: 8080,
      protocol: "http",
      username: "writer",
    })

    expect(runGitCredential).toHaveBeenNthCalledWith(1, {
      action: "approve",
      cwd: "/Users/writer",
      stdin: "protocol=http\nhost=git.company.com:8080\nusername=writer\npassword=test-password-value\n\n",
    })
    expect(runGitCredential).toHaveBeenNthCalledWith(2, {
      action: "reject",
      cwd: "/Users/writer",
      stdin: "protocol=http\nhost=git.company.com:8080\nusername=writer\n\n",
    })
  })

  it("formats IPv6 hosts consistently for credential approve and reject", async () => {
    const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({ runGitCredential })

    await service.saveHttpsCredential({
      host: "2001:db8::1",
      password: "test-password-value",
      port: 8443,
      protocol: "https",
      username: "writer",
    })
    await service.clearHttpsCredential({
      host: "2001:db8::1",
      port: 8443,
      protocol: "https",
      username: "writer",
    })

    expect(runGitCredential).toHaveBeenNthCalledWith(1, expect.objectContaining({
      stdin: "protocol=https\nhost=[2001:db8::1]:8443\nusername=writer\npassword=test-password-value\n\n",
    }))
    expect(runGitCredential).toHaveBeenNthCalledWith(2, expect.objectContaining({
      stdin: "protocol=https\nhost=[2001:db8::1]:8443\nusername=writer\n\n",
    }))
  })

  it("does not clear HTTPS credentials without a safe credential helper", async () => {
    const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createService({
      commandRunner: {
        run: vi.fn().mockResolvedValue({ stdout: "store\n", stderr: "" }),
      },
      runGitCredential,
    })

    await expect(service.clearHttpsCredential({
      host: "github.com",
      protocol: "https",
      username: "writer",
    })).rejects.toThrow("请先设置安全的凭证保存方式。")
    expect(runGitCredential).not.toHaveBeenCalled()
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

  it("checks permission and audits SSH key generation", async () => {
    const security = createSecurity()
    const runSshKeygen = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const ensureDirectory = vi.fn().mockResolvedValue(undefined)
    const service = createService({
      ...security,
      ensureDirectory,
      pathExists: async () => false,
      runSshKeygen,
    })

    await service.generateSshKey({ email: "writer@example.com" })

    expect(security.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: path.join("/Users/writer", ".ssh"),
    }))
    expect(security.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "ssh-keygen",
    }))
    expect(security.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      outcome: "allowed",
      resource: path.join("/Users/writer", ".ssh"),
    }))
  })

  it("records failed audit when SSH key generation fails", async () => {
    const security = createSecurity()
    const runSshKeygen = vi.fn().mockRejectedValue(new Error("ssh-keygen failed"))
    const service = createService({
      ...security,
      ensureDirectory: vi.fn().mockResolvedValue(undefined),
      pathExists: async () => false,
      runSshKeygen,
    })

    await expect(service.generateSshKey({ email: "writer@example.com" })).rejects.toThrow("ssh-keygen failed")

    expect(security.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      outcome: "failed",
      resource: "ssh-keygen",
    }))
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

  it("restores the public key from an existing ed25519 private key", async () => {
    const runSshKeygen = vi.fn().mockResolvedValue({
      stdout: "ssh-ed25519 AAAAC3NzaRecovered writer@example.com\n",
      stderr: "",
    })
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const privateKeyPath = path.join("/Users/writer", ".ssh", "id_ed25519")
    const publicKeyPath = path.join("/Users/writer", ".ssh", "id_ed25519.pub")
    const service = createService({
      pathExists: async (filePath) => filePath === privateKeyPath,
      runSshKeygen,
      writeFile,
    })

    await service.generateSshKey({ email: "writer@example.com" })

    expect(runSshKeygen).toHaveBeenCalledWith({
      args: ["-y", "-f", privateKeyPath],
      cwd: "/Users/writer",
    })
    expect(writeFile).toHaveBeenCalledWith(
      publicKeyPath,
      "ssh-ed25519 AAAAC3NzaRecovered writer@example.com\n",
      "utf8",
    )
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

  it("scans an unknown SSH host on its configured port and returns SHA-256 fingerprints", async () => {
    const runProcess = vi.fn().mockResolvedValue({
      stdout: "[git.example.com]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n",
      stderr: "",
    })
    const service = createService({ runProcess })

    const candidate = await service.scanSshHostKey({ host: "git.example.com", port: 2222, username: "deploy" })

    expect(candidate).toMatchObject({ host: "git.example.com", port: 2222, changed: false, trusted: false })
    expect(candidate.fingerprints[0]).toMatch(/^SHA256:/)
    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: "ssh-keyscan",
      args: ["-T", "10", "-p", "2222", "git.example.com"],
    }))
  })

  it("atomically appends a confirmed SSH host key", async () => {
    const keyLine = "git.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const runProcess = vi.fn().mockResolvedValue({ stdout: `${keyLine}\n`, stderr: "" })
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const renameFile = vi.fn().mockResolvedValue(undefined)
    const service = createService({ runProcess, writeFile, renameFile, ensureDirectory: vi.fn().mockResolvedValue(undefined) })
    const candidate = await service.scanSshHostKey({ host: "git.example.com" })

    await service.trustSshHostKey({ host: candidate.host, port: candidate.port, fingerprints: candidate.fingerprints })

    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining("known_hosts.synapse-"), `${keyLine}\n`, "utf8")
    expect(renameFile).toHaveBeenCalledWith(expect.stringContaining("known_hosts.synapse-"), knownHostsPath)
  })

  it("serializes concurrent known_hosts updates without losing either host", async () => {
    const keys = {
      "one.example.com": "one.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "two.example.com": "two.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    } as const
    let knownHosts = ""
    const temporaryFiles = new Map<string, string>()
    const runProcess = vi.fn(async ({ command, args }: { readonly command: string; readonly args: readonly string[] }) => {
      if (command === "ssh-keyscan") {
        const host = args.at(-1) as keyof typeof keys
        return { stdout: `${keys[host]}\n`, stderr: "" }
      }
      const token = args[args.indexOf("-F") + 1]
      return {
        stdout: knownHosts.split("\n").filter((line) => line.startsWith(`${token} `)).join("\n"),
        stderr: "",
      }
    })
    const service = createService({
      ensureDirectory: vi.fn().mockResolvedValue(undefined),
      pathExists: async (filePath) => filePath.endsWith("known_hosts") && knownHosts.length > 0,
      readFile: async () => knownHosts,
      renameFile: async (temporaryPath) => { knownHosts = temporaryFiles.get(temporaryPath) ?? "" },
      runProcess,
      writeFile: async (filePath, content) => { temporaryFiles.set(filePath, content) },
    })
    const [one, two] = await Promise.all([
      service.scanSshHostKey({ host: "one.example.com" }),
      service.scanSshHostKey({ host: "two.example.com" }),
    ])

    await Promise.all([
      service.trustSshHostKey({ host: one.host, fingerprints: one.fingerprints }),
      service.trustSshHostKey({ host: two.host, fingerprints: two.fingerprints }),
    ])

    expect(knownHosts).toContain(keys["one.example.com"])
    expect(knownHosts).toContain(keys["two.example.com"])
  })

  it("terminates access subprocesses that exceed the output limit", async () => {
    await expect(runProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 97))"],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    }, { platform: process.platform })).rejects.toThrow("too much output")
  })

  it("refuses to trust a changed SSH host key", async () => {
    const runProcess = vi.fn().mockImplementation(async ({ command }: { readonly command: string }) => ({
      stdout: command === "ssh-keygen"
        ? "git.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n"
        : "git.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n",
      stderr: "",
    }))
    const writeFile = vi.fn()
    const service = createService({
      runProcess,
      writeFile,
      pathExists: async (filePath) => filePath === knownHostsPath,
      readFile: async () => "git.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n",
    })
    const candidate = await service.scanSshHostKey({ host: "git.example.com" })

    expect(candidate.changed).toBe(true)
    await expect(service.trustSshHostKey({ host: candidate.host, fingerprints: candidate.fingerprints }))
      .rejects.toThrow("请人工核验")
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("detects a changed SSH host key stored under a hashed known_hosts entry", async () => {
    const runProcess = vi.fn().mockImplementation(async ({ command }: { readonly command: string }) => ({
      stdout: command === "ssh-keygen"
        ? "|1|salt|hash ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n"
        : "git.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n",
      stderr: "",
    }))
    const service = createService({
      runProcess,
      pathExists: async (filePath) => filePath === knownHostsPath,
    })

    await expect(service.scanSshHostKey({ host: "git.example.com" })).resolves.toMatchObject({
      changed: true,
      trusted: false,
    })
    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: "ssh-keygen",
      args: ["-F", "git.example.com", "-f", knownHostsPath],
    }))
  })

  it("checks permission and audits SSH connection tests", async () => {
    const security = createSecurity()
    const runSshTest = vi.fn().mockResolvedValue({
      detail: "Hi writer! You've successfully authenticated.",
      ok: true,
    })
    const service = createService({ ...security, runSshTest })

    await service.testSshConnection({ host: "GitHub.com", provider: "github" })

    expect(security.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "ssh://github.com",
    }))
    expect(security.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "ssh",
    }))
    expect(security.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "ssh://github.com",
    }))
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
      args: ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "git@github.com"],
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
      baseEnv: {
        HOME: "/Users/writer",
        PATH: "/usr/bin",
        Path: "C:\\Windows",
        ANTHROPIC_AUTH_TOKEN: "secret-token",
      },
      effectivePath: "/opt/homebrew/bin:/usr/bin",
      platform: "darwin",
    })

    expect(env.HOME).toBe("/Users/writer")
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin")
    expect(env.Path).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.GIT_TERMINAL_PROMPT).toBe("0")
    expect(env.LANG).toBe("C")
    expect(env.LC_ALL).toBe("C")
  })

  it("builds Windows process environment with effective Path", () => {
    const env = buildAccessProcessEnvironment({
      baseEnv: {
        PATH: "/usr/bin",
        path: "C:\\lower",
        PaTh: "C:\\mixed",
        Path: "C:\\Windows",
        USERPROFILE: "C:\\Users\\writer",
        TOKEN: "raw-token",
      },
      effectivePath: "C:\\Git\\cmd;C:\\Windows",
      platform: "win32",
    })

    expect(env.Path).toBe("C:\\Git\\cmd;C:\\Windows")
    expect(env.USERPROFILE).toBe("C:\\Users\\writer")
    expect(env.PATH).toBeUndefined()
    expect(env.path).toBeUndefined()
    expect(env.PaTh).toBeUndefined()
    expect(env.TOKEN).toBeUndefined()
  })
})
