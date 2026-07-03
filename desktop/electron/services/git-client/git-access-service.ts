import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseGitAccessState,
  SynapseGitGenerateSshKeyInput,
  SynapseGitProvider,
  SynapseGitProviderLinks,
  SynapseGitProtocol,
  SynapseGitSaveHttpsCredentialInput,
  SynapseGitClearHttpsCredentialInput,
  SynapseGitSshTestResult,
  SynapseGitTestSshConnectionInput,
} from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import type { GitClientCommandRunner } from "./git-command-runner"

type Platform = NodeJS.Platform
type ProcessRunResult = {
  readonly stderr: string
  readonly stdout: string
}
type ProcessRunInput = {
  readonly args: readonly string[]
  readonly command: string
  readonly cwd: string
  readonly stdin?: string
  readonly timeoutMs?: number
}
type ProcessRunner = (input: ProcessRunInput) => Promise<ProcessRunResult>
type EnsureDirectory = (directoryPath: string, options: { readonly mode: number; readonly recursive: true }) => Promise<void>
type WriteFile = (filePath: string, content: string, encoding: BufferEncoding) => Promise<void>
type GitCredentialAction = "approve" | "reject"
type GitCredentialRunInput = {
  readonly action: GitCredentialAction
  readonly cwd: string
  readonly stdin: string
}
type SshKeygenRunInput = {
  readonly args: readonly string[]
  readonly cwd: string
}
type SshTestRunInput = {
  readonly cwd: string
  readonly host: string
  readonly provider?: SynapseGitProvider
}
type SshTestRunResult = {
  readonly detail: string | null
  readonly ok: boolean
}
type GitAccessCheckHostInput = {
  readonly host: string
  readonly protocol: SynapseGitProtocol
  readonly provider?: SynapseGitProvider
}
type GitAccessCheckInput = {
  readonly hosts?: readonly GitAccessCheckHostInput[]
}
type GitAccessDeps = {
  readonly actor?: ActorIdentity
  readonly auditSink?: Pick<AuditSink, "record">
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly effectivePath?: string | null
  readonly ensureDirectory?: EnsureDirectory
  readonly homeDir: string
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly now?: () => Date
  readonly pathExists: (filePath: string) => Promise<boolean>
  readonly permissionGuard?: Pick<PermissionGuard, "check">
  readonly platform: Platform
  readonly readFile: (filePath: string) => Promise<string>
  readonly runProcess?: ProcessRunner
  readonly runGitCredential?: (input: GitCredentialRunInput) => Promise<ProcessRunResult>
  readonly runSshKeygen?: (input: SshKeygenRunInput) => Promise<ProcessRunResult>
  readonly runSshTest?: (input: SshTestRunInput) => Promise<SshTestRunResult>
  readonly writeFile?: WriteFile
}
type GitAccessSecurityCheck = {
  readonly action: PermissionAction
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

const PROVIDER_LINKS: Readonly<Record<SynapseGitProvider, SynapseGitProviderLinks>> = {
  github: {
    credentialHelpUrl: "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git",
    sshKeysUrl: "https://github.com/settings/keys",
    tokenUrl: "https://github.com/settings/tokens",
  },
  gitee: {
    credentialHelpUrl: null,
    sshKeysUrl: "https://gitee.com/profile/sshkeys",
    tokenUrl: null,
  },
  gitlab: {
    credentialHelpUrl: null,
    sshKeysUrl: "https://gitlab.com/-/user_settings/ssh_keys",
    tokenUrl: null,
  },
  generic: {
    credentialHelpUrl: null,
    sshKeysUrl: null,
    tokenUrl: null,
  },
}

const SHARED_SAFE_CREDENTIAL_HELPERS = new Set(["manager", "manager-core"])
const ACCESS_ENV_ALLOWLIST = [
  "HOME",
  "USERPROFILE",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
  "SSH_AUTH_SOCK",
] as const
const FIRST_CONTROL_CHAR_CODE = 0
const LAST_CONTROL_CHAR_CODE = 31
const DELETE_CONTROL_CHAR_CODE = 127

function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

function detectProvider(host: string): SynapseGitProvider {
  if (host === "github.com") return "github"
  if (host === "gitee.com") return "gitee"
  if (host === "gitlab.com") return "gitlab"
  return "generic"
}

function normalizeHelperName(helper: string): string {
  return helper.trim().split(/\s+/)[0] ?? ""
}

function getPlatformCredentialHelpers(platform: Platform): ReadonlySet<string> {
  if (platform === "darwin") return new Set([...SHARED_SAFE_CREDENTIAL_HELPERS, "osxkeychain"])
  if (platform === "win32") return new Set([...SHARED_SAFE_CREDENTIAL_HELPERS, "wincred"])
  return SHARED_SAFE_CREDENTIAL_HELPERS
}

function isAllowedCredentialHelper(helper: string, platform: Platform): boolean {
  return getPlatformCredentialHelpers(platform).has(helper.trim())
}

function isSafeCredentialHelper(helpers: readonly string[], platform: Platform): boolean {
  return helpers.length > 0 && helpers.every((helper) => isAllowedCredentialHelper(helper, platform))
}

function isPlaintextCredentialStore(helper: string): boolean {
  return normalizeHelperName(helper) === "store"
}

function isNoCredentialHelperConfigError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const record = error as Record<string, unknown>
  if (record.exitCode === 5) return true
  const message = error instanceof Error ? error.message : typeof record.message === "string" ? record.message : ""
  return /no such key:\s*credential\.helper/i.test(message)
    || /no such section:\s*credential/i.test(message)
    || /key does not contain a section:\s*credential\.helper/i.test(message)
}

