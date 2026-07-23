import os from "node:os"
import path from "node:path"
import { statSync } from "node:fs"

import { findEnvEntry, resolveCachedLoginShellPath } from "../../../electron/runtime/process/shell-environment"

export type TerminalEnvironmentSnapshot = {
  readonly shell: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly environmentKeys: string[]
}

const UNIX_ENV_KEYS = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR"] as const
const WINDOWS_ENV_KEYS = [
  "SystemRoot",
  "ComSpec",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "TEMP",
  "TMP",
  "PATHEXT",
  "LANG",
] as const
const TERMINAL_RESERVED_INTERNAL_ENV_PREFIXES = ["SYNAPSE_", "MCP_"] as const

export function resolveTerminalEnvironment(input: {
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly effectivePath?: string | null
  readonly cwd?: string
  readonly shell?: string
  readonly overrides?: Readonly<Record<string, string>>
  readonly validateFilesystem?: boolean
} = {}): TerminalEnvironmentSnapshot {
  const platform = input.platform ?? process.platform
  const baseEnv = input.baseEnv ?? process.env
  const shell = input.shell ?? resolveDefaultTerminalShell(platform, baseEnv)
  const cwd = input.cwd ?? os.homedir()
  validateExecutableOrCommand(shell, platform)
  validateCwd(cwd, platform)
  if (input.validateFilesystem !== false) validateLocalFilesystemTargets(shell, cwd, platform)

  const env: Record<string, string> = {}
  const allowedKeys = platform === "win32" ? WINDOWS_ENV_KEYS : UNIX_ENV_KEYS
  for (const key of allowedKeys) {
    const entry = findEnvEntry(baseEnv, key, platform)
    if (entry?.value !== undefined) env[key] = entry.value
  }
  env.PATH = input.effectivePath
    ?? resolveCachedLoginShellPath(baseEnv)
    ?? findEnvEntry(baseEnv, "PATH", platform)?.value
    ?? ""
  env.TERM = "xterm-256color"
  env.COLORTERM = "truecolor"
  if (platform !== "win32") env.SHELL = shell

  for (const [key, value] of Object.entries(input.overrides ?? {})) {
    validateEnvironmentEntry(key, value)
    env[key] = value
  }

  return { shell, cwd, env, environmentKeys: Object.keys(env).sort() }
}

export function resolveDefaultTerminalShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    return findEnvEntry(env, "ComSpec", platform)?.value || "powershell.exe"
  }
  return findEnvEntry(env, "SHELL", platform)?.value || "/bin/zsh"
}

function validateEnvironmentEntry(key: string, value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error("Invalid Terminal environment key")
  const normalizedKey = key.toUpperCase()
  if (TERMINAL_RESERVED_INTERNAL_ENV_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))) {
    throw new Error("Protected Terminal environment key")
  }
  if (value.includes("\0")) throw new Error("Invalid Terminal environment value")
}

function validateExecutableOrCommand(shell: string, platform: NodeJS.Platform): void {
  if (!shell.trim() || shell.includes("\0")) throw new Error("Invalid Terminal shell")
  const targetPath = platform === "win32" ? path.win32 : path.posix
  if (targetPath.isAbsolute(shell) && targetPath.normalize(shell) !== shell) throw new Error("Invalid Terminal shell path")
}

function validateCwd(cwd: string, platform: NodeJS.Platform): void {
  const targetPath = platform === "win32" ? path.win32 : path.posix
  if (!targetPath.isAbsolute(cwd) || cwd.includes("\0")) throw new Error("Invalid Terminal cwd")
}

function validateLocalFilesystemTargets(shell: string, cwd: string, platform: NodeJS.Platform): void {
  if (platform !== process.platform) return
  if (!statSync(cwd).isDirectory()) throw new Error("Terminal cwd is not a directory")
  const targetPath = platform === "win32" ? path.win32 : path.posix
  if (targetPath.isAbsolute(shell) && !statSync(shell).isFile()) throw new Error("Terminal shell is not a file")
}
