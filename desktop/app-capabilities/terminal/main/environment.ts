import os from "node:os"
import path from "node:path"
import { statSync } from "node:fs"

import { findEnvEntry, resolveCachedLoginShellPath } from "../../../electron/runtime/process/shell-environment"
import type { TerminalEnvironment, TerminalLaunchLayer } from "../shared/schema"

export type TerminalEnvironmentSnapshot = {
  readonly shell: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly environmentKeys: string[]
}

export class TerminalLaunchValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TerminalLaunchValidationError"
  }
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
const TERMINAL_RESERVED_ENV_KEYS = new Set(["TERM_PROGRAM", "TERM_PROGRAM_VERSION"])
const TERMINAL_ENVIRONMENT_ENTRY_LIMIT = 256
const TERMINAL_ENVIRONMENT_VALUE_BYTE_LIMIT = 32 * 1024
const TERMINAL_ENVIRONMENT_TOTAL_BYTE_LIMIT = 256 * 1024

export type TerminalLaunchConfiguration = {
  readonly shell?: string
  readonly cwd?: string
  readonly environment: TerminalEnvironment
  readonly environmentEntries: readonly {
    readonly key: string
    readonly action: "set" | "unset"
    readonly source: "global" | "group" | "command" | "override"
  }[]
  readonly shellKind: "default" | "global" | "group" | "command" | "override"
  readonly cwdKind: "default" | "global" | "group" | "command" | "override"
}

export function resolveTerminalLaunchConfiguration(input: {
  readonly global?: TerminalLaunchLayer
  readonly group?: TerminalLaunchLayer
  readonly command?: TerminalLaunchLayer
  readonly override?: TerminalLaunchLayer
  readonly platform?: NodeJS.Platform
}): TerminalLaunchConfiguration {
  const platform = input.platform ?? process.platform
  const layers = [
    ["global", input.global],
    ["group", input.group],
    ["command", input.command],
    ["override", input.override],
  ] as const
  let shell: string | undefined
  let cwd: string | undefined
  let shellKind: TerminalLaunchConfiguration["shellKind"] = "default"
  let cwdKind: TerminalLaunchConfiguration["cwdKind"] = "default"
  let environment: TerminalEnvironment = {}
  const environmentSources: Record<string, "global" | "group" | "command" | "override"> = {}
  for (const [kind, layer] of layers) {
    if (!layer) continue
    if (layer.shell) {
      shell = layer.shell
      shellKind = kind
    }
    if (layer.defaultCwd) {
      cwd = layer.defaultCwd
      cwdKind = kind
    }
    environment = mergeTerminalEnvironment(environment, layer.environment, platform)
    for (const key of Object.keys(layer.environment ?? {})) {
      if (platform === "win32") {
        const existingKey = Object.keys(environmentSources).find((candidate) => candidate.toUpperCase() === key.toUpperCase())
        if (existingKey && existingKey !== key) delete environmentSources[existingKey]
      }
      environmentSources[key] = kind
    }
  }
  validateTerminalEnvironment(environment, platform)
  return {
    shell,
    cwd,
    environment,
    shellKind,
    cwdKind,
    environmentEntries: Object.entries(environment)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, action: value === null ? "unset" as const : "set" as const, source: environmentSources[key]! })),
  }
}

export function mergeTerminalEnvironment(
  base: Readonly<TerminalEnvironment> = {},
  overlay: Readonly<TerminalEnvironment> | undefined,
  platform: NodeJS.Platform = process.platform,
): TerminalEnvironment {
  const result: TerminalEnvironment = { ...base }
  for (const [key, value] of Object.entries(overlay ?? {})) {
    const existingKey = platform === "win32"
      ? Object.keys(result).find((candidate) => candidate.toUpperCase() === key.toUpperCase())
      : key
    if (existingKey && existingKey !== key) delete result[existingKey]
    result[key] = value
  }
  return result
}