async function readCredentialHelpers(deps: Pick<GitAccessDeps, "commandRunner" | "homeDir">): Promise<readonly string[]> {
  try {
    const result = await deps.commandRunner.run({
      cwd: deps.homeDir,
      args: ["config", "--global", "--get-all", "credential.helper"],
      logFailure: false,
      operation: "git.access.check",
    })
    return result.stdout.split(/\r?\n/u).map((helper) => helper.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function readCredentialHelpersForConfiguration(
  deps: Pick<GitAccessDeps, "commandRunner" | "homeDir">,
): Promise<readonly string[]> {
  try {
    const result = await deps.commandRunner.run({
      cwd: deps.homeDir,
      args: ["config", "--global", "--get-all", "credential.helper"],
      logFailure: false,
      operation: "git.access.configureCredentialHelper",
    })
    return result.stdout.split(/\r?\n/u).map((helper) => helper.trim()).filter(Boolean)
  } catch (error) {
    if (isNoCredentialHelperConfigError(error)) return []
    throw new Error("无法读取旧的凭证保存配置。", { cause: error })
  }
}

async function unsetCredentialHelpers(deps: Pick<GitAccessDeps, "commandRunner" | "homeDir">): Promise<void> {
  await deps.commandRunner.run({
    cwd: deps.homeDir,
    args: ["config", "--global", "--unset-all", "credential.helper"],
    logFailure: false,
    operation: "git.access.configureCredentialHelper",
  })
}

async function addCredentialHelper(
  deps: Pick<GitAccessDeps, "commandRunner" | "homeDir">,
  helper: string,
): Promise<void> {
  await deps.commandRunner.run({
    cwd: deps.homeDir,
    args: ["config", "--global", "--add", "credential.helper", helper],
    logFailure: false,
    operation: "git.access.configureCredentialHelper",
  })
}

async function restoreCredentialHelpers(
  deps: Pick<GitAccessDeps, "commandRunner" | "homeDir">,
  helpers: readonly string[],
): Promise<void> {
  if (helpers.length === 0) return
  try {
    await unsetCredentialHelpers(deps)
  } catch (error) {
    if (!isNoCredentialHelperConfigError(error)) throw error
  }
  for (const helper of helpers) {
    await addCredentialHelper(deps, helper)
  }
}

function getEd25519PublicKeyPath(homeDir: string): string {
  return path.join(homeDir, ".ssh", "id_ed25519.pub")
}

function getEd25519PrivateKeyPath(homeDir: string): string {
  return path.join(homeDir, ".ssh", "id_ed25519")
}

function getSshDirectoryPath(homeDir: string): string {
  return path.join(homeDir, ".ssh")
}

function parsePublicKey(content: string): {
  readonly comment: string | null
  readonly fingerprint: string | null
  readonly type: string | null
} {
  const fields = content.trim().split(/\s+/)
  const type = fields[0] || null
  const encodedKey = fields[1] || null
  const comment = fields.slice(2).join(" ") || null
  let fingerprint: string | null = null
  if (encodedKey) {
    try {
      fingerprint = `SHA256:${createHash("sha256")
        .update(Buffer.from(encodedKey, "base64"))
        .digest("base64")
        .replace(/=+$/u, "")}`
    } catch {
      fingerprint = null
    }
  }
  return { comment, fingerprint, type }
}

async function readSshState(deps: Pick<GitAccessDeps, "homeDir" | "pathExists" | "readFile">): Promise<SynapseGitAccessState["ssh"]> {
  const publicKeyPath = getEd25519PublicKeyPath(deps.homeDir)
  try {
    if (!(await deps.pathExists(publicKeyPath))) {
      return {
        available: false,
        publicKeyComment: null,
        publicKeyFingerprint: null,
        publicKeyPath: null,
        publicKeyType: null,
      }
    }
    const parsed = parsePublicKey(await deps.readFile(publicKeyPath))
    return {
      available: true,
      publicKeyComment: parsed.comment,
      publicKeyFingerprint: parsed.fingerprint,
      publicKeyPath,
      publicKeyType: parsed.type,
    }
  } catch {
    return {
      available: false,
      publicKeyComment: null,
      publicKeyFingerprint: null,
      publicKeyPath: null,
      publicKeyType: null,
    }
  }
}

function buildCredentialInput(input: SynapseGitSaveHttpsCredentialInput | SynapseGitClearHttpsCredentialInput, includePassword: boolean): string {
  validateCredentialValue(input.host)
  if (input.username) validateCredentialValue(input.username)
  if (includePassword && "password" in input) validateCredentialValue(input.password)
  const lines = [
    "protocol=https",
    `host=${normalizeHost(input.host)}`,
  ]
  if (input.username) lines.push(`username=${input.username}`)
  if (includePassword && "password" in input) lines.push(`password=${input.password}`)
  return `${lines.join("\n")}\n\n`
}

function validateCredentialValue(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if ((code >= FIRST_CONTROL_CHAR_CODE && code <= LAST_CONTROL_CHAR_CODE) || code === DELETE_CONTROL_CHAR_CODE) {
      throw new Error("凭证内容包含不支持的换行或控制字符。")
    }
  }
}

export function buildAccessProcessEnvironment(input: {
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly effectivePath?: string | null
  readonly platform: Platform
}): NodeJS.ProcessEnv {
  const sourceEnv = input.baseEnv ?? process.env
  const env: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  }
  for (const key of ACCESS_ENV_ALLOWLIST) {
    if (sourceEnv[key]) env[key] = sourceEnv[key]
  }
  if (input.effectivePath) {
    if (input.platform === "win32") {
      env.Path = input.effectivePath
    } else {
      env.PATH = input.effectivePath
    }
  }
  return env
}

function createProcessError(message: string, result: ProcessRunResult): Error {
  const error = new Error(message)
  Object.defineProperties(error, {
    stderr: { enumerable: false, value: result.stderr },
    stdout: { enumerable: false, value: result.stdout },
  })
  return error
}

function getErrorMetadata(error: unknown): Record<string, unknown> {
  return {
    errorLength: String(error).length,
    errorName: error instanceof Error ? error.name : typeof error,
  }
}

async function checkGitAccessPermission(
  deps: Pick<GitAccessDeps, "actor" | "auditSink" | "permissionGuard">,
  check: GitAccessSecurityCheck,
): Promise<void> {
  if (!deps.permissionGuard) return
  const actor = deps.actor ?? { kind: "user" }
  const permission = await deps.permissionGuard.check({
    action: check.action,
    actor,
    context: check.metadata,
    resource: check.resource,
  })
  if (permission.allowed) return
  deps.auditSink?.record({
    action: check.action,
    actor,
    metadata: {
      ...check.metadata,
      policyId: permission.policyId,
      reason: permission.reason,
    },
    outcome: "denied",
    resource: check.resource,
  })
  throw new Error(permission.reason)
}

function recordGitAccessAudit(
  deps: Pick<GitAccessDeps, "actor" | "auditSink">,
  check: GitAccessSecurityCheck,
  outcome: "allowed" | "failed",
  extraMetadata: Record<string, unknown> = {},
): void {
  deps.auditSink?.record({
    action: check.action,
    actor: deps.actor ?? { kind: "user" },
    metadata: {
      ...check.metadata,
      ...extraMetadata,
    },
    outcome,
    resource: check.resource,
  })
}

async function runSecuredGitAccessOperation<T>(
  deps: Pick<GitAccessDeps, "actor" | "auditSink" | "permissionGuard">,
  checks: readonly GitAccessSecurityCheck[],
  operation: () => Promise<T>,
): Promise<T> {
  for (const check of checks) {
    await checkGitAccessPermission(deps, check)
  }
  try {
    const result = await operation()
    for (const check of checks) {
      recordGitAccessAudit(deps, check, "allowed")
    }
    return result
  } catch (error) {
    const metadata = getErrorMetadata(error)
    for (const check of checks) {
      recordGitAccessAudit(deps, check, "failed", metadata)
    }
    throw error
  }
}

function runProcess(input: ProcessRunInput, options: { readonly effectivePath?: string | null; readonly platform: Platform }): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: buildAccessProcessEnvironment({
        effectivePath: options.effectivePath,
        platform: options.platform,
      }),
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    let killTimeout: NodeJS.Timeout | null = null
    function settle(callback: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (killTimeout) clearTimeout(killTimeout)
      callback()
    }
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      childProcess.kill("SIGTERM")
      killTimeout = setTimeout(() => {
        childProcess.kill("SIGKILL")
      }, 1_000)
      reject(createProcessError(`${input.command} timed out.`, { stderr, stdout }))
    }, input.timeoutMs ?? 30_000)

    childProcess.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    childProcess.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    childProcess.on("error", (error) => {
      if (settled && killTimeout) {
        clearTimeout(killTimeout)
        return
      }
      settle(() => reject(error))
    })
    childProcess.on("close", (code) => {
      if (settled && killTimeout) {
        clearTimeout(killTimeout)
        return
      }
      settle(() => {
        if (code === 0) {
          resolve({ stderr, stdout })
          return
        }
        reject(createProcessError(`${input.command} exited with code ${code ?? "unknown"}.`, { stderr, stdout }))
      })
    })

    if (input.stdin !== undefined) {
      childProcess.stdin?.end(input.stdin)
    } else {
      childProcess.stdin?.end()
    }
  })
}

