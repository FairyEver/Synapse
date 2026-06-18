import path from "node:path"
import { createHash } from "node:crypto"
import type { ShellEnvironmentSnapshot } from "../../runtime/process"
import type { SynapseGitEnvironmentState, SynapseGitSshPublicKey } from "../../../src/types/git"
import { categorizeGitError } from "./git-command-runner"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitLogger,
  createGitOperation,
  gitFailureLogMeta,
  logGitOperationFailure,
  logGitOperationStart,
  logGitOperationSuccess,
  sanitizeGitText,
  type GitLogger,
} from "./git-log-utils"

type Platform = NodeJS.Platform

type EnvironmentDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly homeDir: string
  readonly logger?: GitLogger
  readonly pathExists: (filePath: string) => Promise<boolean>
  readonly readFile: (filePath: string) => Promise<string>
  readonly platform: Platform
  readonly shellEnvironment: ShellEnvironmentSnapshot
  readonly now?: () => Date
}

const defaultLogger = createGitLogger("git.environment")

function installHint(platform: Platform): string {
  if (platform === "win32") return "安装 Git for Windows 后重新检测。"
  if (platform === "darwin") return "安装 Apple Command Line Tools 或官方 Git 后重新检测。"
  return "通过系统包管理器安装 Git 后重新检测。"
}

