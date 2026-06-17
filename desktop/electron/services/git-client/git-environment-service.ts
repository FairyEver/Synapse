import path from "node:path"
import type { SynapseGitEnvironmentState } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

type Platform = NodeJS.Platform

type EnvironmentDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly homeDir: string
  readonly pathExists: (filePath: string) => Promise<boolean>
  readonly platform: Platform
}

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
    const result = await commandRunner.run({ cwd: homeDir, args: ["config", "--global", key] })
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

async function hasCommonSshKey(
  homeDir: string,
  pathExists: (filePath: string) => Promise<boolean>,
): Promise<boolean> {
  const sshDir = path.join(homeDir, ".ssh")
  return (await pathExists(path.join(sshDir, "id_ed25519.pub")))
    || (await pathExists(path.join(sshDir, "id_rsa.pub")))
}

export function createGitEnvironmentService(deps: EnvironmentDeps) {
  return {
    async check(): Promise<SynapseGitEnvironmentState> {
      try {
        const gitVersionResult = await deps.commandRunner.run({ cwd: deps.homeDir, args: ["--version"] })
        let sshAvailable = false
        try {
          await deps.commandRunner.run({ cwd: deps.homeDir, args: ["-c", "core.sshCommand=ssh -V", "version"] })
          sshAvailable = true
        } catch {
          sshAvailable = false
        }

        return {
          gitAvailable: true,
          gitVersion: gitVersionResult.stdout.trim() || null,
          gitPath: null,
          sshAvailable,
          userName: await readConfig(deps.commandRunner, deps.homeDir, "user.name"),
          userEmail: await readConfig(deps.commandRunner, deps.homeDir, "user.email"),
          commonSshKeyExists: await hasCommonSshKey(deps.homeDir, deps.pathExists),
          installHint: null,
        }
      } catch {
        return {
          gitAvailable: false,
          gitVersion: null,
          gitPath: null,
          sshAvailable: false,
          userName: null,
          userEmail: null,
          commonSshKeyExists: await hasCommonSshKey(deps.homeDir, deps.pathExists),
          installHint: installHint(deps.platform),
        }
      }
    },

    async configureIdentity(input: { readonly userName: string; readonly userEmail: string }): Promise<void> {
      const userName = input.userName.trim()
      const userEmail = input.userEmail.trim()
      if (!userName) throw new Error("请输入用户名。")
      if (!userEmail) throw new Error("请输入邮箱。")
      await deps.commandRunner.run({ cwd: deps.homeDir, args: ["config", "--global", "user.name", userName] })
      await deps.commandRunner.run({ cwd: deps.homeDir, args: ["config", "--global", "user.email", userEmail] })
    },
  }
}

export type GitEnvironmentService = ReturnType<typeof createGitEnvironmentService>