async function runDefaultGitCredential(input: GitCredentialRunInput, processRunner: ProcessRunner): Promise<ProcessRunResult> {
  return processRunner({
    command: "git",
    args: ["credential", input.action],
    cwd: input.cwd,
    stdin: input.stdin,
  })
}

async function runDefaultSshKeygen(input: SshKeygenRunInput, processRunner: ProcessRunner): Promise<ProcessRunResult> {
  return processRunner({
    command: "ssh-keygen",
    args: input.args,
    cwd: input.cwd,
  })
}

function joinProcessOutput(output: Pick<ProcessRunResult, "stderr" | "stdout">): string | null {
  return [output.stdout, output.stderr].join("\n").trim() || null
}

function getErrorDetail(error: unknown): string | null {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    const stdout = typeof record.stdout === "string" ? record.stdout : ""
    const stderr = typeof record.stderr === "string" ? record.stderr : ""
    const detail = joinProcessOutput({ stderr, stdout })
    if (detail) return detail
    if (typeof record.message === "string") return record.message
  }
  if (error instanceof Error) return error.message
  return String(error)
}

function hasSshAuthenticationSuccess(detail: string | null): boolean {
  if (!detail) return false
  if (/permission denied|authentication failed|could not read from remote repository/i.test(detail)) return false
  return /successfully authenticated|\bauthenticated\b|\bwelcome\b/i.test(detail)
}