async function readConfig(
  commandRunner: Pick<GitClientCommandRunner, "run">,
  homeDir: string,
  key: string,
): Promise<string | null> {
  try {
    const result = await commandRunner.run({
      cwd: homeDir,
      args: ["config", "--global", key],
      logFailure: false,
      operation: "git.environment.check",
    })
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

async function readConfigSource(
  commandRunner: Pick<GitClientCommandRunner, "run">,
  homeDir: string,
  key: string,
): Promise<string | null> {
  try {
    const result = await commandRunner.run({
      cwd: homeDir,
      args: ["config", "--global", "--show-origin", "--get", key],
      logFailure: false,
      operation: "git.environment.check",
    })
    const line = result.stdout.trim()
    if (!line) return null
    const tabIndex = line.indexOf("\t")
    if (tabIndex > 0) return line.slice(0, tabIndex).trim() || null
    const spaceIndex = line.indexOf(" ")
    if (spaceIndex > 0) return line.slice(0, spaceIndex).trim() || null
    return "global"
  } catch {
    return null
  }
}

async function findCommonSshPublicKey(
  homeDir: string,
  pathExists: (filePath: string) => Promise<boolean>,
  readFile: (filePath: string) => Promise<string>,
): Promise<SynapseGitSshPublicKey | null> {
  const sshDir = path.join(homeDir, ".ssh")
  const candidates = [
    path.join(sshDir, "id_ed25519.pub"),
    path.join(sshDir, "id_rsa.pub"),
  ]

  for (const filePath of candidates) {
    if (await pathExists(filePath)) {
      const content = (await readFile(filePath)).trim()
      return content ? { path: filePath, content } : null
    }
  }

  return null
}

type SshPublicKeyDetails = {
  readonly path: string | null
  readonly type: string | null
  readonly comment: string | null
  readonly fingerprint: string | null
}

function getEmptySshPublicKeyDetails(): SshPublicKeyDetails {
  return {
    path: null,
    type: null,
    comment: null,
    fingerprint: null,
  }
}

function parseSshPublicKeyDetails(key: SynapseGitSshPublicKey | null): SshPublicKeyDetails {
  if (!key) return getEmptySshPublicKeyDetails()
  const fields = key.content.trim().split(/\s+/)
  const type = fields[0] || null
  const encodedKey = fields[1] || null
  const comment = fields.slice(2).join(" ") || null
  let fingerprint: string | null = null

  if (encodedKey) {
    try {
      const digest = createHash("sha256")
        .update(Buffer.from(encodedKey, "base64"))
        .digest("base64")
        .replace(/=+$/u, "")
      fingerprint = `SHA256:${digest}`
    } catch {
      fingerprint = null
    }
  }

  return {
    path: key.path,
    type,
    comment,
    fingerprint,
  }
}

export function createGitEnvironmentService(deps: EnvironmentDeps) {
  const now = deps.now ?? (() => new Date())
  const logger = deps.logger ?? defaultLogger

  async function getPublicKeyDetails(): Promise<SshPublicKeyDetails> {
    try {
      return parseSshPublicKeyDetails(await findCommonSshPublicKey(deps.homeDir, deps.pathExists, deps.readFile))
    } catch {
      return getEmptySshPublicKeyDetails()
    }
  }

  function baseState(): Pick<
    SynapseGitEnvironmentState,
    | "checkedAt"
    | "platform"
    | "homeDir"
    | "processPath"
    | "shellPath"
    | "effectivePath"
    | "processGitPath"
    | "shellGitPath"
    | "effectiveGitPath"
  > {
    return {
      checkedAt: now().toISOString(),
      platform: deps.platform,
      homeDir: deps.homeDir,
      processPath: deps.shellEnvironment.processPath,
      shellPath: deps.shellEnvironment.shellPath,
      effectivePath: deps.shellEnvironment.effectivePath,
      processGitPath: deps.shellEnvironment.processGitPath,
      shellGitPath: deps.shellEnvironment.shellGitPath,
      effectiveGitPath: deps.shellEnvironment.effectiveGitPath,
    }
  }

  return {
    async check(): Promise<SynapseGitEnvironmentState> {
      const publicKey = await getPublicKeyDetails()
      try {
        const gitVersionResult = await deps.commandRunner.run({
          cwd: deps.homeDir,
          args: ["--version"],
          operation: "git.environment.check",
        })
        let sshAvailable = false
        try {
          await deps.commandRunner.run({
            cwd: deps.homeDir,
            args: ["-c", "core.sshCommand=ssh -V", "version"],
            logFailure: false,
            operation: "git.environment.check",
          })
          sshAvailable = true
        } catch {
          sshAvailable = false
        }
        const userName = await readConfig(deps.commandRunner, deps.homeDir, "user.name")
        const userEmail = await readConfig(deps.commandRunner, deps.homeDir, "user.email")

        const state = {
          ...baseState(),
          gitAvailable: true,
          gitVersion: gitVersionResult.stdout.trim() || null,
          gitPath: deps.shellEnvironment.effectiveGitPath,
          sshAvailable,
          userName,
          userEmail,
          userNameSource: userName ? await readConfigSource(deps.commandRunner, deps.homeDir, "user.name") : null,
          userEmailSource: userEmail ? await readConfigSource(deps.commandRunner, deps.homeDir, "user.email") : null,
          commonSshKeyExists: publicKey.path !== null,
          sshPublicKeyPath: publicKey.path,
          sshPublicKeyType: publicKey.type,
          sshPublicKeyComment: publicKey.comment,
          sshPublicKeyFingerprint: publicKey.fingerprint,
          installHint: null,
        }
        logger.info("Git environment check completed.", {
          operation: "git.environment.check",
          commonSshKeyExists: state.commonSshKeyExists,
          gitAvailable: state.gitAvailable,
          gitPath: state.gitPath ? sanitizeGitText(state.gitPath) : null,
          gitVersion: state.gitVersion,
          homeDir: sanitizeGitText(state.homeDir),
          sshAvailable: state.sshAvailable,
          userEmailConfigured: state.userEmail !== null,
          userNameConfigured: state.userName !== null,
        })
        return state
      } catch (error) {
        logger.warn("Git environment check failed.", {
          operation: "git.environment.check",
          commonSshKeyExists: publicKey.path !== null,
          effectiveGitPath: deps.shellEnvironment.effectiveGitPath
            ? sanitizeGitText(deps.shellEnvironment.effectiveGitPath)
            : null,
          homeDir: sanitizeGitText(deps.homeDir),
          ...gitFailureLogMeta(error, { category: categorizeGitError(error) }),
        })
        return {
          ...baseState(),
          gitAvailable: false,
          gitVersion: null,
          gitPath: deps.shellEnvironment.effectiveGitPath,
          sshAvailable: false,
          userName: null,
          userEmail: null,
          userNameSource: null,
          userEmailSource: null,
          commonSshKeyExists: publicKey.path !== null,
          sshPublicKeyPath: publicKey.path,
          sshPublicKeyType: publicKey.type,
          sshPublicKeyComment: publicKey.comment,
          sshPublicKeyFingerprint: publicKey.fingerprint,
          installHint: installHint(deps.platform),
        }
      }
    },

    async configureIdentity(input: { readonly userName: string; readonly userEmail: string }): Promise<void> {
      const operation = createGitOperation("git.environment.configureIdentity")
      const userName = input.userName.trim()
      const userEmail = input.userEmail.trim()
      if (!userName) throw new Error("请输入用户名。")
      if (!userEmail) throw new Error("请输入邮箱。")
      logGitOperationStart(logger, "Git operation started.", operation, undefined, {
        homeDir: sanitizeGitText(deps.homeDir),
        userEmailProvided: true,
        userNameProvided: true,
      })
      try {
        await deps.commandRunner.run({
          cwd: deps.homeDir,
          args: ["config", "--global", "user.name", userName],
          operation: operation.operation,
          operationId: operation.operationId,
        })
        await deps.commandRunner.run({
          cwd: deps.homeDir,
          args: ["config", "--global", "user.email", userEmail],
          operation: operation.operation,
          operationId: operation.operationId,
        })
        logGitOperationSuccess(logger, "Git operation completed.", operation, undefined, {
          homeDir: sanitizeGitText(deps.homeDir),
        })
      } catch (error) {
        logGitOperationFailure(logger, "Git operation failed.", operation, error, undefined, {
          errorCategory: categorizeGitError(error),
          homeDir: sanitizeGitText(deps.homeDir),
        })
        throw error
      }
    },

    async getSshPublicKey(): Promise<SynapseGitSshPublicKey | null> {
      return findCommonSshPublicKey(deps.homeDir, deps.pathExists, deps.readFile)
    },
  }
}

export type GitEnvironmentService = ReturnType<typeof createGitEnvironmentService>