export function resolveTerminalEnvironment(input: {
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly effectivePath?: string | null
  readonly cwd?: string
  readonly shell?: string
  readonly overrides?: Readonly<TerminalEnvironment>
  readonly appVersion?: string
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
  env.TERM_PROGRAM = "Synapse"
  env.TERM_PROGRAM_VERSION = input.appVersion?.trim() || "unknown"
  if (platform !== "win32") env.SHELL = shell

  for (const [key, value] of Object.entries(input.overrides ?? {})) {
    validateEnvironmentEntry(key, value)
    const existingKey = platform === "win32"
      ? Object.keys(env).find((candidate) => candidate.toUpperCase() === key.toUpperCase())
      : key
    if (value === null) {
      if (existingKey) delete env[existingKey]
      continue
    }
    if (existingKey && existingKey !== key) delete env[existingKey]
    env[key] = value
  }
  if (
    platform === "darwin"
    && !Object.keys(input.overrides ?? {}).some((key) => ["LANG", "LC_ALL", "LC_CTYPE"].includes(key.toUpperCase()))
    && !env.LANG?.trim()
    && !env.LC_ALL?.trim()
    && !env.LC_CTYPE?.trim()
  ) {
    env.LANG = "en_US.UTF-8"
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

export function resolveTerminalShellArgs(
  shell: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== "darwin") return []
  return ["bash", "zsh"].includes(path.basename(shell)) ? ["-l"] : []
}

function validateEnvironmentEntry(key: string, value: string | null): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new TerminalLaunchValidationError("Invalid Terminal environment key")
  const normalizedKey = key.toUpperCase()
  if (TERMINAL_RESERVED_ENV_KEYS.has(normalizedKey)) throw new TerminalLaunchValidationError("Protected Terminal environment key")
  if (TERMINAL_RESERVED_INTERNAL_ENV_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))) {
    throw new TerminalLaunchValidationError("Protected Terminal environment key")
  }
  if (value?.includes("\0")) throw new TerminalLaunchValidationError("Invalid Terminal environment value")
  if (value !== null && Buffer.byteLength(value, "utf8") > TERMINAL_ENVIRONMENT_VALUE_BYTE_LIMIT) {
    throw new TerminalLaunchValidationError("Terminal environment value is too large")
  }
}

function validateTerminalEnvironment(environment: Readonly<TerminalEnvironment>, platform: NodeJS.Platform): void {
  const entries = Object.entries(environment)
  if (entries.length > TERMINAL_ENVIRONMENT_ENTRY_LIMIT) throw new TerminalLaunchValidationError("Too many Terminal environment entries")
  const normalized = new Set<string>()
  let totalBytes = 0
  for (const [key, value] of entries) {
    validateEnvironmentEntry(key, value)
    const normalizedKey = platform === "win32" ? key.toUpperCase() : key
    if (normalized.has(normalizedKey)) throw new TerminalLaunchValidationError("Duplicate Terminal environment key")
    normalized.add(normalizedKey)
    totalBytes += Buffer.byteLength(key, "utf8") + (value === null ? 0 : Buffer.byteLength(value, "utf8"))
  }
  if (totalBytes > TERMINAL_ENVIRONMENT_TOTAL_BYTE_LIMIT) throw new TerminalLaunchValidationError("Terminal environment is too large")
}

function validateExecutableOrCommand(shell: string, platform: NodeJS.Platform): void {
  if (!shell.trim() || shell.includes("\0")) throw new TerminalLaunchValidationError("Invalid Terminal shell")
  const targetPath = platform === "win32" ? path.win32 : path.posix
  if (targetPath.isAbsolute(shell) && targetPath.normalize(shell) !== shell) throw new TerminalLaunchValidationError("Invalid Terminal shell path")
}

function validateCwd(cwd: string, platform: NodeJS.Platform): void {
  const targetPath = platform === "win32" ? path.win32 : path.posix
  if (!targetPath.isAbsolute(cwd) || cwd.includes("\0")) throw new TerminalLaunchValidationError("Invalid Terminal cwd")
}

function validateLocalFilesystemTargets(shell: string, cwd: string, platform: NodeJS.Platform): void {
  if (platform !== process.platform) return
  if (!statSync(cwd).isDirectory()) throw new TerminalLaunchValidationError("Terminal cwd is not a directory")
  const targetPath = platform === "win32" ? path.win32 : path.posix
  if (targetPath.isAbsolute(shell) && !statSync(shell).isFile()) throw new TerminalLaunchValidationError("Terminal shell is not a file")
}