async function runDefaultSshTest(input: SshTestRunInput, processRunner: ProcessRunner): Promise<SshTestRunResult> {
  try {
    const result = await processRunner({
      command: "ssh",
      args: ["-T", `git@${input.host}`],
      cwd: input.cwd,
      timeoutMs: 15_000,
    })
    const detail = joinProcessOutput(result)
    return {
      detail,
      ok: true,
    }
  } catch (error) {
    const detail = getErrorDetail(error)
    return {
      detail,
      ok: hasSshAuthenticationSuccess(detail),
    }
  }
}

export function createGitAccessService(deps: GitAccessDeps) {
  const now = deps.now ?? (() => new Date())
  const ensureDirectory = deps.ensureDirectory ?? ((directoryPath, options) => mkdir(directoryPath, options))
  const writePublicKey = deps.writeFile ?? ((filePath, content, encoding) => writeFile(filePath, content, encoding))
  const processRunner = deps.runProcess ?? ((input) => runProcess(input, {
    effectivePath: deps.effectivePath,
    platform: deps.platform,
  }))
  const runGitCredential = deps.runGitCredential ?? ((input) => runDefaultGitCredential(input, processRunner))
  const runSshKeygen = deps.runSshKeygen ?? ((input) => runDefaultSshKeygen(input, processRunner))
  const runSshTest = deps.runSshTest ?? ((input) => runDefaultSshTest(input, processRunner))

  return {
    async check(input: GitAccessCheckInput = {}): Promise<SynapseGitAccessState> {
      const helpers = await readCredentialHelpers(deps)
      const helper = helpers.length > 0 ? helpers.join(", ") : null
      const ssh = await readSshState(deps)
      return {
        checkedAt: now().toISOString(),
        credentialHelper: {
          helper,
          safe: isSafeCredentialHelper(helpers, deps.platform),
          source: helper ? "global" : null,
        },
        hosts: (input.hosts ?? []).map((hostInput) => {
          const host = normalizeHost(hostInput.host)
          return {
            host,
            lastFailure: null,
            protocol: hostInput.protocol,
            provider: hostInput.provider ?? detectProvider(host),
          }
        }),
        providerLinks: PROVIDER_LINKS,
        ssh,
      }
    },

    async configureCredentialHelper(input: { readonly helper: string }): Promise<void> {
      const helper = input.helper.trim()
      if (isPlaintextCredentialStore(helper)) {
        deps.logger?.warn("Git credential helper configuration blocked.", {
          helper: "store",
          reason: "plaintext-store",
        })
        throw new Error("不能使用明文凭证保存方式。")
      }
      if (!isAllowedCredentialHelper(helper, deps.platform)) {
        deps.logger?.warn("Git credential helper configuration blocked.", {
          helperLength: helper.length,
          reason: "unsupported-helper",
        })
        throw new Error("不支持此凭证保存方式。")
      }
      await runSecuredGitAccessOperation(deps, [
        {
          action: "fs.write.outside-userdata",
          resource: "git:global-config:credential.helper",
          metadata: {
            helper,
            operation: "git.access.configureCredentialHelper",
          },
        },
        {
          action: "shell.exec",
          resource: "git",
          metadata: {
            command: "git",
            operation: "git.access.configureCredentialHelper",
          },
        },
      ], async () => {
        const previousHelpers = await readCredentialHelpersForConfiguration(deps)
        if (previousHelpers.length > 0) {
          try {
            await unsetCredentialHelpers(deps)
          } catch (error) {
            // Missing credential.helper is fine; lock/permission/config corruption must stop here.
            if (!isNoCredentialHelperConfigError(error)) {
              throw new Error("无法清理旧的凭证保存配置。", { cause: error })
            }
          }
        }
        try {
          await addCredentialHelper(deps, helper)
        } catch (error) {
          if (previousHelpers.length > 0) {
            try {
              await restoreCredentialHelpers(deps, previousHelpers)
              deps.logger?.warn("Restored previous Git credential helpers after configuration failure.", {
                previousHelperCount: previousHelpers.length,
              })
            } catch (restoreError) {
              deps.logger?.warn("Failed to restore previous Git credential helpers after configuration failure.", {
                error: restoreError,
                previousHelperCount: previousHelpers.length,
              })
              throw new Error("无法配置新的凭证保存方式，且恢复旧配置失败。请手动检查 Git credential.helper。", {
                cause: restoreError,
              })
            }
            throw new Error("无法配置新的凭证保存方式，已恢复旧配置。", { cause: error })
          }
          throw new Error("无法配置新的凭证保存方式。", { cause: error })
        }
      })
    },

    async saveHttpsCredential(input: SynapseGitSaveHttpsCredentialInput): Promise<void> {
      const helpers = await readCredentialHelpers(deps)
      if (!isSafeCredentialHelper(helpers, deps.platform)) {
        throw new Error("请先设置安全的凭证保存方式。")
      }
      const host = normalizeHost(input.host)
      await runSecuredGitAccessOperation(deps, [
        {
          action: "secret.write",
          resource: `git-credential:https://${host}`,
          metadata: {
            credentialAction: "approve",
            host,
            operation: "git.access.saveHttpsCredential",
            usernameLength: input.username.length,
          },
        },
        {
          action: "shell.exec",
          resource: "git",
          metadata: {
            command: "git",
            credentialAction: "approve",
            host,
            operation: "git.access.saveHttpsCredential",
          },
        },
      ], async () => {
        await runGitCredential({
          action: "approve",
          cwd: deps.homeDir,
          stdin: buildCredentialInput(input, true),
        })
        deps.logger?.info("Git HTTPS credential saved.", {
          host,
          usernameLength: input.username.length,
        })
      })
    },

    async clearHttpsCredential(input: SynapseGitClearHttpsCredentialInput): Promise<void> {
      const helpers = await readCredentialHelpers(deps)
      if (!isSafeCredentialHelper(helpers, deps.platform)) {
        throw new Error("请先设置安全的凭证保存方式。")
      }
      const host = normalizeHost(input.host)
      await runSecuredGitAccessOperation(deps, [
        {
          action: "secret.write",
          resource: `git-credential:https://${host}`,
          metadata: {
            credentialAction: "reject",
            host,
            operation: "git.access.clearHttpsCredential",
            usernamePresent: Boolean(input.username),
          },
        },
        {
          action: "shell.exec",
          resource: "git",
          metadata: {
            command: "git",
            credentialAction: "reject",
            host,
            operation: "git.access.clearHttpsCredential",
          },
        },
      ], async () => {
        await runGitCredential({
          action: "reject",
          cwd: deps.homeDir,
          stdin: buildCredentialInput(input, false),
        })
        deps.logger?.info("Git HTTPS credential cleared.", {
          host,
          usernamePresent: Boolean(input.username),
        })
      })
    },

    async generateSshKey(input: SynapseGitGenerateSshKeyInput): Promise<void> {
      const publicKeyPath = getEd25519PublicKeyPath(deps.homeDir)
      const privateKeyPath = getEd25519PrivateKeyPath(deps.homeDir)
      if (await deps.pathExists(publicKeyPath)) return
      if (await deps.pathExists(privateKeyPath)) {
        await runSecuredGitAccessOperation(deps, [
          {
            action: "secret.read",
            resource: privateKeyPath,
            metadata: {
              operation: "git.access.generateSshKey.restorePublicKey",
            },
          },
          {
            action: "fs.write.outside-userdata",
            resource: publicKeyPath,
            metadata: {
              operation: "git.access.generateSshKey.restorePublicKey",
            },
          },
          {
            action: "shell.exec",
            resource: "ssh-keygen",
            metadata: {
              command: "ssh-keygen",
              operation: "git.access.generateSshKey.restorePublicKey",
            },
          },
        ], async () => {
          const restored = await runSshKeygen({
            cwd: deps.homeDir,
            args: ["-y", "-f", privateKeyPath],
          })
          const publicKey = restored.stdout.trim()
          if (!publicKey) {
            throw new Error("无法从已有 SSH 私钥恢复公钥。")
          }
          await writePublicKey(publicKeyPath, `${publicKey}\n`, "utf8")
        })
        return
      }
      await runSecuredGitAccessOperation(deps, [
        {
          action: "fs.write.outside-userdata",
          resource: getSshDirectoryPath(deps.homeDir),
          metadata: {
            operation: "git.access.generateSshKey",
            targetFile: privateKeyPath,
          },
        },
        {
          action: "shell.exec",
          resource: "ssh-keygen",
          metadata: {
            command: "ssh-keygen",
            operation: "git.access.generateSshKey",
          },
        },
      ], async () => {
        await ensureDirectory(getSshDirectoryPath(deps.homeDir), { recursive: true, mode: 0o700 })
        await runSshKeygen({
          cwd: deps.homeDir,
          args: ["-t", "ed25519", "-C", input.email, "-f", privateKeyPath, "-N", ""],
        })
      })
    },

    async testSshConnection(input: SynapseGitTestSshConnectionInput): Promise<SynapseGitSshTestResult> {
      const host = normalizeHost(input.host)
      return runSecuredGitAccessOperation(deps, [
        {
          action: "network.connect",
          resource: `ssh://${host}`,
          metadata: {
            host,
            operation: "git.access.testSshConnection",
            provider: input.provider ?? detectProvider(host),
          },
        },
        {
          action: "shell.exec",
          resource: "ssh",
          metadata: {
            command: "ssh",
            host,
            operation: "git.access.testSshConnection",
            provider: input.provider ?? detectProvider(host),
          },
        },
      ], async () => {
        const result = await runSshTest({
          cwd: deps.homeDir,
          host,
          provider: input.provider,
        })
        return {
          detail: result.detail,
          host,
          ok: result.ok,
          title: result.ok ? "SSH 可用" : "SSH 访问失败",
        }
      })
    },
  }
}

export type GitAccessService = ReturnType<typeof createGitAccessService>
