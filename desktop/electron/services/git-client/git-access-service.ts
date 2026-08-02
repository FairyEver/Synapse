import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
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
  SynapseGitSshHostKeyCandidate,
  SynapseGitTestSshConnectionInput,
} from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import type { GitClientCommandRunner } from "./git-command-runner"
import { findCommonSshPublicKey, parseSshPublicKeyDetails } from "./git-ssh-public-key"

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
type RenameFile = (oldPath: string, newPath: string) => Promise<void>
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
  readonly port?: number | null
  readonly provider?: SynapseGitProvider
  readonly username?: string | null
}
type SshTestRunResult = {
  readonly detail: string | null
  readonly ok: boolean
}
type GitAccessCheckHostInput = {
  readonly host: string
  readonly port?: number | null
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
  readonly renameFile?: RenameFile
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

function buildCredentialHost(host: string, port?: number | null): string {
  const normalizedHost = normalizeHost(host)
  const hostToken = normalizedHost.includes(":") && !normalizedHost.startsWith("[")
    ? `[${normalizedHost}]`
    : normalizedHost
  return port ? `${hostToken}:${String(port)}` : hostToken
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

function isSafeCredentialHelper(helpers: readonly CredentialHelperEntry[]): boolean {
  return credentialHelperManagement(helpers) === "synapse-supported"
}

function isPlaintextCredentialStore(helper: string): boolean {
  return normalizeHelperName(helper) === "store"
}

type CredentialHelperEntry = SynapseGitAccessState["credentialHelper"]["helpers"][number]

function parseCredentialHelpers(output: string, platform: Platform): CredentialHelperEntry[] {
  return output.split(/\r?\n/u).filter((line) => line.trim().length > 0).map((line) => {
    const separator = line.indexOf("\t")
    const source = separator >= 0 ? line.slice(0, separator).trim() || null : null
    const value = (separator >= 0 ? line.slice(separator + 1) : line).trim()
    return {
      classification: isPlaintextCredentialStore(value)
        ? "plaintext" as const
        : isAllowedCredentialHelper(value, platform) ? "safe" as const : "custom" as const,
      source,
      value,
    }
  })
}

function credentialHelperManagement(entries: readonly CredentialHelperEntry[], homeDir?: string): SynapseGitAccessState["credentialHelper"]["management"] {
  if (entries.length === 0) return "unconfigured"
  if (entries.length > 1) return "external"
  if (entries[0]?.classification === "safe") return "synapse-supported"
  if (entries[0]?.classification === "plaintext") {
    return homeDir && !isUserCredentialConfigSource(entries[0]?.source ?? null, homeDir) ? "external" : "insecure"
  }
  return "external"
}

function isUserCredentialConfigSource(source: string | null, homeDir: string): boolean {
  if (source === null) return true
  const normalized = source.replace(/^file:/u, "")
  return normalized === path.join(homeDir, ".gitconfig")
    || normalized === path.join(homeDir, ".config", "git", "config")
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

async function readCredentialHelpers(deps: Pick<GitAccessDeps, "commandRunner" | "homeDir" | "platform">): Promise<readonly CredentialHelperEntry[]> {
  try {
    const result = await deps.commandRunner.run({
      cwd: deps.homeDir,
      args: ["config", "--show-origin", "--get-all", "credential.helper"],
      logFailure: false,
      operation: "git.access.check",
    })
    return parseCredentialHelpers(result.stdout, deps.platform)
  } catch {
    return []
  }
}

async function readCredentialHelpersForConfiguration(
  deps: Pick<GitAccessDeps, "commandRunner" | "homeDir" | "platform">,
): Promise<readonly CredentialHelperEntry[]> {
  try {
    const result = await deps.commandRunner.run({
      cwd: deps.homeDir,
      args: ["config", "--show-origin", "--get-all", "credential.helper"],
      logFailure: false,
      operation: "git.access.configureCredentialHelper",
    })
    return parseCredentialHelpers(result.stdout, deps.platform)
  } catch (error) {
    if (isNoCredentialHelperConfigError(error)) return []
    throw new Error("无法读取旧的凭证保存配置。", { cause: error })
  }
}

async function setCredentialHelper(
  deps: Pick<GitAccessDeps, "commandRunner" | "homeDir">,
  helper: string,
  replace: boolean,
): Promise<void> {
  await deps.commandRunner.run({
    cwd: deps.homeDir,
    args: ["config", "--global", replace ? "--replace-all" : "--add", "credential.helper", helper],
    logFailure: false,
    operation: "git.access.configureCredentialHelper",
  })
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

function getKnownHostsPath(homeDir: string): string {
  return path.join(getSshDirectoryPath(homeDir), "known_hosts")
}

function knownHostToken(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${String(port)}`
}

function parseScannedHostKeys(output: string): Array<{ readonly fingerprint: string; readonly line: string }> {
  return output.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
    const [, keyType, encoded] = line.split(/\s+/u)
    if (!keyType?.startsWith("ssh-") && !keyType?.startsWith("ecdsa-")) return null
    if (!encoded) return null
    try {
      const fingerprint = `SHA256:${createHash("sha256").update(Buffer.from(encoded, "base64")).digest("base64").replace(/=+$/u, "")}`
      return { fingerprint, line }
    } catch {
      return null
    }
  }).filter((entry): entry is { readonly fingerprint: string; readonly line: string } => entry !== null)
}

async function readSshState(deps: Pick<GitAccessDeps, "homeDir" | "pathExists" | "readFile">): Promise<SynapseGitAccessState["ssh"]> {
  try {
    const parsed = parseSshPublicKeyDetails(await findCommonSshPublicKey(deps))
    return {
      available: parsed.path !== null,
      publicKeyComment: parsed.comment,
      publicKeyFingerprint: parsed.fingerprint,
      publicKeyPath: parsed.path,
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
    `protocol=${input.protocol}`,
    `host=${buildCredentialHost(input.host, input.port)}`,
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
  const args = [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    ...(input.port ? ["-p", String(input.port)] : []),
    `${input.username?.trim() || "git"}@${input.host}`,
  ]
  try {
    const result = await processRunner({
      command: "ssh",
      args,
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
  const renameFile = deps.renameFile ?? rename
  const processRunner = deps.runProcess ?? ((input) => runProcess(input, {
    effectivePath: deps.effectivePath,
    platform: deps.platform,
  }))
  const runGitCredential = deps.runGitCredential ?? ((input) => runDefaultGitCredential(input, processRunner))
  const runSshKeygen = deps.runSshKeygen ?? ((input) => runDefaultSshKeygen(input, processRunner))
  const runSshTest = deps.runSshTest ?? ((input) => runDefaultSshTest(input, processRunner))

  async function scanSshHostKey(hostInput: string, portInput?: number | null): Promise<{
    readonly candidate: SynapseGitSshHostKeyCandidate
    readonly lines: readonly string[]
  }> {
    const host = normalizeHost(hostInput)
    const port = portInput ?? 22
    const result = await processRunner({
      command: "ssh-keyscan",
      args: ["-T", "10", "-p", String(port), host],
      cwd: deps.homeDir,
      timeoutMs: 15_000,
    })
    const scanned = parseScannedHostKeys(result.stdout)
    if (scanned.length === 0) throw new Error("未能读取 SSH 主机公钥。")
    const knownHostsPath = getKnownHostsPath(deps.homeDir)
    const token = knownHostToken(host, port)
    let knownLines: readonly string[] = []
    if (await deps.pathExists(knownHostsPath)) {
      try {
        const knownResult = await processRunner({
          command: "ssh-keygen",
          args: ["-F", token, "-f", knownHostsPath],
          cwd: deps.homeDir,
        })
        knownLines = knownResult.stdout.split(/\r?\n/u).map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"))
      } catch (error) {
        const stderr = error && typeof error === "object" && typeof (error as Record<string, unknown>).stderr === "string"
          ? (error as Record<string, string>).stderr.trim()
          : ""
        if (stderr) throw new Error("无法核验 known_hosts 中的 SSH 主机密钥。", { cause: error })
      }
    }
    const knownKeys = new Set(knownLines.map((line) => line.split(/\s+/u).slice(1, 3).join(" ")))
    const scannedKeys = new Set(scanned.map(({ line }) => line.split(/\s+/u).slice(1, 3).join(" ")))
    const trusted = [...scannedKeys].some((key) => knownKeys.has(key))
    return {
      candidate: {
        changed: knownKeys.size > 0 && !trusted,
        fingerprints: scanned.map(({ fingerprint }) => fingerprint),
        host,
        port,
        trusted,
      },
      lines: scanned.map(({ line }) => line),
    }
  }

  return {
    async check(input: GitAccessCheckInput = {}): Promise<SynapseGitAccessState> {
      const helpers = await readCredentialHelpers(deps)
      const helper = helpers.length > 0 ? helpers.map((entry) => entry.value).join(", ") : null
      const management = credentialHelperManagement(helpers, deps.homeDir)
      const ssh = await readSshState(deps)
      return {
        checkedAt: now().toISOString(),
        credentialHelper: {
          helpers,
          management,
          helper,
          safe: isSafeCredentialHelper(helpers),
          source: helpers.length === 1 ? helpers[0]?.source ?? null : null,
        },
        hosts: (input.hosts ?? []).map((hostInput) => {
          const host = normalizeHost(hostInput.host)
          return {
            host,
            lastFailure: null,
            port: hostInput.port ?? null,
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
        const management = credentialHelperManagement(previousHelpers, deps.homeDir)
        if (management === "external") {
          throw new Error("凭据助手由外部 Git 配置管理，Synapse 不会覆盖或重排。")
        }
        if (management === "insecure" && !isUserCredentialConfigSource(previousHelpers[0]?.source ?? null, deps.homeDir)) {
          throw new Error("凭据助手来自系统或外部 Git 配置，Synapse 不会覆盖。")
        }
        if (management === "synapse-supported") {
          if (previousHelpers[0]?.value === helper) return
          throw new Error("当前安全凭据助手已配置，Synapse 不会覆盖。")
        }
        try {
          await setCredentialHelper(deps, helper, management === "insecure")
        } catch (error) {
          const previousHelper = previousHelpers[0]?.value
          if (management === "insecure" && previousHelper) {
            try {
              await setCredentialHelper(deps, previousHelper, true)
              deps.logger?.warn("Restored previous Git credential helper after configuration failure.", {
                previousHelperClassification: "plaintext",
              })
            } catch (restoreError) {
              deps.logger?.warn("Failed to restore previous Git credential helper after configuration failure.", {
                error: restoreError,
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
      if (!isSafeCredentialHelper(helpers)) {
        throw new Error("请先设置安全的凭证保存方式。")
      }
      const host = normalizeHost(input.host)
      const credentialHost = buildCredentialHost(host, input.port)
      await runSecuredGitAccessOperation(deps, [
        {
          action: "secret.write",
          resource: `git-credential:${input.protocol}://${credentialHost}`,
          metadata: {
            credentialAction: "approve",
            host,
            port: input.port ?? null,
            protocol: input.protocol,
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
            port: input.port ?? null,
            protocol: input.protocol,
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
          port: input.port ?? null,
          protocol: input.protocol,
          usernameLength: input.username.length,
        })
      })
    },

    async clearHttpsCredential(input: SynapseGitClearHttpsCredentialInput): Promise<void> {
      const helpers = await readCredentialHelpers(deps)
      if (!isSafeCredentialHelper(helpers)) {
        throw new Error("请先设置安全的凭证保存方式。")
      }
      const host = normalizeHost(input.host)
      const credentialHost = buildCredentialHost(host, input.port)
      await runSecuredGitAccessOperation(deps, [
        {
          action: "secret.write",
          resource: `git-credential:${input.protocol}://${credentialHost}`,
          metadata: {
            credentialAction: "reject",
            host,
            port: input.port ?? null,
            protocol: input.protocol,
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
            port: input.port ?? null,
            protocol: input.protocol,
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
          port: input.port ?? null,
          protocol: input.protocol,
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
            port: input.port ?? 22,
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
            port: input.port ?? 22,
            operation: "git.access.testSshConnection",
            provider: input.provider ?? detectProvider(host),
          },
        },
      ], async () => {
        const result = await runSshTest({
          cwd: deps.homeDir,
          host,
          port: input.port,
          provider: input.provider,
          username: input.username,
        })
        return {
          detail: result.detail,
          host,
          ok: result.ok,
          title: result.ok ? "SSH 可用" : "SSH 访问失败",
        }
      })
    },

    async scanSshHostKey(input: SynapseGitTestSshConnectionInput): Promise<SynapseGitSshHostKeyCandidate> {
      const host = normalizeHost(input.host)
      return runSecuredGitAccessOperation(deps, [
        {
          action: "network.connect",
          resource: `ssh://${host}:${String(input.port ?? 22)}`,
          metadata: { host, port: input.port ?? 22, operation: "git.access.scanSshHostKey" },
        },
        {
          action: "shell.exec",
          resource: "ssh-keyscan",
          metadata: { command: "ssh-keyscan", host, port: input.port ?? 22, operation: "git.access.scanSshHostKey" },
        },
        {
          action: "shell.exec",
          resource: "ssh-keygen",
          metadata: { command: "ssh-keygen", host, port: input.port ?? 22, operation: "git.access.scanSshHostKey" },
        },
      ], async () => (await scanSshHostKey(host, input.port)).candidate)
    },

    async trustSshHostKey(input: { readonly fingerprints: readonly string[]; readonly host: string; readonly port?: number | null }): Promise<void> {
      const host = normalizeHost(input.host)
      const port = input.port ?? 22
      const knownHostsPath = getKnownHostsPath(deps.homeDir)
      await runSecuredGitAccessOperation(deps, [
        {
          action: "network.connect",
          resource: `ssh://${host}:${String(port)}`,
          metadata: { host, port, operation: "git.access.trustSshHostKey" },
        },
        {
          action: "shell.exec",
          resource: "ssh-keyscan",
          metadata: { command: "ssh-keyscan", host, port, operation: "git.access.trustSshHostKey" },
        },
        {
          action: "shell.exec",
          resource: "ssh-keygen",
          metadata: { command: "ssh-keygen", host, port, operation: "git.access.trustSshHostKey" },
        },
        {
          action: "fs.write.outside-userdata",
          resource: knownHostsPath,
          metadata: { host, port, operation: "git.access.trustSshHostKey" },
        },
      ], async () => {
        const scanned = await scanSshHostKey(host, port)
        if (scanned.candidate.changed) {
          throw new Error("SSH 主机密钥与 known_hosts 中的记录不一致，请人工核验。")
        }
        const expected = [...input.fingerprints].sort().join("\n")
        const actual = [...scanned.candidate.fingerprints].sort().join("\n")
        if (!expected || expected !== actual) throw new Error("SSH 主机密钥已变化，请重新核验。")
        if (scanned.candidate.trusted) return
        await ensureDirectory(getSshDirectoryPath(deps.homeDir), { recursive: true, mode: 0o700 })
        const current = await deps.pathExists(knownHostsPath) ? await deps.readFile(knownHostsPath) : ""
        const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n"
        const next = `${current}${separator}${scanned.lines.join("\n")}\n`
        const temporaryPath = `${knownHostsPath}.synapse-${String(process.pid)}-${String(Date.now())}`
        await writePublicKey(temporaryPath, next, "utf8")
        await renameFile(temporaryPath, knownHostsPath)
      })
    },
  }
}

export type GitAccessService = ReturnType<typeof createGitAccessService>
