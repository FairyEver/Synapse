import { spawn } from "node:child_process"
import type { SynapseGitEnvironmentState, SynapseGitSshPublicKey } from "../../../src/types/git"
import type { ShellEnvironmentSnapshot } from "../../runtime/process"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitOperationId,
  logGitOperationBlocked,
  logGitOperationFailed,
  logGitOperationStarted,
  logGitOperationSucceeded,
} from "./git-logging"
import {
  emptySshPublicKeyDetails,
  findCommonSshPublicKey,
  parseSshPublicKeyDetails,
  type GitSshPublicKeyDetails,
} from "./git-ssh-public-key"

type Platform = NodeJS.Platform

type EnvironmentDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly homeDir: string
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly now?: () => Date
  readonly pathExists: (filePath: string) => Promise<boolean>
  readonly readFile: (filePath: string) => Promise<string>
  readonly platform: Platform
  readonly runSshVersion?: () => Promise<void>
  readonly shellEnvironment: ShellEnvironmentSnapshot
}

function installHint(platform: Platform): string {
  if (platform === "win32") return "安装 Git for Windows 后重新检测。"
  if (platform === "darwin") return "安装 Apple Command Line Tools 或官方 Git 后重新检测。"
  return "通过系统包管理器安装 Git 后重新检测。"
}

function runDefaultSshVersion(deps: Pick<EnvironmentDeps, "homeDir" | "platform" | "shellEnvironment">): Promise<void> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn("ssh", ["-V"], {
      cwd: deps.homeDir,
      env: buildSshProbeEnvironment(deps),
      windowsHide: true,
    })
    let settled = false
    const timeout = setTimeout(() => {
      settled = true
      childProcess.kill("SIGTERM")
      reject(new Error("SSH version check timed out."))
    }, 10_000)

    childProcess.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })

    childProcess.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error("SSH version check failed."))
    })
  })
}

export function buildSshProbeEnvironment(
  deps: Pick<EnvironmentDeps, "platform" | "shellEnvironment"> & { readonly baseEnv?: NodeJS.ProcessEnv },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...(deps.baseEnv ?? process.env),
    LANG: "C",
    LC_ALL: "C",
  }
  if (deps.shellEnvironment.effectivePath) {
    if (deps.platform === "win32") {
      for (const key of Object.keys(env)) {
        if (key.toLowerCase() === "path") delete env[key]
      }
      env.Path = deps.shellEnvironment.effectivePath
    } else {
      env.PATH = deps.shellEnvironment.effectivePath
    }
  }
  return env
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

export function createGitEnvironmentService(deps: EnvironmentDeps) {
  const now = deps.now ?? (() => new Date())
  const runSshVersion = deps.runSshVersion ?? (() => runDefaultSshVersion(deps))

  async function getPublicKeyDetails(): Promise<GitSshPublicKeyDetails> {
    try {
      return parseSshPublicKeyDetails(await findCommonSshPublicKey(deps))
    } catch {
      return emptySshPublicKeyDetails()
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
      const operation = "git.environment.check"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      const publicKey = await getPublicKeyDetails()
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, {
        platform: deps.platform,
      })
      try {
        const gitVersionResult = await deps.commandRunner.run({
          cwd: deps.homeDir,
          args: ["--version"],
          logFailure: false,
          operation,
          operationId,
        })
        let sshAvailable = false
        try {
          await runSshVersion()
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
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
          platform: deps.platform,
          gitAvailable: state.gitAvailable,
          gitVersion: state.gitVersion,
          sshAvailable: state.sshAvailable,
          userNameConfigured: Boolean(state.userName),
          userEmailConfigured: Boolean(state.userEmail),
          userEmailDomain: emailDomain(state.userEmail),
          commonSshKeyExists: state.commonSshKeyExists,
        })
        return state
      } catch {
        const state = {
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
        deps.logger?.warn("Git environment check completed without Git.", {
          operation,
          operationId,
          platform: deps.platform,
          gitAvailable: state.gitAvailable,
          commonSshKeyExists: state.commonSshKeyExists,
          installHint: state.installHint,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        })
        return state
      }
    },

    async configureIdentity(input: { readonly userName: string; readonly userEmail: string }): Promise<void> {
      const operation = "git.environment.configureIdentity"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      const userName = input.userName.trim()
      const userEmail = input.userEmail.trim()
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, {
        userNameLength: userName.length,
        userEmailDomain: emailDomain(userEmail),
      })
      if (!userName) {
        logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "empty-user-name", {
          userEmailDomain: emailDomain(userEmail),
        })
        throw new Error("请输入用户名。")
      }
      if (!userEmail) {
        logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "empty-user-email", {
          userNameLength: userName.length,
        })
        throw new Error("请输入邮箱。")
      }
      try {
        await deps.commandRunner.run({
          cwd: deps.homeDir,
          args: ["config", "--global", "user.name", userName],
          logFailure: false,
          operation,
          operationId,
        })
        await deps.commandRunner.run({
          cwd: deps.homeDir,
          args: ["config", "--global", "user.email", userEmail],
          logFailure: false,
          operation,
          operationId,
        })
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
          userNameLength: userName.length,
          userEmailDomain: emailDomain(userEmail),
        })
      } catch (error) {
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          startedAt,
          error,
          extra: {
            userNameLength: userName.length,
            userEmailDomain: emailDomain(userEmail),
          },
        })
        throw error
      }
    },

    async getSshPublicKey(): Promise<SynapseGitSshPublicKey | null> {
      const key = await findCommonSshPublicKey(deps)
      deps.logger?.info("Git SSH public key lookup completed.", {
        operation: "git.environment.getSshPublicKey",
        operationId: createGitOperationId(),
        found: Boolean(key),
        keyType: key?.content.split(/\s+/)[0] ?? null,
      })
      return key
    },
  }
}

function emailDomain(value: string | null): string | null {
  if (!value) return null
  const [, domain] = value.split("@")
  return domain || null
}

const noopLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
}

export type GitEnvironmentService = ReturnType<typeof createGitEnvironmentService>
